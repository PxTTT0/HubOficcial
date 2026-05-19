import type { SqlExecutor } from "./pool";
import { decryptSecret, encryptSecret } from "./crypto";
import {
  emptyMfaState,
  loadBootstrapUsers,
  type MfaState,
  type StoredUser,
  type UserMfaUpdate,
  type UserRepository,
} from "../../security/users";

interface UserRow {
  id: string;
  username: string;
  role: string;
  password_hash: string;
  disabled: boolean;
  enabled: boolean | null;
  // base64 do AES-256-GCM
  secret_ct: string | null;
  secret_iv: string | null;
  secret_tag: string | null;
  last_used_step: number | null;
  enrolled_at_ms: string | number | null;
}

/**
 * UserRepository sobre Postgres.
 *
 * - secret TOTP cifrado em repouso (AES-256-GCM); nunca em claro no DB.
 * - recovery codes em tabela filha; consumo single-use ATOMICO via
 *   DELETE ... RETURNING.
 * - lastUsedStep avancado por UPDATE condicional (compare-and-set)
 *   anti-replay entre replicas.
 */
export class PgUserRepository implements UserRepository {
  constructor(
    private readonly exec: SqlExecutor,
    private readonly encKey: Buffer,
  ) {}

  private async hydrate(row: UserRow): Promise<StoredUser> {
    const recovery = await this.exec.query<{ hash: string }>(
      "SELECT hash FROM mfa_recovery_codes WHERE user_id = $1",
      [row.id],
    );
    let secret: string | null = null;
    if (row.secret_ct && row.secret_iv && row.secret_tag) {
      secret = decryptSecret(
        {
          ct: Buffer.from(row.secret_ct, "base64"),
          iv: Buffer.from(row.secret_iv, "base64"),
          tag: Buffer.from(row.secret_tag, "base64"),
        },
        this.encKey,
      );
    }
    const mfa: MfaState = {
      enabled: Boolean(row.enabled),
      secret,
      recoveryHashes: recovery.rows.map((r) => r.hash),
      lastUsedStep: row.last_used_step ?? -1,
      enrolledAtMs:
        row.enrolled_at_ms == null ? null : Number(row.enrolled_at_ms),
    };
    return {
      id: row.id,
      username: row.username,
      role: row.role as StoredUser["role"],
      passwordHash: row.password_hash,
      disabled: Boolean(row.disabled),
      mfa,
    };
  }

  private readonly selectSql = `
    SELECT u.id, u.username, u.role, u.password_hash, u.disabled,
           m.enabled, m.secret_ct, m.secret_iv, m.secret_tag,
           m.last_used_step, m.enrolled_at_ms
      FROM users u
      LEFT JOIN user_mfa m ON m.user_id = u.id`;

  async findByUsername(username: string): Promise<StoredUser | null> {
    const r = await this.exec.query<UserRow>(
      `${this.selectSql} WHERE u.username = $1`,
      [username.trim().toLowerCase()],
    );
    return r.rows[0] ? this.hydrate(r.rows[0]) : null;
  }

  async findById(id: string): Promise<StoredUser | null> {
    const r = await this.exec.query<UserRow>(
      `${this.selectSql} WHERE u.id = $1`,
      [id],
    );
    return r.rows[0] ? this.hydrate(r.rows[0]) : null;
  }

  async updateMfa(
    id: string,
    update: UserMfaUpdate,
  ): Promise<StoredUser | null> {
    const current = await this.findById(id);
    if (!current) return null;

    const next: MfaState = {
      enabled: update.enabled ?? current.mfa.enabled,
      secret:
        update.secret !== undefined ? update.secret : current.mfa.secret,
      recoveryHashes:
        update.recoveryHashes ?? current.mfa.recoveryHashes,
      lastUsedStep: update.lastUsedStep ?? current.mfa.lastUsedStep,
      enrolledAtMs:
        update.enrolledAtMs !== undefined
          ? update.enrolledAtMs
          : current.mfa.enrolledAtMs,
    };

    let ct: string | null = null;
    let iv: string | null = null;
    let tag: string | null = null;
    if (next.secret) {
      const e = encryptSecret(next.secret, this.encKey);
      ct = e.ct.toString("base64");
      iv = e.iv.toString("base64");
      tag = e.tag.toString("base64");
    }

    await this.exec.query(
      `INSERT INTO user_mfa
         (user_id, enabled, secret_ct, secret_iv, secret_tag, last_used_step, enrolled_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         secret_ct = EXCLUDED.secret_ct,
         secret_iv = EXCLUDED.secret_iv,
         secret_tag = EXCLUDED.secret_tag,
         last_used_step = EXCLUDED.last_used_step,
         enrolled_at_ms = EXCLUDED.enrolled_at_ms`,
      [id, next.enabled, ct, iv, tag, next.lastUsedStep, next.enrolledAtMs],
    );

    if (update.recoveryHashes !== undefined) {
      await this.exec.query(
        "DELETE FROM mfa_recovery_codes WHERE user_id = $1",
        [id],
      );
      for (const h of update.recoveryHashes) {
        await this.exec.query(
          "INSERT INTO mfa_recovery_codes (user_id, hash) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [id, h],
        );
      }
    }
    return this.findById(id);
  }

  async consumeRecoveryHash(
    id: string,
    hash: string,
  ): Promise<StoredUser | null> {
    // Single-use atomico: so um consumidor deleta a linha.
    const r = await this.exec.query(
      "DELETE FROM mfa_recovery_codes WHERE user_id = $1 AND hash = $2 RETURNING hash",
      [id, hash],
    );
    if (!r.rowCount) return null;
    return this.findById(id);
  }

  async bumpLastUsedStep(id: string, newStep: number): Promise<boolean> {
    // CAS atomico anti-replay: so avanca se newStep > atual.
    const r = await this.exec.query(
      "UPDATE user_mfa SET last_used_step = $2 WHERE user_id = $1 AND last_used_step < $2 RETURNING user_id",
      [id, newStep],
    );
    return Boolean(r.rowCount);
  }
}

/**
 * Seed idempotente: cria APENAS usuarios ausentes. Nunca sobrescreve
 * password_hash/role/disabled/MFA de usuario existente. Bootstrap
 * inicial - nao e mecanismo permanente de gestao.
 */
export async function seedBootstrapUsers(exec: SqlExecutor): Promise<number> {
  const users = loadBootstrapUsers();
  let created = 0;
  for (const u of users) {
    const ins = await exec.query(
      `INSERT INTO users (id, username, role, password_hash, disabled)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [u.id, u.username, u.role, u.passwordHash, Boolean(u.disabled)],
    );
    if (ins.rowCount) {
      created += 1;
      const m = u.mfa ?? emptyMfaState();
      await exec.query(
        `INSERT INTO user_mfa (user_id, enabled, last_used_step, enrolled_at_ms)
         VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING`,
        [u.id, m.enabled, m.lastUsedStep, m.enrolledAtMs],
      );
    }
  }
  return created;
}

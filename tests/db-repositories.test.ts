import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import type { SqlExecutor } from "../src/infra/db/pool";
import {
  assertSchemaReady,
  runMigrations,
  SchemaNotReadyError,
} from "../src/infra/db/migrate";
import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
} from "../src/infra/db/crypto";
import {
  PgUserRepository,
  seedBootstrapUsers,
} from "../src/infra/db/userRepository";
import { PgMakScoreAuditSink } from "../src/infra/db/makscoreAuditSink";
import { createInfraStores } from "../src/infra";
import {
  ProductionSecurityError,
  validateProductionEnvironment,
  type ProductionEnvironment,
} from "../src/security/bootstrap";
import type { SecurityConfig } from "../src/security/config";

const KEY = Buffer.alloc(32, 7);

function freshExec(): SqlExecutor {
  const db = newDb();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  return {
    async query(text: string, params?: unknown[]) {
      const r = await pool.query(text, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount };
    },
  };
}

async function migrated(): Promise<SqlExecutor> {
  const exec = freshExec();
  await runMigrations(exec);
  return exec;
}

// ───────────────── Crypto ─────────────────

test("parseEncryptionKey: base64 de 32 bytes ok; tamanho errado falha", () => {
  assert.equal(parseEncryptionKey(Buffer.alloc(32, 1).toString("base64")).ok, true);
  const short = parseEncryptionKey(Buffer.alloc(16, 1).toString("base64"));
  assert.equal(short.ok, false);
  assert.match(short.reason ?? "", /32 bytes/);
  assert.equal(parseEncryptionKey(undefined).ok, false);
  assert.equal(parseEncryptionKey("").ok, false);
});

test("encrypt/decrypt round-trip; tag adulterado e chave errada falham", () => {
  const enc = encryptSecret("JBSWY3DPEHPK3PXP", KEY);
  assert.equal(decryptSecret(enc, KEY), "JBSWY3DPEHPK3PXP");
  const tampered = { ...enc, tag: Buffer.alloc(enc.tag.length, 0) };
  assert.throws(() => decryptSecret(tampered, KEY));
  assert.throws(() => decryptSecret(enc, Buffer.alloc(32, 9)));
});

// ───────────────── Migrations ─────────────────

test("migrations: aplica e e idempotente", async () => {
  const exec = freshExec();
  const first = await runMigrations(exec);
  assert.deepEqual(first, ["0001_init", "0002_makscore_audit"]);
  const second = await runMigrations(exec);
  assert.deepEqual(second, []);
  const r = await exec.query("SELECT version FROM schema_migrations");
  assert.equal(r.rows.length, 2);
});

test("assertSchemaReady: falha sem migrations, ok depois", async () => {
  const exec = freshExec();
  await assert.rejects(() => assertSchemaReady(exec), SchemaNotReadyError);
  await runMigrations(exec);
  await assert.doesNotReject(() => assertSchemaReady(exec));
});

// ───────────────── Seed bootstrap idempotente ─────────────────

test("seed: cria ausentes, nunca sobrescreve existente", async () => {
  const exec = await migrated();
  const prev = {
    id: process.env.AUTH_BOOTSTRAP_ADMIN_ID,
    user: process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME,
    hash: process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH,
    json: process.env.AUTH_USERS_JSON,
  };
  // Hermetico: neutraliza AUTH_USERS_JSON que outras suites possam ter
  // deixado no ambiente (loadBootstrapUsers tambem o le).
  delete process.env.AUTH_USERS_JSON;
  process.env.AUTH_BOOTSTRAP_ADMIN_ID = "seed-admin";
  process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME = "admin";
  process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH = "HASH-ORIGINAL";
  try {
    assert.equal(await seedBootstrapUsers(exec), 1);
    assert.equal(await seedBootstrapUsers(exec), 0); // idempotente
    // simula rotacao de senha no banco
    await exec.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      "HASH-ROTACIONADA",
      "seed-admin",
    ]);
    await seedBootstrapUsers(exec); // nao deve sobrescrever
    const r = await exec.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      ["seed-admin"],
    );
    assert.equal(r.rows[0].password_hash, "HASH-ROTACIONADA");
  } finally {
    const restore = (k: string, v: string | undefined) =>
      v === undefined ? delete process.env[k] : (process.env[k] = v);
    restore("AUTH_BOOTSTRAP_ADMIN_ID", prev.id);
    restore("AUTH_BOOTSTRAP_ADMIN_USERNAME", prev.user);
    restore("AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH", prev.hash);
    restore("AUTH_USERS_JSON", prev.json);
  }
});

// ───────────────── PgUserRepository ─────────────────

async function repoWithUser(): Promise<{ exec: SqlExecutor; repo: PgUserRepository }> {
  const exec = await migrated();
  await exec.query(
    "INSERT INTO users (id, username, role, password_hash) VALUES ($1,$2,$3,$4)",
    ["u1", "alice", "admin", "ph"],
  );
  return { exec, repo: new PgUserRepository(exec, KEY) };
}

test("PgUserRepository: find + updateMfa cifra secret em repouso", async () => {
  const { exec, repo } = await repoWithUser();
  assert.equal((await repo.findByUsername("ALICE"))?.id, "u1");

  await repo.updateMfa("u1", { enabled: true, secret: "TOTPSECRET123456" });
  const stored = await exec.query<{ secret_ct: Buffer | null }>(
    "SELECT secret_ct FROM user_mfa WHERE user_id = $1",
    ["u1"],
  );
  // secret nao fica em claro
  const ct = stored.rows[0].secret_ct;
  assert.ok(ct && !Buffer.from(ct).toString("utf8").includes("TOTPSECRET"));
  // hydrate decifra de volta
  assert.equal((await repo.findById("u1"))?.mfa.secret, "TOTPSECRET123456");
});

test("PgUserRepository: recovery code single-use ATOMICO sob concorrencia", async () => {
  const { repo } = await repoWithUser();
  await repo.updateMfa("u1", {
    enabled: true,
    recoveryHashes: ["h1", "h2"],
  });
  const [a, b] = await Promise.all([
    repo.consumeRecoveryHash("u1", "h1"),
    repo.consumeRecoveryHash("u1", "h1"),
  ]);
  assert.equal([a, b].filter((x) => x !== null).length, 1);
  assert.equal(await repo.consumeRecoveryHash("u1", "h1"), null);
  // h2 ainda valido
  assert.notEqual(await repo.consumeRecoveryHash("u1", "h2"), null);
});

test("PgUserRepository: bumpLastUsedStep e CAS anti-replay", async () => {
  const { repo } = await repoWithUser();
  await repo.updateMfa("u1", { enabled: true, secret: "S" });
  const [r1, r2] = await Promise.all([
    repo.bumpLastUsedStep("u1", 100),
    repo.bumpLastUsedStep("u1", 100),
  ]);
  assert.equal([r1, r2].filter(Boolean).length, 1, "so um avanca o mesmo step");
  assert.equal(await repo.bumpLastUsedStep("u1", 50), false, "step menor rejeitado");
  assert.equal(await repo.bumpLastUsedStep("u1", 101), true, "step maior aceito");
});

// ───────────────── PgMakScoreAuditSink ─────────────────

test("PgMakScoreAuditSink: write + recent ordenado, sobrevive a restart", async () => {
  const exec = await migrated();
  const sink = new PgMakScoreAuditSink(exec);
  await sink.write({
    type: "query.decision",
    correlationId: "c1",
    cnpjMasked: "11.***.***/****-81",
    outcome: "aprovado",
  });
  await sink.write({
    type: "query.decision",
    correlationId: "c2",
    cnpjMasked: "22.***.***/****-90",
    outcome: "reprovado",
  });
  // "restart": novo sink, mesmo banco
  const after = new PgMakScoreAuditSink(exec);
  const recent = await after.recent(10);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].correlationId, "c2"); // mais recente primeiro
  assert.equal(recent[0].outcome, "reprovado");
});

// ───────────────── Factory db-mode ─────────────────

test("createInfraStores com SqlExecutor injetado => dbMode pg", async () => {
  const exec = await migrated();
  const prev = process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY;
  process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  try {
    const infra = createInfraStores(undefined, exec);
    assert.equal(infra.dbMode, "pg");
    assert.ok(infra.userRepository instanceof PgUserRepository);
    assert.ok(infra.makscoreAuditSink instanceof PgMakScoreAuditSink);
  } finally {
    process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY = prev;
  }
});

// ───────────────── Bootstrap fail-fast (DB) ─────────────────

const VALID_SECURITY: SecurityConfig = {
  sessionSecret: "a-very-long-production-session-secret-0123456789",
  sessionCookieName: "hub_sid",
  sessionTtlMs: 43_200_000,
  sessionIdleMs: 1_800_000,
  sessionBindIpRoles: ["admin", "analista"],
  csrfCookieName: "hub_csrf",
  secureCookies: true,
  trustedOrigins: ["https://hub.makfil.com.br"],
  trustProxy: true,
  userRateLimitPerMin: 60,
  ipRateLimitPerMin: 120,
  authRateLimitPerMin: 10,
  authFailureLimitPer15Min: 25,
  allowDevHeaderAuth: false,
  envName: "production",
  mfaRequiredRoles: ["admin", "analista"],
  mfaIssuer: "HubVendasMakfil",
  mfaChallengeTtlMs: 300_000,
  mfaRecoveryCodes: 10,
  mfaRateLimitPerMin: 5,
  mfaFailureLimitPer15Min: 10,
};

function env(
  db: ProductionEnvironment["db"],
  envName = "production",
): ProductionEnvironment {
  return {
    envName,
    security: { ...VALID_SECURITY, envName },
    audit: { filePath: "/var/log/x.jsonl", memoryRetain: 1000, configured: true },
    makscore: {
      cnpjPepper: "pepper-de-producao-suficientemente-longo",
      eposiMode: "mock",
      eposiLogin: "",
      eposiPassword: "",
      eposiLoginSecondary: "",
      eposiPasswordSecondary: "",
    },
    redis: { url: "redis://r:6379", allowInMemoryState: false },
    db,
  };
}

test("produção sem DATABASE_URL e sem opt-out => falha", () => {
  assert.throws(
    () =>
      validateProductionEnvironment(
        env({ url: null, allowInMemoryState: false, encryptionKeyOk: true }),
      ),
    (e: unknown) => {
      assert.ok(e instanceof ProductionSecurityError);
      assert.match(e.message, /DATABASE_URL nao definido em producao/);
      return true;
    },
  );
});

test("produção com DATABASE_URL mas chave de cifragem invalida => falha", () => {
  assert.throws(
    () =>
      validateProductionEnvironment(
        env({
          url: "postgres://r/db",
          allowInMemoryState: false,
          encryptionKeyOk: false,
          encryptionKeyReason: "ausente",
        }),
      ),
    (e: unknown) => {
      assert.ok(e instanceof ProductionSecurityError);
      assert.match(e.message, /AUTH_MFA_SECRET_ENCRYPTION_KEY invalida/);
      return true;
    },
  );
});

test("produção com DATABASE_URL + chave ok => sem issue de db", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(
      env({ url: "postgres://r/db", allowInMemoryState: false, encryptionKeyOk: true }),
    ),
  );
});

test("produção sem DATABASE_URL mas opt-out => permitido", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(
      env({ url: null, allowInMemoryState: true, encryptionKeyOk: true }),
    ),
  );
});

test("não-produção sem DATABASE_URL => não falha", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(
      env({ url: null, allowInMemoryState: false, encryptionKeyOk: false }, "development"),
    ),
  );
});

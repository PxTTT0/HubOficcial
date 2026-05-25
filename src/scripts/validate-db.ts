/**
 * Validacao end-to-end contra Postgres REAL (nao pg-mem).
 *
 * Exercita os caminhos reais do codigo: migrations, schema, seed,
 * cifragem do secret MFA, CAS de last_used_step e DELETE RETURNING de
 * recovery sob concorrencia. Falha (exit 1) na primeira divergencia.
 *
 * Uso:
 *   node --env-file=.env.validation dist/src/scripts/validate-db.js
 *   (no CI: env via job, node dist/src/scripts/validate-db.js)
 *
 * Nunca loga secret/chave/hash/payload.
 */
import { createPgExecutor, loadDbConfig } from "../infra/db/pool";
import { runMigrations } from "../infra/db/migrate";
import { PgUserRepository, seedBootstrapUsers } from "../infra/db/userRepository";
import { PgMakScoreResultsRepository } from "../infra/db/makscoreResultsRepository";
import { requireEncryptionKey } from "../infra/db/crypto";
import { hashCnpj } from "../modules/makscore/repository";
import type { PersistedMakScore } from "../modules/makscore/types";

const TEST_ID = "validate-db-user";
const PLAINTEXT_SECRET = "JBSWY3DPEHPK3PXPVALIDATE";

function ok(label: string): void {
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${label}`);
}
function fail(label: string, detail?: string): never {
  // eslint-disable-next-line no-console
  console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const cfg = loadDbConfig();
  if (!cfg.url) fail("DATABASE_URL ausente");
  const key = requireEncryptionKey(process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY);
  const exec = createPgExecutor(cfg);

  try {
    // ── migrations + seed ──────────────────────────────────────────────
    const applied = await runMigrations(exec);
    // eslint-disable-next-line no-console
    console.log("migrations aplicadas:", applied.length ? applied : "(ja aplicadas)");
    await seedBootstrapUsers(exec);

    const mig = await exec.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    if (mig.rows.length < 2) fail("schema_migrations < 2", String(mig.rows.length));
    ok(`schema_migrations populado (${mig.rows.map((r) => r.version).join(", ")})`);

    const tbl = await exec.query<{ ok: boolean }>(
      `SELECT (to_regclass('users') IS NOT NULL
            AND to_regclass('user_mfa') IS NOT NULL
            AND to_regclass('mfa_recovery_codes') IS NOT NULL
            AND to_regclass('makscore_audit') IS NOT NULL) AS ok`,
    );
    if (!tbl.rows[0]?.ok) fail("tabelas ausentes");
    ok("users / user_mfa / mfa_recovery_codes / makscore_audit criadas");

    // ── usuario de teste ───────────────────────────────────────────────
    await exec.query("DELETE FROM users WHERE id = $1", [TEST_ID]);
    await exec.query(
      "INSERT INTO users (id, username, role, password_hash) VALUES ($1,$2,$3,$4)",
      [TEST_ID, "validate-db-user", "admin", "ph-fake"],
    );
    const repo = new PgUserRepository(exec, key);

    // ── secret MFA cifrado em repouso ──────────────────────────────────
    await repo.updateMfa(TEST_ID, { enabled: true, secret: PLAINTEXT_SECRET });
    const raw = await exec.query<{ secret_ct: string | null }>(
      "SELECT secret_ct FROM user_mfa WHERE user_id = $1",
      [TEST_ID],
    );
    const ct = raw.rows[0]?.secret_ct ?? "";
    if (!ct) fail("secret_ct vazio");
    if (ct.includes(PLAINTEXT_SECRET)) fail("secret em CLARO no banco");
    if (Buffer.from(ct, "base64").toString("utf8").includes(PLAINTEXT_SECRET)) {
      fail("secret recuperavel sem decifrar");
    }
    const back = await repo.findById(TEST_ID);
    if (back?.mfa.secret !== PLAINTEXT_SECRET) fail("decrypt round-trip falhou");
    ok("secret MFA cifrado em repouso (AES-256-GCM) e decifrado pelo repo");

    // ── CAS anti-replay (last_used_step) sob concorrencia ──────────────
    const [c1, c2] = await Promise.all([
      repo.bumpLastUsedStep(TEST_ID, 100),
      repo.bumpLastUsedStep(TEST_ID, 100),
    ]);
    if ([c1, c2].filter(Boolean).length !== 1) {
      fail("CAS last_used_step: esperado exatamente 1 vencedor", `${c1}/${c2}`);
    }
    if (await repo.bumpLastUsedStep(TEST_ID, 50)) fail("CAS aceitou step menor (replay)");
    if (!(await repo.bumpLastUsedStep(TEST_ID, 101))) fail("CAS rejeitou step maior valido");
    ok("last_used_step CAS atomico (anti-replay) ok");

    // ── recovery single-use (DELETE RETURNING) sob concorrencia ────────
    await repo.updateMfa(TEST_ID, { recoveryHashes: ["rc1", "rc2"] });
    const [r1, r2] = await Promise.all([
      repo.consumeRecoveryHash(TEST_ID, "rc1"),
      repo.consumeRecoveryHash(TEST_ID, "rc1"),
    ]);
    if ([r1, r2].filter((x) => x !== null).length !== 1) {
      fail("recovery single-use: esperado exatamente 1 consumo");
    }
    if ((await repo.consumeRecoveryHash(TEST_ID, "rc1")) !== null) {
      fail("recovery rc1 consumivel de novo");
    }
    if ((await repo.consumeRecoveryHash(TEST_ID, "rc2")) === null) {
      fail("recovery rc2 (intacto) nao consumiu");
    }
    ok("recovery code DELETE RETURNING single-use ok");

    // ── makscore_results: append-only + cache mais recente valido ──────
    const cnpjHash = hashCnpj("11222333000181");
    await exec.query("DELETE FROM makscore_results WHERE cnpj_hash = $1", [cnpjHash]);
    const resultsRepo = new PgMakScoreResultsRepository(exec);
    const mk = (correlationId: string, score: number, createdAtMs: number): PersistedMakScore => ({
      correlationId,
      cnpj: "11.***.***/****-81",
      product: "TOTAL_PJ",
      score,
      outcome: "aprovado",
      riskLevel: "baixo",
      primaryRule: "score:aprovado",
      recommendedAction: "Seguir.",
      reasons: [],
      ruleHits: [],
      errorCode: null,
      errorMessage: null,
      validUntil: new Date(createdAtMs + 3_600_000).toISOString(),
      consultedAt: new Date(createdAtMs).toISOString(),
      sourceIsMock: true,
      cadastral: { status: "ativa", razaoSocial: "EMP", cnaePrincipal: null, dataAbertura: null },
      context: { userId: "validate-db-user" },
      cnpjHash,
      createdAtMs,
      expiresAtMs: createdAtMs + 3_600_000,
      reviewStatus: "none",
    });
    const t0 = Date.now();
    await resultsRepo.save(mk("mk-old", 500, t0 - 5_000));
    await resultsRepo.save(mk("mk-new", 800, t0));
    const hist = await resultsRepo.listHistory({ userId: "validate-db-user", limit: 50, offset: 0 });
    if (hist.length < 2) fail("makscore_results nao e append-only", String(hist.length));
    const valid = await resultsRepo.findValidByCnpj("11222333000181");
    if (valid?.correlationId !== "mk-new") fail("cache nao pegou o mais recente valido");
    const colCheck = await exec.query(
      "SELECT * FROM makscore_results WHERE correlation_id = $1",
      ["mk-new"],
    );
    if (JSON.stringify(colCheck.rows[0]).includes("11222333000181")) {
      fail("CNPJ aberto presente em makscore_results");
    }
    await exec.query("DELETE FROM makscore_results WHERE cnpj_hash = $1", [cnpjHash]);
    ok("makscore_results append-only + cache + sem CNPJ aberto ok");

    // ── cleanup ────────────────────────────────────────────────────────
    await exec.query("DELETE FROM users WHERE id = $1", [TEST_ID]);
    // eslint-disable-next-line no-console
    console.log("\nVALIDACAO POSTGRES REAL: OK");
  } finally {
    await exec.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      scope: "validate-db",
      level: "fatal",
      message: err instanceof Error ? err.message : "validate-db failed",
    }),
  );
  process.exit(1);
});

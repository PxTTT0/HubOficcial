import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import type { SqlExecutor } from "../src/infra/db/pool";
import { runMigrations } from "../src/infra/db/migrate";
import { PgMakScoreResultsRepository } from "../src/infra/db/makscoreResultsRepository";
import {
  InMemoryMakScoreRepository,
  hashCnpj,
  type MakScoreRepository,
} from "../src/modules/makscore/repository";
import type { PersistedMakScore } from "../src/modules/makscore/types";

const CNPJ = "11222333000181";

function persisted(overrides: Partial<PersistedMakScore> = {}): PersistedMakScore {
  const now = Date.now();
  return {
    correlationId: overrides.correlationId ?? `corr-${Math.random().toString(36).slice(2)}`,
    cnpj: "11.***.***/****-81",
    product: "TOTAL_PJ",
    score: 720,
    outcome: "aprovado",
    riskLevel: "baixo",
    primaryRule: "score:aprovado",
    recommendedAction: "Seguir.",
    reasons: [{ code: "R2", label: "Poucas informacoes", critical: false }],
    ruleHits: [
      {
        code: "score:aprovado",
        category: "score",
        severity: "approve",
        outcome: "aprovado",
        explanation: "x",
        impact: "y",
        priority: 10,
      },
    ],
    errorCode: null,
    errorMessage: null,
    validUntil: new Date(now + 3_600_000).toISOString(),
    consultedAt: new Date(now).toISOString(),
    sourceIsMock: true,
    cadastral: { status: "ativa", razaoSocial: "EMP X", cnaePrincipal: null, dataAbertura: null },
    context: { userId: "u1", proposalId: "p1" },
    cnpjHash: hashCnpj(CNPJ),
    createdAtMs: now,
    expiresAtMs: now + 3_600_000,
    reviewStatus: "none",
    ...overrides,
  };
}

async function pgExec(): Promise<SqlExecutor> {
  const db = newDb();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  const exec: SqlExecutor = {
    async query(t: string, p?: unknown[]) {
      const r = await pool.query(t, p as any[]);
      return { rows: r.rows, rowCount: r.rowCount };
    },
  };
  await runMigrations(exec);
  return exec;
}

// Roda a mesma bateria nas duas implementacoes (paridade).
function suite(name: string, make: () => Promise<MakScoreRepository>) {
  test(`${name}: save + findByCorrelationId`, async () => {
    const repo = await make();
    const rec = persisted({ correlationId: "c-abc" });
    await repo.save(rec);
    const got = await repo.findByCorrelationId("c-abc");
    assert.equal(got?.correlationId, "c-abc");
    assert.equal(got?.outcome, "aprovado");
    assert.equal(got?.riskLevel, "baixo");
    assert.deepEqual(got?.reasons, rec.reasons);
    assert.equal(got?.reviewStatus, "none");
  });

  test(`${name}: cache retorna o valido mais recente por cnpj_hash`, async () => {
    const repo = await make();
    const t0 = Date.now();
    await repo.save(persisted({ correlationId: "old", createdAtMs: t0 - 1000, score: 500, outcome: "exige_analise" }));
    await repo.save(persisted({ correlationId: "new", createdAtMs: t0, score: 800, outcome: "aprovado" }));
    const valid = await repo.findValidByCnpj(CNPJ);
    assert.equal(valid?.correlationId, "new");
    assert.equal(valid?.score, 800);
  });

  test(`${name}: registro expirado nao e retornado pelo cache`, async () => {
    const repo = await make();
    const past = Date.now() - 10_000;
    await repo.save(persisted({ correlationId: "exp", createdAtMs: past, expiresAtMs: past + 1 }));
    assert.equal(await repo.findValidByCnpj(CNPJ), null);
  });

  test(`${name}: append-only (forceRefresh gera nova linha; cache pega a ultima)`, async () => {
    const repo = await make();
    const t0 = Date.now();
    await repo.save(persisted({ correlationId: "r1", createdAtMs: t0 - 5 }));
    await repo.save(persisted({ correlationId: "r2", createdAtMs: t0 }));
    const hist = await repo.listHistory({ userId: "u1", limit: 50, offset: 0 });
    assert.equal(hist.length, 2, "duas linhas (historico preservado)");
    assert.equal((await repo.findValidByCnpj(CNPJ))?.correlationId, "r2");
  });

  test(`${name}: historico filtra por usuario e ordena desc`, async () => {
    const repo = await make();
    const t0 = Date.now();
    await repo.save(persisted({ correlationId: "a", createdAtMs: t0 - 2, context: { userId: "u1" } }));
    await repo.save(persisted({ correlationId: "b", createdAtMs: t0, context: { userId: "u1" } }));
    await repo.save(persisted({ correlationId: "c", createdAtMs: t0 - 1, context: { userId: "u2" } }));
    const u1 = await repo.listHistory({ userId: "u1", limit: 50, offset: 0 });
    assert.deepEqual(u1.map((r) => r.correlationId), ["b", "a"]);
    const all = await repo.listHistory({ limit: 50, offset: 0 });
    assert.equal(all.length, 3);
  });

  test(`${name}: historico filtra por outcome, intervalo de datas e q`, async () => {
    const repo = await make();
    const t0 = Date.now();
    await repo.save(persisted({ correlationId: "ap", createdAtMs: t0 - 3000, outcome: "aprovado", cnpj: "11.***.***/****-81" }));
    await repo.save(persisted({ correlationId: "rp", createdAtMs: t0 - 2000, outcome: "reprovado", cnpj: "22.***.***/****-99" }));
    await repo.save(persisted({ correlationId: "ex", createdAtMs: t0 - 1000, outcome: "exige_analise", cnpj: "33.***.***/****-77" }));

    // outcome
    const rep = await repo.listHistory({ outcome: "reprovado", limit: 50, offset: 0 });
    assert.deepEqual(rep.map((r) => r.correlationId), ["rp"]);
    assert.equal(await repo.countHistory({ outcome: "reprovado", limit: 50, offset: 0 }), 1);

    // intervalo de datas (fromMs/toMs inclusivos)
    const range = await repo.listHistory({ fromMs: t0 - 2500, toMs: t0 - 1500, limit: 50, offset: 0 });
    assert.deepEqual(range.map((r) => r.correlationId), ["rp"]);

    // q: substring no cnpj mascarado (case-insensitive)
    const q = await repo.listHistory({ q: "33.", limit: 50, offset: 0 });
    assert.deepEqual(q.map((r) => r.correlationId), ["ex"]);
    assert.equal(await repo.countHistory({ q: "33.", limit: 50, offset: 0 }), 1);
  });

  test(`${name}: paginacao (limit/offset) com countHistory total estavel`, async () => {
    const repo = await make();
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      await repo.save(persisted({ correlationId: `p${i}`, createdAtMs: t0 + i, context: { userId: "u1" } }));
    }
    const total = await repo.countHistory({ userId: "u1", limit: 2, offset: 0 });
    assert.equal(total, 5, "count ignora limit/offset");
    // ordem desc por createdAtMs: p4,p3,p2,p1,p0
    const page1 = await repo.listHistory({ userId: "u1", limit: 2, offset: 0 });
    assert.deepEqual(page1.map((r) => r.correlationId), ["p4", "p3"]);
    const page2 = await repo.listHistory({ userId: "u1", limit: 2, offset: 2 });
    assert.deepEqual(page2.map((r) => r.correlationId), ["p2", "p1"]);
    const page3 = await repo.listHistory({ userId: "u1", limit: 2, offset: 4 });
    assert.deepEqual(page3.map((r) => r.correlationId), ["p0"]);
  });

  test(`${name}: nunca persiste CNPJ aberto nem payload bruto`, async () => {
    const repo = await make();
    await repo.save(persisted({ correlationId: "leak-check" }));
    const got = await repo.findByCorrelationId("leak-check");
    const blob = JSON.stringify(got);
    assert.ok(!blob.includes(CNPJ), "CNPJ aberto nao pode aparecer");
    assert.match(got!.cnpj, /\*\*\*/); // mascarado
    assert.ok(!("raw" in (got as any)) && !("payload" in (got as any)));
  });
}

suite("InMemory", async () => new InMemoryMakScoreRepository());
suite("Postgres(pg-mem)", async () => new PgMakScoreResultsRepository(await pgExec()));

// Verificacao a nivel de coluna no Postgres: o CNPJ aberto nunca esta em
// nenhuma coluna da linha (defesa extra alem do objeto hidratado).
test("Postgres: nenhuma coluna contem CNPJ aberto", async () => {
  const exec = await pgExec();
  const repo = new PgMakScoreResultsRepository(exec);
  await repo.save(persisted({ correlationId: "col-check" }));
  const raw = await exec.query("SELECT * FROM makscore_results WHERE correlation_id = $1", ["col-check"]);
  assert.ok(!JSON.stringify(raw.rows[0]).includes(CNPJ));
});

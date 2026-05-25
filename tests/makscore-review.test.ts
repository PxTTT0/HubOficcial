import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
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
import { hashPassword } from "../src/security";

const CNPJ = "11222333000181";

function persisted(correlationId: string): PersistedMakScore {
  const now = Date.now();
  return {
    correlationId,
    cnpj: "11.***.***/****-81",
    product: "TOTAL_PJ",
    score: 720,
    outcome: "aprovado",
    riskLevel: "baixo",
    primaryRule: "score:aprovado",
    recommendedAction: "Seguir.",
    reasons: [],
    ruleHits: [
      { code: "score:aprovado", category: "score", severity: "approve", outcome: "aprovado", explanation: "x", impact: "y", priority: 10 },
    ],
    errorCode: null,
    errorMessage: null,
    validUntil: new Date(now + 3_600_000).toISOString(),
    consultedAt: new Date(now).toISOString(),
    sourceIsMock: true,
    cadastral: { status: "ativa", razaoSocial: "EMP", cnaePrincipal: null, dataAbertura: null },
    context: { userId: "u1" },
    cnpjHash: hashCnpj(CNPJ),
    createdAtMs: now,
    expiresAtMs: now + 3_600_000,
    reviewStatus: "none",
  };
}

async function pgRepo(): Promise<MakScoreRepository> {
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
  return new PgMakScoreResultsRepository(exec);
}

// ───────────── Repo: paridade InMemory x Postgres(pg-mem) ─────────────

function repoSuite(name: string, make: () => Promise<MakScoreRepository>) {
  test(`${name}: applyReview atualiza estado + trilha; outcome imutavel`, async () => {
    const repo = await make();
    await repo.save(persisted("c1"));
    const r1 = await repo.applyReview({ correlationId: "c1", toStatus: "pending", reviewerId: "ana", note: "nota" });
    assert.equal(r1?.fromStatus, "none");
    assert.equal(r1?.record.reviewStatus, "pending");
    assert.equal(r1?.record.reviewerId, "ana");
    // decisao automatica intocada
    assert.equal(r1?.record.outcome, "aprovado");
    assert.equal(r1?.record.primaryRule, "score:aprovado");
    assert.equal(r1?.record.ruleHits.length, 1);
  });

  test(`${name}: re-review permitido; trilha append-only e ordenada`, async () => {
    const repo = await make();
    await repo.save(persisted("c2"));
    await repo.applyReview({ correlationId: "c2", toStatus: "pending", reviewerId: "ana" });
    await repo.applyReview({ correlationId: "c2", toStatus: "approved", reviewerId: "ana2" });
    await repo.applyReview({ correlationId: "c2", toStatus: "rejected", reviewerId: "adm" });
    const ev = await repo.listReviewEvents("c2");
    assert.deepEqual(ev.map((e) => e.toStatus), ["pending", "approved", "rejected"]);
    assert.deepEqual(ev.map((e) => e.fromStatus), ["none", "pending", "approved"]);
    // estado atual = ultima transicao
    const cur = await repo.findByCorrelationId("c2");
    assert.equal(cur?.reviewStatus, "rejected");
  });

  test(`${name}: applyReview em correlationId inexistente => null`, async () => {
    const repo = await make();
    assert.equal(await repo.applyReview({ correlationId: "nope", toStatus: "approved", reviewerId: "ana" }), null);
  });

  test(`${name}: trilha nunca contem CNPJ aberto`, async () => {
    const repo = await make();
    await repo.save(persisted("c3"));
    await repo.applyReview({ correlationId: "c3", toStatus: "pending", reviewerId: "ana", note: "ok" });
    const ev = await repo.listReviewEvents("c3");
    assert.ok(!JSON.stringify(ev).includes(CNPJ));
  });
}

repoSuite("InMemory", async () => new InMemoryMakScoreRepository());
repoSuite("Postgres(pg-mem)", pgRepo);

// ───────────── HTTP: RBAC + auditoria sem CNPJ/note ─────────────

const ENV_KEYS = [
  "NODE_ENV", "DATABASE_URL", "REDIS_URL", "AUDIT_LOG_PATH", "MAKSCORE_EPOSI_MODE",
  "MAKSCORE_CNPJ_PEPPER", "AUTH_SESSION_SECRET", "AUTH_SECURE_COOKIES",
  "AUTH_ALLOW_DEV_HEADER_AUTH", "AUTH_MFA_REQUIRED_ROLES", "AUTH_SESSION_BIND_IP_ROLES",
  "AUTH_USERS_JSON",
];
function snapshot() { return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); }
function restore(s: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]!; }
}

async function startServer(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const { buildApp } = await import("../src/server");
  const { app } = buildApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("porta indisponivel");
  return { base: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))) };
}

async function login(base: string, username: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "SenhaForte123!" }),
  });
  return ((await r.json()) as { token: string }).token;
}

test("MakScore review: RBAC + auditoria sem CNPJ/note + outcome imutavel", { concurrency: false }, async () => {
  const snap = snapshot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-review-"));
  const auditPath = path.join(dir, "audit.jsonl");
  const hash = await hashPassword("SenhaForte123!", { memoryCost: 4096, timeCost: 2, parallelism: 1 });
  const server = await startServer({
    NODE_ENV: "test",
    DATABASE_URL: "",
    REDIS_URL: "",
    AUDIT_LOG_PATH: auditPath,
    MAKSCORE_EPOSI_MODE: "mock",
    MAKSCORE_CNPJ_PEPPER: "pep",
    AUTH_SESSION_SECRET: "review-secret",
    AUTH_SECURE_COOKIES: "false",
    AUTH_ALLOW_DEV_HEADER_AUTH: "false",
    AUTH_MFA_REQUIRED_ROLES: "",
    AUTH_SESSION_BIND_IP_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "vend-1", username: "vendedor", role: "vendedor", passwordHash: hash },
      { id: "ana-1", username: "analista", role: "analista", passwordHash: hash },
    ]),
  });

  const NOTE = "segredo-comercial-nao-pode-vazar";
  try {
    const vend = await login(server.base, "vendedor");
    const ana = await login(server.base, "analista");

    const q = await fetch(`${server.base}/api/makscore/query`, {
      method: "POST", headers: { authorization: `Bearer ${vend}`, "content-type": "application/json" },
      body: JSON.stringify({ cnpj: CNPJ }),
    });
    const corr = ((await q.json()) as any).correlationId as string;

    // vendedor NAO pode revisar
    const vendReview = await fetch(`${server.base}/api/makscore/results/${corr}/review`, {
      method: "POST", headers: { authorization: `Bearer ${vend}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(vendReview.status, 403);

    // vendedor NAO ve review-events
    const vendEvents = await fetch(`${server.base}/api/makscore/results/${corr}/review-events`, {
      headers: { authorization: `Bearer ${vend}` },
    });
    assert.equal(vendEvents.status, 403);

    // analista revisa (com note sensivel)
    const anaReview = await fetch(`${server.base}/api/makscore/results/${corr}/review`, {
      method: "POST", headers: { authorization: `Bearer ${ana}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "pending", note: NOTE }),
    });
    assert.equal(anaReview.status, 200);
    const anaBody = (await anaReview.json()) as any;
    assert.equal(anaBody.reviewStatus, "pending");
    assert.equal(anaBody.outcome, "aprovado"); // outcome automatico imutavel
    assert.equal(anaBody.primaryRule, "score:aprovado");

    // status invalido -> 400
    const bad = await fetch(`${server.base}/api/makscore/results/${corr}/review`, {
      method: "POST", headers: { authorization: `Bearer ${ana}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "none" }),
    });
    assert.equal(bad.status, 400);

    // inexistente -> 404
    const nf = await fetch(`${server.base}/api/makscore/results/00000000-0000-4000-8000-000000000000/review`, {
      method: "POST", headers: { authorization: `Bearer ${ana}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(nf.status, 404);

    // analista ve a trilha (note visivel na trilha p/ analista)
    const anaEvents = await fetch(`${server.base}/api/makscore/results/${corr}/review-events`, {
      headers: { authorization: `Bearer ${ana}` },
    });
    assert.equal(anaEvents.status, 200);
    const eventsBody = (await anaEvents.json()) as any;
    assert.equal(eventsBody.events.length, 1);
    assert.equal(eventsBody.events[0].toStatus, "pending");

    // auditoria de seguranca: contem review.changed/denied/not_found,
    // mas NUNCA CNPJ aberto nem a note.
    const auditRaw = fs.readFileSync(auditPath, "utf8");
    assert.match(auditRaw, /"type":"review\.changed"/);
    assert.match(auditRaw, /"type":"review\.denied"/);
    assert.match(auditRaw, /"type":"review\.not_found"/);
    assert.ok(!auditRaw.includes(NOTE), "note nao pode aparecer na auditoria");
    assert.ok(!auditRaw.includes(CNPJ), "CNPJ aberto nao pode aparecer na auditoria");
    assert.ok(!auditRaw.includes("11.222.333/0001-81"), "CNPJ formatado aberto nao pode aparecer");
  } finally {
    restore(snap);
    fs.rmSync(dir, { recursive: true, force: true });
    await server.close();
  }
});

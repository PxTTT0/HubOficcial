import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { computeEffectiveDecision } from "../src/modules/makscore/decision/effective";
import { hashPassword } from "../src/security";

// ───────────── Unit ─────────────

test("computeEffectiveDecision: manual sobrepoe; sem review usa automatico", () => {
  assert.deepEqual(computeEffectiveDecision("reprovado", "approved"), {
    status: "aprovado", label: "Aprovado (análise manual)", source: "manual",
  });
  assert.deepEqual(computeEffectiveDecision("aprovado", "rejected"), {
    status: "reprovado", label: "Reprovado (análise manual)", source: "manual",
  });
  assert.equal(computeEffectiveDecision("aprovado", "pending").status, "exige_analise");
  assert.equal(computeEffectiveDecision("aprovado", "pending").source, "manual");
  // none -> espelha o outcome automatico
  const auto = computeEffectiveDecision("aprovado", "none");
  assert.deepEqual(auto, { status: "aprovado", label: "Aprovado", source: "automatic" });
  assert.equal(computeEffectiveDecision("exige_analise").source, "automatic");
});

// ───────────── HTTP: fluxo query -> review -> effectiveDecision ─────────────

const ENV_KEYS = [
  "NODE_ENV", "DATABASE_URL", "REDIS_URL", "AUDIT_LOG_PATH", "MAKSCORE_EPOSI_MODE",
  "MAKSCORE_CNPJ_PEPPER", "AUTH_SESSION_SECRET", "AUTH_SECURE_COOKIES",
  "AUTH_MFA_REQUIRED_ROLES", "AUTH_SESSION_BIND_IP_ROLES", "AUTH_USERS_JSON",
];
function snapshot() { return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); }
function restore(s: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]!; }
}

test("HTTP: effectiveDecision automatica na query e manual apos review", { concurrency: false }, async () => {
  const snap = snapshot();
  const hash = await hashPassword("SenhaForte123!", { memoryCost: 4096, timeCost: 2, parallelism: 1 });
  Object.assign(process.env, {
    NODE_ENV: "test", DATABASE_URL: "", REDIS_URL: "", AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock", MAKSCORE_CNPJ_PEPPER: "pep",
    AUTH_SESSION_SECRET: "effective-secret", AUTH_SECURE_COOKIES: "false",
    AUTH_MFA_REQUIRED_ROLES: "", AUTH_SESSION_BIND_IP_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "ana-1", username: "analista", role: "analista", passwordHash: hash },
    ]),
  });
  const { buildApp } = await import("../src/server");
  const { app } = buildApp();
  const server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("porta indisponivel");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "analista", password: "SenhaForte123!" }),
    });
    const token = ((await login.json()) as { token: string }).token;
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const q = await fetch(`${base}/api/makscore/query`, {
      method: "POST", headers: auth, body: JSON.stringify({ cnpj: "11222333000181" }),
    });
    const qBody = (await q.json()) as any;
    const corr = qBody.correlationId as string;
    // fresca: efetiva = automatica e espelha o outcome
    assert.equal(qBody.effectiveDecision.source, "automatic");
    assert.equal(qBody.effectiveDecision.status, qBody.outcome);

    // analista rejeita manualmente
    const rev = await fetch(`${base}/api/makscore/results/${corr}/review`, {
      method: "POST", headers: auth, body: JSON.stringify({ status: "rejected" }),
    });
    assert.equal(rev.status, 200);
    const revBody = (await rev.json()) as any;
    assert.equal(revBody.effectiveDecision.status, "reprovado");
    assert.equal(revBody.effectiveDecision.source, "manual");
    // outcome automatico permanece inalterado
    assert.equal(revBody.outcome, qBody.outcome);

    // /results reflete a decisao efetiva manual
    const detail = await fetch(`${base}/api/makscore/results/${corr}`, { headers: { authorization: `Bearer ${token}` } });
    const dBody = (await detail.json()) as any;
    assert.equal(dBody.effectiveDecision.status, "reprovado");
    assert.equal(dBody.effectiveDecision.source, "manual");
  } finally {
    restore(snap);
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});

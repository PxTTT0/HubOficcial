import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import {
  getQuestionnaireSchema,
  scoreQuestionnaire,
  QUESTIONNAIRE_TIERS,
  type MakScoreQuestionnaireAnswers,
} from "../src/modules/makscore/questionnaire";
import { hashPassword } from "../src/security";

// ───────────── Unit: schema = fonte unica ─────────────

test("getQuestionnaireSchema expoe version, pilares, listas e tiers", () => {
  const s = getQuestionnaireSchema();
  assert.equal(s.version, "makscore-v1");
  assert.equal(s.maxTotal, 250);
  assert.deepEqual(Object.keys(s.pillars).sort(), ["A", "B", "C", "D", "E"]);
  assert.ok(s.pillars.A.items.length > 0);
  assert.ok("key" in s.pillars.A.items[0] && "pts" in s.pillars.A.items[0]);
  assert.ok(s.aggravators.length > 0 && s.mitigators.length > 0 && s.blockers.length > 0);
  // tiers em ordem decrescente, ultimo com min 0
  const mins = s.tiers.map((t) => t.min);
  assert.deepEqual(mins, [...mins].sort((a, b) => b - a));
  assert.equal(s.tiers[s.tiers.length - 1].min, 0);
});

test("schema tiers são a mesma fonte usada por scoreQuestionnaire", () => {
  // Monta respostas que zeram tudo (total 0) -> classificacao E.
  const empty: MakScoreQuestionnaireAnswers = {
    version: "makscore-v1", bloqueios: {}, pilares: {}, agravantes: {}, mitigadores: {},
  };
  const score = scoreQuestionnaire(empty);
  const lastTier = QUESTIONNAIRE_TIERS[QUESTIONNAIRE_TIERS.length - 1];
  assert.equal(score.classification, lastTier.classification);
  assert.equal(score.label, lastTier.label);
  assert.equal(score.decision, lastTier.decision);

  // Bloqueio sobrepoe tiers.
  const blocked = { ...empty, bloqueios: { bl_cnpj_inapto: true } };
  assert.equal(scoreQuestionnaire(blocked).classification, "bloqueio");
});

// ───────────── HTTP: qualquer perfil autenticado obtem o schema ─────────────

const ENV_KEYS = [
  "NODE_ENV", "DATABASE_URL", "REDIS_URL", "AUDIT_LOG_PATH", "MAKSCORE_EPOSI_MODE",
  "AUTH_SESSION_SECRET", "AUTH_SECURE_COOKIES", "AUTH_MFA_REQUIRED_ROLES",
  "AUTH_SESSION_BIND_IP_ROLES", "AUTH_USERS_JSON",
];
function snapshot() { return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); }
function restore(s: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]!; }
}

test("GET /api/makscore/questionnaire: vendedor autenticado obtem schema", { concurrency: false }, async () => {
  const snap = snapshot();
  const hash = await hashPassword("SenhaForte123!", { memoryCost: 4096, timeCost: 2, parallelism: 1 });
  Object.assign(process.env, {
    NODE_ENV: "test", DATABASE_URL: "", REDIS_URL: "", AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock", AUTH_SESSION_SECRET: "q-schema-secret",
    AUTH_SECURE_COOKIES: "false", AUTH_MFA_REQUIRED_ROLES: "", AUTH_SESSION_BIND_IP_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "vend-1", username: "vendedor", role: "vendedor", passwordHash: hash },
    ]),
  });
  const { buildApp } = await import("../src/server");
  const { app } = buildApp();
  const server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("porta indisponivel");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    // sem auth -> 401
    const anon = await fetch(`${base}/api/makscore/questionnaire`);
    assert.equal(anon.status, 401);

    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "vendedor", password: "SenhaForte123!" }),
    });
    const token = ((await login.json()) as { token: string }).token;

    const res = await fetch(`${base}/api/makscore/questionnaire`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const schema = (await res.json()) as any;
    assert.equal(schema.version, "makscore-v1");
    assert.ok(schema.pillars.C.items.length > 0);
    assert.ok(Array.isArray(schema.tiers));
  } finally {
    restore(snap);
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { hashPassword } from "../src/security";

const ENV_KEYS = [
  "NODE_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "AUDIT_LOG_PATH",
  "MAKSCORE_EPOSI_MODE",
  "MAKSCORE_CNPJ_PEPPER",
  "MAKSCORE_RATE_LIMIT_PER_MIN",
  "AUTH_SESSION_SECRET",
  "AUTH_SECURE_COOKIES",
  "AUTH_MFA_REQUIRED_ROLES",
  "AUTH_SESSION_BIND_IP_ROLES",
  "AUTH_USERS_JSON",
];

function snapshot() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restore(s: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k]!;
  }
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
  return {
    base: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
  };
}

async function login(base: string, username: string, password: string) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return ((await r.json()) as { token: string }).token;
}

test("HTTP /prefill: shape, validacao e nao decide/persiste", { concurrency: false }, async () => {
  const snap = snapshot();
  const hash = await hashPassword("SenhaForte123!", { memoryCost: 4096, timeCost: 2, parallelism: 1 });
  const server = await startServer({
    NODE_ENV: "test",
    DATABASE_URL: "",
    REDIS_URL: "",
    AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock",
    MAKSCORE_CNPJ_PEPPER: "test-pep",
    MAKSCORE_RATE_LIMIT_PER_MIN: "1000",
    AUTH_SESSION_SECRET: "prefill-http-secret",
    AUTH_SECURE_COOKIES: "false",
    AUTH_MFA_REQUIRED_ROLES: "",
    AUTH_SESSION_BIND_IP_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "vend-1", username: "vendedor", role: "vendedor", passwordHash: hash },
    ]),
  });

  try {
    const token = await login(server.base, "vendedor", "SenhaForte123!");
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    // CNPJ "feliz" (sufixo 81): score alto (~725) + cadastral ativa
    const r = await fetch(`${server.base}/api/makscore/prefill`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ cnpj: "11222333000181" }),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    // Shape esperado: sem decisao, sem persistencia, com snapshot + sugestao
    assert.equal(typeof body.cadastralStatus, "string");
    assert.equal(typeof body.hasNegativacao, "boolean");
    assert.equal(typeof body.hasProtesto, "boolean");
    assert.ok(body.suggestion);
    assert.ok(body.suggestion.answers);
    assert.ok(Array.isArray(body.suggestion.sources));
    // Sem campos de decisao (regression: prefill nunca chama o engine).
    assert.equal(body.outcome, undefined);
    assert.equal(body.primaryRule, undefined);
    assert.equal(body.effectiveDecision, undefined);
    assert.equal(body.correlationId, undefined);
    // Sem CNPJ aberto em nenhuma propriedade (defesa de minimizacao).
    assert.ok(!JSON.stringify(body).includes("11222333000181"));

    // CNPJ invalido (sintaticamente curto) -> 400 por schema
    const bad = await fetch(`${server.base}/api/makscore/prefill`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ cnpj: "123" }),
    });
    assert.equal(bad.status, 400);

    // CNPJ com tamanho correto mas check-digit invalido -> 422
    const invalid = await fetch(`${server.base}/api/makscore/prefill`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ cnpj: "00000000000000" }),
    });
    assert.equal(invalid.status, 422);

    // Vendedor consultou e NAO gerou linha em /history (prefill nao
    // persiste). Como sem PG roda InMemory, o repo deveria estar vazio.
    const hist = await fetch(`${server.base}/api/makscore/history`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const histBody = (await hist.json()) as any;
    assert.equal(histBody.total, 0, "prefill nao pode gerar linha no historico");
  } finally {
    restore(snap);
    await server.close();
  }
});

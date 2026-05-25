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
  "AUTH_SESSION_SECRET",
  "AUTH_SECURE_COOKIES",
  "AUTH_ALLOW_DEV_HEADER_AUTH",
  "AUTH_MFA_REQUIRED_ROLES",
  "AUTH_SESSION_BIND_IP_ROLES",
  "AUTH_USERS_JSON",
];

function snapshot(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restore(s: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (s[k] === undefined) delete process.env[k];
    else process.env[k] = s[k]!;
  }
}

async function fastHash(pw: string): Promise<string> {
  return hashPassword(pw, { memoryCost: 4096, timeCost: 2, parallelism: 1 });
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
    close: () =>
      new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  };
}

async function login(base: string, username: string, password: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = (await r.json()) as { token: string };
  return body.token;
}

const CNPJ = "11222333000181";

test("MakScore history/results: RBAC + projecao por perfil + sem vazamento", { concurrency: false }, async () => {
  const snap = snapshot();
  const vendedorHash = await fastHash("SenhaForte123!");
  const analistaHash = await fastHash("SenhaForte123!");
  const server = await startServer({
    NODE_ENV: "test",
    DATABASE_URL: "", // InMemory repo
    REDIS_URL: "",
    AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock",
    MAKSCORE_CNPJ_PEPPER: "test-pepper",
    AUTH_SESSION_SECRET: "history-rbac-secret",
    AUTH_SECURE_COOKIES: "false",
    AUTH_ALLOW_DEV_HEADER_AUTH: "false",
    AUTH_MFA_REQUIRED_ROLES: "",
    AUTH_SESSION_BIND_IP_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "vend-1", username: "vendedor", role: "vendedor", passwordHash: vendedorHash },
      { id: "ana-1", username: "analista", role: "analista", passwordHash: analistaHash },
    ]),
  });

  try {
    const vendToken = await login(server.base, "vendedor", "SenhaForte123!");
    const anaToken = await login(server.base, "analista", "SenhaForte123!");

    // vendedor faz uma consulta
    const q = await fetch(`${server.base}/api/makscore/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${vendToken}`, "content-type": "application/json" },
      body: JSON.stringify({ cnpj: CNPJ, proposalId: "prop-9" }),
    });
    assert.equal(q.status, 200);
    const qBody = (await q.json()) as any;
    const corr = qBody.correlationId as string;
    // projecao do vendedor: sem campos tecnicos; riskLevel presente
    assert.equal(qBody.primaryRule, undefined);
    assert.equal(qBody.ruleHits, undefined);
    assert.equal(qBody.errorCode, undefined);
    assert.ok(typeof qBody.riskLevel === "string");
    // minimizacao: /query retorna CNPJ MASCARADO (nunca o aberto).
    assert.match(qBody.cnpj, /^\d{2}\.\*\*\*\.\*\*\*\/\*\*\*\*-\d{2}$/);

    // history do vendedor: so as proprias, sem tecnicos
    const vh = await fetch(`${server.base}/api/makscore/history`, {
      headers: { authorization: `Bearer ${vendToken}` },
    });
    assert.equal(vh.status, 200);
    const vhBody = (await vh.json()) as any;
    assert.ok(vhBody.items.length >= 1);
    for (const it of vhBody.items) {
      assert.equal(it.primaryRule, undefined);
      assert.equal(it.ruleHits, undefined);
      // historico/persistencia: CNPJ mascarado (asteriscos), nunca aberto.
      assert.match(it.cnpj, /\*\*\*/);
    }

    // result detail proprio (vendedor) -> 200, sem tecnicos
    const vr = await fetch(`${server.base}/api/makscore/results/${corr}`, {
      headers: { authorization: `Bearer ${vendToken}` },
    });
    assert.equal(vr.status, 200);
    const vrBody = (await vr.json()) as any;
    assert.equal(vrBody.ruleHits, undefined);
    assert.equal(vrBody.reviewStatus, undefined);
    assert.match(vrBody.cnpj, /\*\*\*/);

    // analista ve a consulta do vendedor com campos tecnicos + reviewStatus
    const ar = await fetch(`${server.base}/api/makscore/results/${corr}`, {
      headers: { authorization: `Bearer ${anaToken}` },
    });
    assert.equal(ar.status, 200);
    const arBody = (await ar.json()) as any;
    assert.ok(typeof arBody.primaryRule === "string");
    assert.ok(Array.isArray(arBody.ruleHits));
    assert.equal(arBody.reviewStatus, "none");

    // analista history geral inclui a do vendedor
    const ah = await fetch(`${server.base}/api/makscore/history`, {
      headers: { authorization: `Bearer ${anaToken}` },
    });
    const ahBody = (await ah.json()) as any;
    assert.ok(ahBody.items.some((i: any) => i.correlationId === corr));

    // vendedor NAO acessa consulta de terceiro: analista consulta e vendedor tenta ver
    const anaQ = await fetch(`${server.base}/api/makscore/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${anaToken}`, "content-type": "application/json" },
      body: JSON.stringify({ cnpj: CNPJ }),
    });
    const anaCorr = ((await anaQ.json()) as any).correlationId as string;
    const denied = await fetch(`${server.base}/api/makscore/results/${anaCorr}`, {
      headers: { authorization: `Bearer ${vendToken}` },
    });
    assert.equal(denied.status, 404, "vendedor nao ve consulta de terceiro");

    // nenhum endpoint expoe CNPJ aberto (nem digits, nem formatado aberto)
    const CNPJ_FORMATTED = "11.222.333/0001-81";
    for (const b of [qBody, vhBody, vrBody, arBody, ahBody]) {
      const blob = JSON.stringify(b);
      assert.ok(!blob.includes(CNPJ), "CNPJ em digitos vazou");
      assert.ok(!blob.includes(CNPJ_FORMATTED), "CNPJ formatado aberto vazou");
    }
  } finally {
    restore(snap);
    await server.close();
  }
});

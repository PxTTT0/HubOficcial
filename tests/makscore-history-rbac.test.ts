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

test("MakScore history: paginacao (total/hasMore/offset) + filtros + vendedor-own", { concurrency: false }, async () => {
  const snap = snapshot();
  const vendedorHash = await fastHash("SenhaForte123!");
  const analistaHash = await fastHash("SenhaForte123!");
  const server = await startServer({
    NODE_ENV: "test",
    DATABASE_URL: "",
    REDIS_URL: "",
    AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock",
    MAKSCORE_CNPJ_PEPPER: "test-pepper",
    MAKSCORE_RATE_LIMIT_PER_MIN: "1000",
    AUTH_SESSION_SECRET: "history-page-secret",
    AUTH_SECURE_COOKIES: "false",
    AUTH_ALLOW_DEV_HEADER_AUTH: "false",
    AUTH_MFA_REQUIRED_ROLES: "",
    AUTH_SESSION_BIND_IP_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "vend-1", username: "vendedor", role: "vendedor", passwordHash: vendedorHash },
      { id: "vend-2", username: "vendedor2", role: "vendedor", passwordHash: vendedorHash },
      { id: "ana-1", username: "analista", role: "analista", passwordHash: analistaHash },
    ]),
  });

  try {
    const vendToken = await login(server.base, "vendedor", "SenhaForte123!");
    const vend2Token = await login(server.base, "vendedor2", "SenhaForte123!");
    const anaToken = await login(server.base, "analista", "SenhaForte123!");

    // vend-1: 3 consultas; vend-2: 1 consulta
    for (let i = 0; i < 3; i++) {
      await fetch(`${server.base}/api/makscore/query`, {
        method: "POST",
        headers: { authorization: `Bearer ${vendToken}`, "content-type": "application/json" },
        body: JSON.stringify({ cnpj: CNPJ, forceRefresh: true }),
      });
    }
    await fetch(`${server.base}/api/makscore/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${vend2Token}`, "content-type": "application/json" },
      body: JSON.stringify({ cnpj: CNPJ, forceRefresh: true }),
    });

    // vendedor: paginacao limit=2 -> total=3, hasMore=true na 1a pagina
    const p1 = await fetch(`${server.base}/api/makscore/history?limit=2&offset=0`, {
      headers: { authorization: `Bearer ${vendToken}` },
    });
    const p1Body = (await p1.json()) as any;
    assert.equal(p1Body.total, 3, "vendedor ve so as 3 proprias");
    assert.equal(p1Body.items.length, 2);
    assert.equal(p1Body.hasMore, true);
    assert.equal(p1Body.offset, 0);

    const p2 = await fetch(`${server.base}/api/makscore/history?limit=2&offset=2`, {
      headers: { authorization: `Bearer ${vendToken}` },
    });
    const p2Body = (await p2.json()) as any;
    assert.equal(p2Body.items.length, 1);
    assert.equal(p2Body.hasMore, false);

    // vendedor NAO consegue ver de terceiro mesmo passando userId na query
    const spoof = await fetch(`${server.base}/api/makscore/history?userId=vend-2`, {
      headers: { authorization: `Bearer ${vendToken}` },
    });
    const spoofBody = (await spoof.json()) as any;
    assert.equal(spoofBody.total, 3, "userId da query e ignorado p/ vendedor");

    // analista: total geral = 4; filtro por outcome=aprovado retorna so aprovados
    const all = await fetch(`${server.base}/api/makscore/history?limit=50`, {
      headers: { authorization: `Bearer ${anaToken}` },
    });
    const allBody = (await all.json()) as any;
    assert.equal(allBody.total, 4);

    const onlyAp = await fetch(`${server.base}/api/makscore/history?outcome=aprovado&limit=50`, {
      headers: { authorization: `Bearer ${anaToken}` },
    });
    const onlyApBody = (await onlyAp.json()) as any;
    for (const it of onlyApBody.items) assert.equal(it.outcome, "aprovado");

    // analista filtra por userId=vend-2 -> total=1
    const byUser = await fetch(`${server.base}/api/makscore/history?userId=vend-2&limit=50`, {
      headers: { authorization: `Bearer ${anaToken}` },
    });
    const byUserBody = (await byUser.json()) as any;
    assert.equal(byUserBody.total, 1);

    // query invalida (limit > 200) -> 400
    const bad = await fetch(`${server.base}/api/makscore/history?limit=999`, {
      headers: { authorization: `Bearer ${vendToken}` },
    });
    assert.equal(bad.status, 400);
  } finally {
    restore(snap);
    await server.close();
  }
});

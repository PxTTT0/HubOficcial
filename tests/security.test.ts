import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { hashPassword, verifyPassword } from "../src/security";

function asJson<T>(value: unknown): T {
  return value as T;
}

async function startServer(env: Record<string, string>) {
  // Snapshot dos valores anteriores das chaves que vamos sobrescrever.
  // Sem isso, qualquer env setado aqui (ex.: RATE_LIMIT_PER_MIN="1") vaza
  // p/ os testes seguintes na mesma execucao, poluindo o estado global.
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) prev[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  const { buildApp } = await import("../src/server");
  const { app } = buildApp();
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Nao foi possivel obter a porta de teste");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      // Restaura os valores originais (incluindo unset se nao existiam).
      for (const key of Object.keys(env)) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key]!;
      }
    },
  };
}

test("argon2id gera hash verificavel", { concurrency: false }, async () => {
  const password = "SenhaForte123!";
  const hash = await hashPassword(password, {
    memoryCost: 4096,
    timeCost: 2,
    parallelism: 1,
  });
  assert.notEqual(hash, password);
  assert.ok(hash.startsWith("$argon2id$"));
  assert.equal(await verifyPassword(hash, password), true);
  assert.equal(await verifyPassword(hash, "outra-senha"), false);
});

test("login cria sessao assinada e rotas protegidas exigem autenticacao real", { concurrency: false }, async () => {
  const passwordHash = await hashPassword("SenhaForte123!", {
    memoryCost: 4096,
    timeCost: 2,
    parallelism: 1,
  });
  const analystHash = await hashPassword("AnalistaForte123!", {
    memoryCost: 4096,
    timeCost: 2,
    parallelism: 1,
  });
  const server = await startServer({
    NODE_ENV: "test",
    AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock",
    AUTH_SESSION_SECRET: "test-session-secret",
    AUTH_ALLOW_DEV_HEADER_AUTH: "false",
    AUTH_SECURE_COOKIES: "false",
    AUTH_TRUSTED_ORIGINS: "http://localhost:5173",
    AUTH_MFA_REQUIRED_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "seller-1", username: "seller", role: "vendedor", passwordHash },
      { id: "analyst-1", username: "analyst", role: "analista", passwordHash: analystHash },
    ]),
  });

  try {
    const unauthorized = await fetch(`${server.baseUrl}/api/makscore/health`, {
      headers: { "x-user-id": "legacy-user", "x-user-role": "admin" },
    });
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ username: "seller", password: "SenhaForte123!" }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.equal(login.headers.get("x-content-type-options"), "nosniff");
    assert.match(login.headers.get("set-cookie") ?? "", /HttpOnly/);
    const loginBody = asJson<{ token: string }>(await login.json());
    assert.ok(typeof loginBody.token === "string" && loginBody.token.length > 20);

    const me = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    assert.equal(me.status, 200);
    const meBody = (await me.json()) as { user: unknown; mfa: unknown };
    assert.deepEqual(meBody.user, { id: "seller-1", role: "vendedor" });
    assert.deepEqual(meBody.mfa, { enabled: false, required: false, enrollmentPending: false });

    const query = await fetch(`${server.baseUrl}/api/makscore/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${loginBody.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ cnpj: "11222333000181" }),
    });
    assert.equal(query.status, 200);
    const queryBody = asJson<Record<string, unknown>>(await query.json());
    assert.equal("primaryRule" in queryBody, false);
    assert.equal("errorCode" in queryBody, false);

    const analystLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "analyst", password: "AnalistaForte123!" }),
    });
    const analystBody = asJson<{ token: string }>(await analystLogin.json());
    const audit = await fetch(`${server.baseUrl}/api/makscore/audit/recent`, {
      headers: { authorization: `Bearer ${analystBody.token}` },
    });
    assert.equal(audit.status, 200);
  } finally {
    await server.close();
  }
});

test("rate limits bloqueiam login e consultas repetidas", { concurrency: false }, async () => {
  const passwordHash = await hashPassword("SenhaForte123!", {
    memoryCost: 4096,
    timeCost: 2,
    parallelism: 1,
  });
  const server = await startServer({
    NODE_ENV: "test",
    AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock",
    MAKSCORE_RATE_LIMIT_PER_MIN: "1",
    AUTH_SESSION_SECRET: "rate-limit-secret",
    AUTH_ALLOW_DEV_HEADER_AUTH: "false",
    AUTH_LOGIN_RATE_LIMIT_PER_MIN: "1",
    AUTH_SECURE_COOKIES: "false",
    AUTH_MFA_REQUIRED_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "seller-1", username: "seller", role: "vendedor", passwordHash },
    ]),
  });

  try {
    const firstLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "seller", password: "SenhaForte123!" }),
    });
    assert.equal(firstLogin.status, 200);
    const firstLoginBody = asJson<{ token: string }>(await firstLogin.json());

    const secondLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "seller", password: "SenhaForte123!" }),
    });
    assert.equal(secondLogin.status, 429);
    assert.ok(secondLogin.headers.get("retry-after"));

    const firstQuery = await fetch(`${server.baseUrl}/api/makscore/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${firstLoginBody.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ cnpj: "11222333000181" }),
    });
    assert.equal(firstQuery.status, 200);

    const secondQuery = await fetch(`${server.baseUrl}/api/makscore/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${firstLoginBody.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ cnpj: "11222333000181", forceRefresh: true }),
    });
    assert.equal(secondQuery.status, 429);
    assert.ok(secondQuery.headers.get("retry-after"));
  } finally {
    await server.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { hashPassword } from "../src/security";

async function startServer(env: Record<string, string>) {
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
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

async function fastHash(password: string): Promise<string> {
  return hashPassword(password, { memoryCost: 4096, timeCost: 2, parallelism: 1 });
}

function extractCookie(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null;
  for (const part of setCookieHeader.split(/,(?=\s*\w+=)/)) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const value = trimmed.split(";")[0].slice(name.length + 1);
      return decodeURIComponent(value);
    }
  }
  return null;
}

async function login(
  baseUrl: string,
  username: string,
  password: string,
): Promise<{ token: string; csrfToken: string; cookieHeader: string }> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) throw new Error(`login falhou: ${res.status}`);
  const body = (await res.json()) as { token: string; csrfToken: string };
  const setCookie = res.headers.get("set-cookie");
  const sid = extractCookie(setCookie, "hub_sid");
  const csrf = extractCookie(setCookie, "hub_csrf");
  if (!sid || !csrf) throw new Error("cookies nao foram emitidos pelo login");
  return {
    token: body.token,
    csrfToken: body.csrfToken,
    cookieHeader: `hub_sid=${encodeURIComponent(sid)}; hub_csrf=${encodeURIComponent(csrf)}`,
  };
}

test(
  "CSRF: cookie sem token CSRF e bloqueado em metodos mutaveis",
  { concurrency: false },
  async () => {
    const passwordHash = await fastHash("SenhaForte123!");
    const server = await startServer({
      NODE_ENV: "test",
      AUDIT_LOG_PATH: "",
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "csrf-test-1",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_MFA_REQUIRED_ROLES: "",
      AUTH_SESSION_BIND_IP_ROLES: "",
      AUTH_TRUSTED_ORIGINS: "http://localhost:5173",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "seller-1", username: "seller", role: "vendedor", passwordHash },
      ]),
    });

    try {
      const session = await login(server.baseUrl, "seller", "SenhaForte123!");

      // POST com cookie SEM X-CSRF-Token e bloqueado.
      const missing = await fetch(`${server.baseUrl}/api/makscore/query`, {
        method: "POST",
        headers: {
          cookie: session.cookieHeader,
          "content-type": "application/json",
        },
        body: JSON.stringify({ cnpj: "11222333000181" }),
      });
      assert.equal(missing.status, 403);
      assert.deepEqual(await missing.json(), { error: "csrf_token_missing" });

      // POST com cookie e token CSRF errado e bloqueado.
      const wrong = await fetch(`${server.baseUrl}/api/makscore/query`, {
        method: "POST",
        headers: {
          cookie: session.cookieHeader,
          "content-type": "application/json",
          "x-csrf-token": "token-falso",
        },
        body: JSON.stringify({ cnpj: "11222333000181" }),
      });
      assert.equal(wrong.status, 403);
      assert.deepEqual(await wrong.json(), { error: "csrf_token_invalid" });

      // POST com cookie + token correto passa.
      const ok = await fetch(`${server.baseUrl}/api/makscore/query`, {
        method: "POST",
        headers: {
          cookie: session.cookieHeader,
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
        },
        body: JSON.stringify({ cnpj: "11222333000181" }),
      });
      assert.equal(ok.status, 200);

      // GET com cookie sem CSRF passa (metodo seguro).
      const safe = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { cookie: session.cookieHeader },
      });
      assert.equal(safe.status, 200);

      // Bearer sem cookie nao precisa de CSRF.
      const bearer = await fetch(`${server.baseUrl}/api/makscore/query`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ cnpj: "11222333000181" }),
      });
      assert.equal(bearer.status, 200);
    } finally {
      await server.close();
    }
  },
);

test(
  "CSRF: Origin fora da allowlist e rejeitado em metodos mutaveis",
  { concurrency: false },
  async () => {
    const passwordHash = await fastHash("SenhaForte123!");
    const server = await startServer({
      NODE_ENV: "test",
      AUDIT_LOG_PATH: "",
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "csrf-test-2",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_MFA_REQUIRED_ROLES: "",
      AUTH_SESSION_BIND_IP_ROLES: "",
      AUTH_TRUSTED_ORIGINS: "http://localhost:5173",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "seller-1", username: "seller", role: "vendedor", passwordHash },
      ]),
    });

    try {
      const malicious = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ username: "seller", password: "SenhaForte123!" }),
      });
      assert.equal(malicious.status, 403);
      assert.deepEqual(await malicious.json(), { error: "csrf_origin_invalid" });
    } finally {
      await server.close();
    }
  },
);

test(
  "Sessao: idle timeout invalida sessao apos inatividade",
  { concurrency: false },
  async () => {
    const passwordHash = await fastHash("SenhaForte123!");
    const server = await startServer({
      NODE_ENV: "test",
      AUDIT_LOG_PATH: "",
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "idle-test",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_MFA_REQUIRED_ROLES: "",
      AUTH_SESSION_BIND_IP_ROLES: "",
      AUTH_SESSION_IDLE_MS: "500",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "seller-1", username: "seller", role: "vendedor", passwordHash },
      ]),
    });

    try {
      const login1 = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "seller", password: "SenhaForte123!" }),
      });
      const body = (await login1.json()) as { token: string };

      // Logo apos login a sessao funciona.
      const fresh = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${body.token}` },
      });
      assert.equal(fresh.status, 200);

      await new Promise((r) => setTimeout(r, 700));

      // Apos 700ms de inatividade (idle=500ms), sessao foi expirada.
      const stale = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${body.token}` },
      });
      assert.equal(stale.status, 401);
    } finally {
      // Reseta idle para nao contaminar testes seguintes.
      delete process.env.AUTH_SESSION_IDLE_MS;
      await server.close();
    }
  },
);

test(
  "Sessao: IP-binding bloqueia roubo de cookie de outra origem",
  { concurrency: false },
  async () => {
    const adminHash = await fastHash("AdminForte123!");
    const server = await startServer({
      NODE_ENV: "test",
      AUDIT_LOG_PATH: "",
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "ip-bind-test",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_TRUST_PROXY: "true",
      AUTH_MFA_REQUIRED_ROLES: "",
      AUTH_SESSION_BIND_IP_ROLES: "admin",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "admin-1", username: "admin", role: "admin", passwordHash: adminHash },
      ]),
    });

    try {
      // Login forjando IP de origem 10.0.0.1 via X-Forwarded-For.
      const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.0.0.1",
        },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      assert.equal(loginRes.status, 200);
      const body = (await loginRes.json()) as { token: string };

      // Mesmo IP -> ok.
      const same = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: {
          authorization: `Bearer ${body.token}`,
          "x-forwarded-for": "10.0.0.1",
        },
      });
      assert.equal(same.status, 200);

      // IP diferente -> sessao invalidada.
      const other = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: {
          authorization: `Bearer ${body.token}`,
          "x-forwarded-for": "203.0.113.5",
        },
      });
      assert.equal(other.status, 401);

      // Sessao foi destruida (mesmo voltando ao IP original deve falhar).
      const back = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: {
          authorization: `Bearer ${body.token}`,
          "x-forwarded-for": "10.0.0.1",
        },
      });
      assert.equal(back.status, 401);
    } finally {
      delete process.env.AUTH_SESSION_BIND_IP_ROLES;
      await server.close();
    }
  },
);

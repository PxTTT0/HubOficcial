import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import {
  hashPassword,
  loadSecurityConfig,
  validatePasswordPolicy,
} from "../src/security";
import { ProductionSecurityError } from "../src/security/bootstrap";

const SECURITY_ENV_KEYS = [
  "NODE_ENV",
  "AUDIT_LOG_PATH",
  "AUDIT_MEMORY_RETAIN",
  "MAKSCORE_CNPJ_PEPPER",
  "MAKSCORE_EPOSI_MODE",
  "AUTH_SESSION_SECRET",
  "AUTH_SECURE_COOKIES",
  "AUTH_TRUSTED_ORIGINS",
  "AUTH_ALLOW_DEV_HEADER_AUTH",
  "AUTH_MFA_REQUIRED_ROLES",
  "AUTH_SESSION_BIND_IP_ROLES",
  "AUTH_USERS_JSON",
  "AUTH_PASSWORD_MIN_LENGTH",
  "AUTH_PASSWORD_REQUIRE_LOWERCASE",
  "AUTH_PASSWORD_REQUIRE_UPPERCASE",
  "AUTH_PASSWORD_REQUIRE_NUMBER",
  "AUTH_PASSWORD_REQUIRE_SYMBOL",
];

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(SECURITY_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of SECURITY_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

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
  if (!address || typeof address === "string") throw new Error("porta indisponivel");
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

test("Producao: startup falha fechado quando configuracao critica esta ausente", { concurrency: false }, async () => {
  const env = snapshotEnv();
  try {
    process.env.NODE_ENV = "production";
    process.env.AUTH_SESSION_SECRET = "dev-insecure-session-secret-change-me";
    process.env.AUTH_SECURE_COOKIES = "false";
    process.env.AUTH_TRUSTED_ORIGINS = "";
    process.env.MAKSCORE_CNPJ_PEPPER = "";
    process.env.AUDIT_LOG_PATH = "";
    process.env.AUTH_ALLOW_DEV_HEADER_AUTH = "true";

    const { buildApp } = await import("../src/server");
    assert.throws(
      () => buildApp(),
      (err: unknown) => {
        assert.ok(err instanceof ProductionSecurityError);
        const message = err.message;
        assert.match(message, /AUTH_SESSION_SECRET/);
        assert.match(message, /AUTH_SECURE_COOKIES/);
        assert.match(message, /AUTH_TRUSTED_ORIGINS/);
        assert.match(message, /MAKSCORE_CNPJ_PEPPER/);
        assert.match(message, /AUDIT_LOG_PATH/);
        return true;
      },
    );
  } finally {
    restoreEnv(env);
  }
});

test("Producao: AUTH_ALLOW_DEV_HEADER_AUTH e sempre false mesmo se env tentar habilitar", { concurrency: false }, () => {
  const env = snapshotEnv();
  try {
    process.env.NODE_ENV = "production";
    process.env.AUTH_ALLOW_DEV_HEADER_AUTH = "true";
    assert.equal(loadSecurityConfig().allowDevHeaderAuth, false);
  } finally {
    restoreEnv(env);
  }
});

test("Politica de senha bloqueia senhas fracas e aceita senha forte", () => {
  assert.equal(validatePasswordPolicy("SenhaForte123!").ok, true);
  assert.equal(validatePasswordPolicy("senha123").ok, false);
  assert.equal(validatePasswordPolicy("SenhaForte123").ok, false);
  assert.equal(validatePasswordPolicy("SENHAFORTE123!").ok, false);
  assert.equal(validatePasswordPolicy("SenhaForte!").ok, false);
});

test("API publica operacional: /healthz e publico, MakScore segue protegido", { concurrency: false }, async () => {
  const env = snapshotEnv();
  const passwordHash = await fastHash("SenhaForte123!");
  const server = await startServer({
    NODE_ENV: "test",
    AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock",
    AUTH_SESSION_SECRET: "hardening-health-test",
    AUTH_ALLOW_DEV_HEADER_AUTH: "false",
    AUTH_SECURE_COOKIES: "false",
    AUTH_MFA_REQUIRED_ROLES: "",
    AUTH_SESSION_BIND_IP_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "seller-1", username: "seller", role: "vendedor", passwordHash },
    ]),
  });
  try {
    const health = await fetch(`${server.baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const makscoreHealth = await fetch(`${server.baseUrl}/api/makscore/health`);
    assert.equal(makscoreHealth.status, 401);

    const makscoreQuery = await fetch(`${server.baseUrl}/api/makscore/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cnpj: "11222333000181" }),
    });
    assert.equal(makscoreQuery.status, 401);
  } finally {
    restoreEnv(env);
    await server.close();
  }
});

test("Auditoria cobre RBAC negado e rate limit MakScore", { concurrency: false }, async () => {
  const env = snapshotEnv();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-hardening-audit-"));
  const auditPath = path.join(dir, "audit.jsonl");
  const sellerHash = await fastHash("SenhaForte123!");
  const server = await startServer({
    NODE_ENV: "test",
    AUDIT_LOG_PATH: auditPath,
    MAKSCORE_EPOSI_MODE: "mock",
    MAKSCORE_RATE_LIMIT_PER_MIN: "1",
    AUTH_SESSION_SECRET: "hardening-audit-test",
    AUTH_ALLOW_DEV_HEADER_AUTH: "false",
    AUTH_SECURE_COOKIES: "false",
    AUTH_MFA_REQUIRED_ROLES: "",
    AUTH_SESSION_BIND_IP_ROLES: "",
    AUTH_USERS_JSON: JSON.stringify([
      { id: "seller-1", username: "seller", role: "vendedor", passwordHash: sellerHash },
    ]),
  });

  try {
    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "seller", password: "SenhaForte123!" }),
    });
    const token = ((await login.json()) as { token: string }).token;

    const denied = await fetch(`${server.baseUrl}/api/makscore/audit/recent`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(denied.status, 403);

    const firstQuery = await fetch(`${server.baseUrl}/api/makscore/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ cnpj: "11222333000181" }),
    });
    assert.equal(firstQuery.status, 200);

    const secondQuery = await fetch(`${server.baseUrl}/api/makscore/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ cnpj: "11222333000181", forceRefresh: true }),
    });
    assert.equal(secondQuery.status, 429);

    const raw = fs.readFileSync(auditPath, "utf8");
    assert.match(raw, /"type":"rbac.denied"/);
    assert.match(raw, /"scope":"makscore"/);
    assert.match(raw, /"type":"query.rate_limited"/);
  } finally {
    restoreEnv(env);
    fs.rmSync(dir, { recursive: true, force: true });
    await server.close();
  }
});

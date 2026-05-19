import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import {
  generateTotpCode,
  hashPassword,
  JsonlSecurityAuditSink,
  type SecurityAuditEvent,
} from "../src/security";

async function startServer(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  const { buildApp } = await import("../src/server");
  const { app, security } = buildApp();
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("porta indisponivel");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    security,
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

function readJsonl(filePath: string): SecurityAuditEvent[] {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as SecurityAuditEvent);
}

function tempAuditFile(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hub-audit-${label}-`));
  return path.join(dir, "audit.jsonl");
}

test(
  "Auditoria persistente: login.success/failure e logout sao gravados em JSONL",
  { concurrency: false },
  async () => {
    const passwordHash = await fastHash("SenhaForte123!");
    const auditPath = tempAuditFile("login");

    const server = await startServer({
      NODE_ENV: "test",
      AUDIT_LOG_PATH: auditPath,
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "audit-test-1",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_MFA_REQUIRED_ROLES: "",
      AUTH_SESSION_BIND_IP_ROLES: "",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "seller-1", username: "seller", role: "vendedor", passwordHash },
      ]),
    });

    try {
      // login com senha errada
      await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "seller", password: "ErradoErrado1!" }),
      });
      // login OK
      const ok = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "seller", password: "SenhaForte123!" }),
      });
      const body = (await ok.json()) as { token: string };
      // logout
      await fetch(`${server.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${body.token}` },
      });

      const events = readJsonl(auditPath);
      const types = events.map((e) => e.type);
      assert.ok(types.includes("login.failure"), `faltou login.failure em ${types.join(",")}`);
      assert.ok(types.includes("login.success"));
      assert.ok(types.includes("logout"));

      const failure = events.find((e) => e.type === "login.failure");
      assert.equal(failure?.outcome, "failure");
      assert.equal(failure?.reason, "bad_password");
      assert.equal(failure?.actor?.username, "seller");

      const success = events.find((e) => e.type === "login.success");
      assert.equal(success?.outcome, "success");
      assert.equal(success?.actor?.userId, "seller-1");
      assert.equal(typeof success?.ip, "string");

      // Nenhum evento contem senha em claro.
      for (const ev of events) {
        const serialized = JSON.stringify(ev);
        assert.equal(serialized.includes("SenhaForte123!"), false);
        assert.equal(serialized.includes("ErradoErrado1!"), false);
      }
    } finally {
      fs.rmSync(path.dirname(auditPath), { recursive: true, force: true });
      await server.close();
    }
  },
);

test(
  "Auditoria persistente: fluxo MFA gera challenge_issued, mfa.success e enroll.completed",
  { concurrency: false },
  async () => {
    const adminHash = await fastHash("AdminForte123!");
    const auditPath = tempAuditFile("mfa");

    const server = await startServer({
      NODE_ENV: "test",
      AUDIT_LOG_PATH: auditPath,
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "audit-test-mfa",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_MFA_REQUIRED_ROLES: "admin",
      AUTH_SESSION_BIND_IP_ROLES: "",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "admin-1", username: "admin", role: "admin", passwordHash: adminHash },
      ]),
    });

    try {
      // 1) Login -> sessao enrollmentPending.
      const login1 = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      const login1Body = (await login1.json()) as { token: string };

      // 2) Enroll + verify
      const enroll = await fetch(`${server.baseUrl}/api/auth/mfa/enroll`, {
        method: "POST",
        headers: { authorization: `Bearer ${login1Body.token}` },
      });
      const enrollBody = (await enroll.json()) as { secret: string };
      const verify = await fetch(`${server.baseUrl}/api/auth/mfa/verify-enrollment`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${login1Body.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: generateTotpCode(enrollBody.secret) }),
      });
      const verifyBody = (await verify.json()) as { token: string };

      // 3) Logout
      await fetch(`${server.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${verifyBody.token}` },
      });

      // 4) Login MFA (passo 1 + passo 2)
      const login2 = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      const login2Body = (await login2.json()) as { challengeToken: string };

      // 4a) Codigo errado (gera mfa.failure)
      await fetch(`${server.baseUrl}/api/auth/login/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: login2Body.challengeToken,
          code: "000000",
        }),
      });

      // 4b) Codigo certo
      await fetch(`${server.baseUrl}/api/auth/login/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: login2Body.challengeToken,
          code: generateTotpCode(enrollBody.secret),
        }),
      });

      const events = readJsonl(auditPath);
      const types = events.map((e) => e.type);

      assert.ok(types.includes("mfa.enroll.started"));
      assert.ok(types.includes("mfa.enroll.completed"));
      assert.ok(types.includes("login.mfa.challenge_issued"));
      assert.ok(types.includes("login.mfa.failure"));
      assert.ok(types.includes("login.mfa.success"));

      const enrollDone = events.find((e) => e.type === "mfa.enroll.completed");
      assert.equal(enrollDone?.details?.rotatedSid, true);
      assert.equal(enrollDone?.details?.recoveryCodeCount, 10);

      const mfaFail = events.find((e) => e.type === "login.mfa.failure");
      assert.equal(mfaFail?.reason, "invalid_totp");

      // Nenhum segredo TOTP nem codigo em claro vazaram para o log.
      for (const ev of events) {
        const serialized = JSON.stringify(ev);
        assert.equal(
          serialized.includes(enrollBody.secret),
          false,
          "secret TOTP nao deve aparecer no log",
        );
      }
    } finally {
      fs.rmSync(path.dirname(auditPath), { recursive: true, force: true });
      await server.close();
    }
  },
);

test(
  "Auditoria persistente: violacoes de CSRF e sessao geram eventos warn/high",
  { concurrency: false },
  async () => {
    const adminHash = await fastHash("AdminForte123!");
    const auditPath = tempAuditFile("policy");

    const server = await startServer({
      NODE_ENV: "test",
      AUDIT_LOG_PATH: auditPath,
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "audit-test-policy",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_TRUST_PROXY: "true",
      AUTH_TRUSTED_ORIGINS: "http://localhost:5173",
      AUTH_MFA_REQUIRED_ROLES: "",
      AUTH_SESSION_BIND_IP_ROLES: "admin",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "admin-9", username: "admin", role: "admin", passwordHash: adminHash },
      ]),
    });

    try {
      // CSRF: Origin malicioso
      await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });

      // Login real para criar sessao admin (IP-bound)
      const login = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      const loginBody = (await login.json()) as { token: string };

      // Acessa de IP diferente -> session.ip_mismatch
      await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: {
          authorization: `Bearer ${loginBody.token}`,
          "x-forwarded-for": "203.0.113.5",
        },
      });

      const events = readJsonl(auditPath);
      const types = events.map((e) => e.type);
      assert.ok(types.includes("csrf.origin_blocked"));
      assert.ok(types.includes("session.ip_mismatch"));

      const csrfEv = events.find((e) => e.type === "csrf.origin_blocked");
      assert.equal(csrfEv?.scope, "auth.csrf");
      assert.equal(csrfEv?.severity, "warn");
      assert.equal((csrfEv?.details as Record<string, unknown>)?.origin, "https://evil.example");

      const ipEv = events.find((e) => e.type === "session.ip_mismatch");
      assert.equal(ipEv?.severity, "high");
      assert.equal(ipEv?.actor?.userId, "admin-9");
      assert.equal((ipEv?.details as Record<string, unknown>)?.sessionIp, "10.0.0.1");
      assert.equal((ipEv?.details as Record<string, unknown>)?.currentIp, "203.0.113.5");
    } finally {
      delete process.env.AUTH_SESSION_BIND_IP_ROLES;
      fs.rmSync(path.dirname(auditPath), { recursive: true, force: true });
      await server.close();
    }
  },
);

test(
  "Auditoria: endpoint /api/auth/audit/recent so libera para admin",
  { concurrency: false },
  async () => {
    const adminHash = await fastHash("AdminForte123!");
    const sellerHash = await fastHash("SellerForte123!");
    const auditPath = tempAuditFile("endpoint");

    const server = await startServer({
      NODE_ENV: "test",
      AUDIT_LOG_PATH: auditPath,
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "audit-endpoint",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_MFA_REQUIRED_ROLES: "",
      AUTH_SESSION_BIND_IP_ROLES: "",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "admin-1", username: "admin", role: "admin", passwordHash: adminHash },
        { id: "seller-1", username: "seller", role: "vendedor", passwordHash: sellerHash },
      ]),
    });

    try {
      const sellerLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "seller", password: "SellerForte123!" }),
      });
      const sellerToken = ((await sellerLogin.json()) as { token: string }).token;

      const adminLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      const adminToken = ((await adminLogin.json()) as { token: string }).token;

      // Vendedor nao pode ler auditoria.
      const blocked = await fetch(`${server.baseUrl}/api/auth/audit/recent`, {
        headers: { authorization: `Bearer ${sellerToken}` },
      });
      assert.equal(blocked.status, 403);

      // Admin pode.
      const ok = await fetch(`${server.baseUrl}/api/auth/audit/recent?limit=10`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.equal(ok.status, 200);
      const body = (await ok.json()) as { events: SecurityAuditEvent[] };
      assert.ok(Array.isArray(body.events));
      assert.ok(body.events.length > 0);
      assert.ok(body.events.some((e) => e.type === "login.success"));
    } finally {
      fs.rmSync(path.dirname(auditPath), { recursive: true, force: true });
      await server.close();
    }
  },
);

test(
  "JsonlSecurityAuditSink: sink direto escreve cada evento como uma linha valida",
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-audit-direct-"));
    const file = path.join(dir, "audit.jsonl");
    try {
      const sink = new JsonlSecurityAuditSink({ filePath: file, memoryRetain: 5 });
      sink.write({
        ts: "2026-05-05T00:00:00.000Z",
        scope: "auth",
        type: "login.success",
        severity: "info",
        outcome: "success",
        actor: { userId: "u1" },
      });
      sink.write({
        ts: "2026-05-05T00:00:01.000Z",
        scope: "auth.csrf",
        type: "csrf.token_invalid",
        severity: "warn",
        outcome: "failure",
      });

      const events = readJsonl(file);
      assert.equal(events.length, 2);
      assert.equal(events[0].type, "login.success");
      assert.equal(events[1].type, "csrf.token_invalid");

      // Buffer em memoria respeita memoryRetain.
      for (let i = 0; i < 10; i++) {
        sink.write({
          ts: "2026-05-05T00:00:02.000Z",
          scope: "auth",
          type: `extra.${i}`,
          severity: "info",
        });
      }
      const recent = sink.recent(100);
      assert.equal(recent.length, 5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

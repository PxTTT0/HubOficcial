import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { generateTotpCode, hashPassword } from "../src/security";

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
    throw new Error("Nao foi possivel obter a porta de teste");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
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

test(
  "MFA: enrollment forcado para admin, depois login em duas etapas",
  { concurrency: false },
  async () => {
    const adminHash = await fastHash("AdminForte123!");
    const server = await startServer({
      NODE_ENV: "test",
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "mfa-flow-secret",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_MFA_REQUIRED_ROLES: "admin",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "admin-1", username: "admin", role: "admin", passwordHash: adminHash },
      ]),
    });

    try {
      // Passo 1: login com senha valida; admin nao tem MFA -> sessao em modo enrollmentPending.
      const login = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      assert.equal(login.status, 200);
      const loginBody = (await login.json()) as Record<string, unknown>;
      assert.equal(loginBody.mfaEnrollmentPending, true);
      assert.equal(typeof loginBody.token, "string");
      const pendingToken = loginBody.token as string;

      // Sessao pendente: nao pode chamar rota administrativa.
      const blocked = await fetch(`${server.baseUrl}/api/makscore/audit/recent`, {
        headers: { authorization: `Bearer ${pendingToken}` },
      });
      assert.equal(blocked.status, 403);
      assert.deepEqual(await blocked.json(), { error: "mfa_enrollment_required" });

      // Pode iniciar enrollment.
      const enroll = await fetch(`${server.baseUrl}/api/auth/mfa/enroll`, {
        method: "POST",
        headers: { authorization: `Bearer ${pendingToken}` },
      });
      assert.equal(enroll.status, 200);
      const enrollBody = (await enroll.json()) as { secret: string; otpauthUri: string };
      assert.match(enrollBody.otpauthUri, /^otpauth:\/\/totp\//);
      assert.ok(enrollBody.secret.length > 16);

      // Confirma com codigo TOTP valido.
      const code = generateTotpCode(enrollBody.secret);
      const verify = await fetch(`${server.baseUrl}/api/auth/mfa/verify-enrollment`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${pendingToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
      assert.equal(verify.status, 200);
      const verifyBody = (await verify.json()) as {
        recoveryCodes: string[];
        token: string;
        csrfToken: string;
      };
      assert.equal(verifyBody.recoveryCodes.length, 10);
      assert.ok(verifyBody.recoveryCodes.every((c) => /^[0-9A-Z]+(-[0-9A-Z]+){2}$/.test(c)));
      assert.notEqual(verifyBody.token, pendingToken);
      assert.equal(typeof verifyBody.csrfToken, "string");
      const upgradedToken = verifyBody.token;

      // Token antigo (enrollmentPending) foi invalidado pela rotacao do sid.
      const stale = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${pendingToken}` },
      });
      assert.equal(stale.status, 401);

      // Token novo reflete mfa habilitado e enrollment concluido.
      const meAfter = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${upgradedToken}` },
      });
      assert.equal(meAfter.status, 200);
      const meBody = (await meAfter.json()) as {
        user: { id: string; role: string };
        mfa: { enabled: boolean; required: boolean; enrollmentPending: boolean };
      };
      assert.equal(meBody.mfa.enabled, true);
      assert.equal(meBody.mfa.enrollmentPending, false);

      // Logout invalida a sessao corrente.
      const logout = await fetch(`${server.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${upgradedToken}` },
      });
      assert.equal(logout.status, 204);

      // Novo login agora exige MFA: passo 1 retorna mfaRequired sem sessao.
      const login2 = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      assert.equal(login2.status, 200);
      const login2Body = (await login2.json()) as Record<string, unknown>;
      assert.equal(login2Body.mfaRequired, true);
      assert.equal(typeof login2Body.challengeToken, "string");
      assert.equal(login2Body.token, undefined);

      // Codigo errado e rejeitado.
      const wrong = await fetch(`${server.baseUrl}/api/auth/login/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: login2Body.challengeToken,
          code: "000000",
        }),
      });
      assert.equal(wrong.status, 401);

      // Codigo certo conclui o login com sessao completa.
      const code2 = generateTotpCode(enrollBody.secret);
      const ok = await fetch(`${server.baseUrl}/api/auth/login/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: login2Body.challengeToken,
          code: code2,
        }),
      });
      assert.equal(ok.status, 200);
      const okBody = (await ok.json()) as { token: string };
      assert.equal(typeof okBody.token, "string");

      // Sessao final pode acessar rota analista/admin.
      const audit = await fetch(`${server.baseUrl}/api/makscore/audit/recent`, {
        headers: { authorization: `Bearer ${okBody.token}` },
      });
      assert.equal(audit.status, 200);

      // Recovery code consome um dos hashes e completa o login.
      const login3 = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      const login3Body = (await login3.json()) as { challengeToken: string };
      const recovery = await fetch(`${server.baseUrl}/api/auth/login/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: login3Body.challengeToken,
          code: verifyBody.recoveryCodes[0],
          recovery: true,
        }),
      });
      assert.equal(recovery.status, 200);

      // O mesmo recovery code nao pode ser usado de novo.
      const login4 = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      const login4Body = (await login4.json()) as { challengeToken: string };
      const reuse = await fetch(`${server.baseUrl}/api/auth/login/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: login4Body.challengeToken,
          code: verifyBody.recoveryCodes[0],
          recovery: true,
        }),
      });
      assert.equal(reuse.status, 401);
    } finally {
      await server.close();
    }
  },
);

test(
  "MFA: vendedor segue logando sem MFA quando role nao e obrigatorio",
  { concurrency: false },
  async () => {
    const sellerHash = await fastHash("SenhaForte123!");
    const server = await startServer({
      NODE_ENV: "test",
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "mfa-not-required-secret",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_MFA_REQUIRED_ROLES: "admin,analista",
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
      assert.equal(login.status, 200);
      const body = (await login.json()) as Record<string, unknown>;
      assert.equal(typeof body.token, "string");
      assert.equal(body.mfaRequired, undefined);
      assert.equal(body.mfaEnrollmentPending, undefined);
    } finally {
      await server.close();
    }
  },
);

test(
  "MFA: challenge token e single-use e tem assinatura HMAC verificada",
  { concurrency: false },
  async () => {
    const adminHash = await fastHash("AdminForte123!");
    const server = await startServer({
      NODE_ENV: "test",
      MAKSCORE_EPOSI_MODE: "mock",
      AUTH_SESSION_SECRET: "mfa-challenge-secret",
      AUTH_ALLOW_DEV_HEADER_AUTH: "false",
      AUTH_SECURE_COOKIES: "false",
      AUTH_MFA_REQUIRED_ROLES: "admin",
      AUTH_USERS_JSON: JSON.stringify([
        { id: "admin-2", username: "admin", role: "admin", passwordHash: adminHash },
      ]),
    });

    try {
      // Faz enrollment direto via service para simular usuario ja com MFA.
      const enrollment = server.security.mfa.beginEnrollment("admin-2", "admin");
      server.security.mfa.confirmEnrollment(
        "admin-2",
        generateTotpCode(enrollment.secret),
      );

      const login = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "AdminForte123!" }),
      });
      const body = (await login.json()) as { challengeToken: string };

      // Token adulterado (ultimo char trocado) deve falhar.
      const tampered = body.challengeToken.slice(0, -1) + "X";
      const tamperedRes = await fetch(`${server.baseUrl}/api/auth/login/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: tampered,
          code: generateTotpCode(enrollment.secret),
        }),
      });
      assert.equal(tamperedRes.status, 401);

      // Primeiro consumo OK, segundo tem que falhar (single-use do challenge).
      const code = generateTotpCode(enrollment.secret);
      const first = await fetch(`${server.baseUrl}/api/auth/login/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken: body.challengeToken, code }),
      });
      assert.equal(first.status, 200);

      const second = await fetch(`${server.baseUrl}/api/auth/login/mfa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken: body.challengeToken, code }),
      });
      assert.equal(second.status, 401);
    } finally {
      await server.close();
    }
  },
);

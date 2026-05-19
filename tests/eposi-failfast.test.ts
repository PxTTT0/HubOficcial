import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProductionSecurityError,
  validateProductionEnvironment,
  type ProductionEnvironment,
} from "../src/security/bootstrap";
import type { SecurityConfig } from "../src/security/config";

// SecurityConfig totalmente valido para producao: assim qualquer issue
// que aparecer vem APENAS da validacao E-POSI que estamos testando.
const VALID_SECURITY: SecurityConfig = {
  sessionSecret: "a-very-long-production-session-secret-0123456789",
  sessionCookieName: "hub_sid",
  sessionTtlMs: 43_200_000,
  sessionIdleMs: 1_800_000,
  sessionBindIpRoles: ["admin", "analista"],
  csrfCookieName: "hub_csrf",
  secureCookies: true,
  trustedOrigins: ["https://hub.makfil.com.br"],
  trustProxy: true,
  userRateLimitPerMin: 60,
  ipRateLimitPerMin: 120,
  authRateLimitPerMin: 10,
  authFailureLimitPer15Min: 25,
  allowDevHeaderAuth: false,
  envName: "production",
  mfaRequiredRoles: ["admin", "analista"],
  mfaIssuer: "HubVendasMakfil",
  mfaChallengeTtlMs: 300_000,
  mfaRecoveryCodes: 10,
  mfaRateLimitPerMin: 5,
  mfaFailureLimitPer15Min: 10,
};

function buildEnv(
  makscore: Partial<ProductionEnvironment["makscore"]>,
  envName = "production",
): ProductionEnvironment {
  return {
    envName,
    security: { ...VALID_SECURITY, envName },
    audit: { filePath: "/var/log/hub-vendas/audit.jsonl", memoryRetain: 1000, configured: true },
    makscore: {
      cnpjPepper: "pepper-de-producao-suficientemente-longo",
      eposiMode: "mock",
      eposiLogin: "",
      eposiPassword: "",
      ...makscore,
    },
  };
}

test("production + live SEM credenciais: startup falha com erros de login e senha", () => {
  assert.throws(
    () => validateProductionEnvironment(buildEnv({ eposiMode: "live" })),
    (err: unknown) => {
      assert.ok(err instanceof ProductionSecurityError);
      assert.match(err.message, /MAKSCORE_EPOSI_LOGIN nao definido/);
      assert.match(err.message, /MAKSCORE_EPOSI_PASSWORD nao definido/);
      return true;
    },
  );
});

test("production + mock SEM credenciais: NAO falha (mock nao exige credencial)", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(
      buildEnv({ eposiMode: "mock", eposiLogin: "", eposiPassword: "" }),
    ),
  );
});

test("production + live COM credenciais validas: NAO falha", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(
      buildEnv({
        eposiMode: "live",
        eposiLogin: "integracao@makfil.com.br",
        eposiPassword: "S3nh@-Real-E-POSI-9f2k",
      }),
    ),
  );
});

test("production + live com placeholders: rejeitado", () => {
  for (const bogus of ["changeme", "trocar", "senha", "password", "admin", "test", "TESTE", "  ChangeMe  "]) {
    assert.throws(
      () =>
        validateProductionEnvironment(
          buildEnv({ eposiMode: "live", eposiLogin: bogus, eposiPassword: bogus }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProductionSecurityError);
        assert.match(err.message, /MAKSCORE_EPOSI_LOGIN parece ser um placeholder/);
        assert.match(err.message, /MAKSCORE_EPOSI_PASSWORD parece ser um placeholder/);
        return true;
      },
      `placeholder "${bogus}" deveria ser rejeitado`,
    );
  }
});

test("production + live: senha forte contendo 'test' como substring NAO e placeholder", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(
      buildEnv({
        eposiMode: "live",
        eposiLogin: "user@makfil.com.br",
        eposiPassword: "MyStr0ng-test-Pass!2026",
      }),
    ),
  );
});

test("nao-producao + live SEM credenciais: NAO falha (guard de envName)", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(
      buildEnv({ eposiMode: "live", eposiLogin: "", eposiPassword: "" }, "development"),
    ),
  );
});

test("mensagem de erro NUNCA vaza o valor de login/senha", () => {
  const secretLogin = "super-secret-login-should-not-leak";
  const secretPassword = "super-secret-password-should-not-leak";
  try {
    validateProductionEnvironment(
      buildEnv({
        eposiMode: "live",
        // placeholders disparam a issue, mas a mensagem nao deve conter o valor.
        // Aqui usamos valores nao-placeholder no campo errado de proposito:
        eposiLogin: "",
        eposiPassword: "",
      }),
    );
    assert.fail("deveria ter lancado ProductionSecurityError");
  } catch (err) {
    assert.ok(err instanceof ProductionSecurityError);
    assert.ok(!err.message.includes(secretLogin));
    assert.ok(!err.message.includes(secretPassword));
  }
});

test("erros E-POSI sao agregados junto com outras issues de seguranca", () => {
  const env = buildEnv({ eposiMode: "live" });
  env.makscore.cnpjPepper = ""; // dispara tambem a issue de pepper
  assert.throws(
    () => validateProductionEnvironment(env),
    (err: unknown) => {
      assert.ok(err instanceof ProductionSecurityError);
      // mesma excecao agrega E-POSI + pepper
      assert.match(err.message, /MAKSCORE_EPOSI_LOGIN/);
      assert.match(err.message, /MAKSCORE_CNPJ_PEPPER/);
      assert.ok(err.issues.length >= 3);
      return true;
    },
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { MakScoreConfig } from "../src/modules/makscore/config";
import {
  EnvEposiCredentialProvider,
  type EposiAuthAuditor,
  type EposiCredentialId,
} from "../src/modules/makscore/eposiCredentials";
import { LiveEposiClient } from "../src/modules/makscore/eposiClient";

const PRIMARY = { login: "primary@makfil.com.br", password: "Primary-Real-Pass-9x" };
const SECONDARY = { login: "secondary@makfil.com.br", password: "Secondary-Real-Pass-7z" };

function cfg(overrides: Partial<MakScoreConfig> = {}): MakScoreConfig {
  return {
    eposiMode: "live",
    eposiAuthUrl: "https://eposi.test/auth",
    eposiQueryUrl: "https://eposi.test/query",
    eposiLogin: PRIMARY.login,
    eposiPassword: PRIMARY.password,
    eposiLoginSecondary: "",
    eposiPasswordSecondary: "",
    eposiActiveCredential: "primary",
    defaultProduct: "TOTAL_PJ",
    approveMinScore: 700,
    reproveMaxScore: 400,
    validityHours: 24,
    httpTimeoutMs: 5000,
    rateLimitPerMin: 20,
    highTicketAmount: 50_000,
    ...overrides,
  };
}

interface AuditCall {
  kind: "success" | "failure" | "fallback" | "exhausted";
  args: unknown[];
}

function capturingAuditor(): { auditor: EposiAuthAuditor; calls: AuditCall[] } {
  const calls: AuditCall[] = [];
  const auditor: EposiAuthAuditor = {
    authSuccess: (id, status) => calls.push({ kind: "success", args: [id, status] }),
    authFailure: (id, reason, status) =>
      calls.push({ kind: "failure", args: [id, reason, status] }),
    authFallback: (from, to, reason) =>
      calls.push({ kind: "fallback", args: [from, to, reason] }),
    authExhausted: (reason) => calls.push({ kind: "exhausted", args: [reason] }),
  };
  return { auditor, calls };
}

// ───────────────────── Provider ─────────────────────

test("provider: so primaria => 1 candidato (compat total)", () => {
  const p = new EnvEposiCredentialProvider(cfg());
  const c = p.candidates();
  assert.equal(c.length, 1);
  assert.equal(c[0].id, "primary");
});

test("provider: primaria + secundaria => [primary, secondary]", () => {
  const p = new EnvEposiCredentialProvider(
    cfg({ eposiLoginSecondary: SECONDARY.login, eposiPasswordSecondary: SECONDARY.password }),
  );
  assert.deepEqual(p.candidates().map((x) => x.id), ["primary", "secondary"]);
});

test("provider: ACTIVE_CREDENTIAL=secondary inverte ordem", () => {
  const p = new EnvEposiCredentialProvider(
    cfg({
      eposiLoginSecondary: SECONDARY.login,
      eposiPasswordSecondary: SECONDARY.password,
      eposiActiveCredential: "secondary",
    }),
  );
  assert.deepEqual(p.candidates().map((x) => x.id), ["secondary", "primary"]);
});

test("provider: pin secondary sem secundaria configurada => [primary] (fallback ainda valido)", () => {
  const p = new EnvEposiCredentialProvider(cfg({ eposiActiveCredential: "secondary" }));
  assert.deepEqual(p.candidates().map((x) => x.id), ["primary"]);
});

test("provider: secundaria pela metade nao vira candidato", () => {
  const p = new EnvEposiCredentialProvider(
    cfg({ eposiLoginSecondary: SECONDARY.login, eposiPasswordSecondary: "" }),
  );
  assert.deepEqual(p.candidates().map((x) => x.id), ["primary"]);
});

// ───────────────────── Fallback / auth ─────────────────────

function mockFetch(handler: (url: string, body: any) => { status: number; json: any }) {
  const calls: { url: string; body: any }[] = [];
  const real = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), body });
    const r = handler(String(url), body);
    return new Response(JSON.stringify(r.json), { status: r.status });
  };
  return { calls, restore: () => ((globalThis as any).fetch = real) };
}

test("primaria falha => fallback p/ secundaria, retorna token e audita", async () => {
  const { auditor, calls } = capturingAuditor();
  const fx = mockFetch((_url, body) => {
    if (body.login === PRIMARY.login) return { status: 401, json: {} };
    if (body.login === SECONDARY.login) return { status: 200, json: { token: "TOK-SEC" } };
    return { status: 500, json: {} };
  });
  try {
    const c = cfg({
      eposiLoginSecondary: SECONDARY.login,
      eposiPasswordSecondary: SECONDARY.password,
    });
    const client = new LiveEposiClient(c, new EnvEposiCredentialProvider(c), auditor);
    const r = await client.query("11222333000181", "TOTAL_PJ");
    assert.equal(r.fromMock, false);
    const kinds = calls.map((x) => x.kind);
    assert.deepEqual(kinds, ["failure", "fallback", "success"]);
    assert.deepEqual(calls[0].args.slice(0, 2), ["primary", "auth_rejected_401"]);
    assert.deepEqual(calls[1].args, ["primary", "secondary", "previous_failed"]);
    assert.deepEqual(calls[2].args, ["secondary", 200]);
  } finally {
    fx.restore();
  }
});

test("ambas falham => erro generico 502 SEM segredo + authExhausted", async () => {
  const { auditor, calls } = capturingAuditor();
  const fx = mockFetch(() => ({ status: 403, json: {} }));
  try {
    const c = cfg({
      eposiLoginSecondary: SECONDARY.login,
      eposiPasswordSecondary: SECONDARY.password,
    });
    const client = new LiveEposiClient(c, new EnvEposiCredentialProvider(c), auditor);
    await assert.rejects(
      () => client.query("11222333000181", "TOTAL_PJ"),
      (err: any) => {
        assert.equal(err.status, 502);
        assert.match(err.message, /Falha de autenticacao E-POSI/);
        // erro generico nao contem login/senha de nenhuma credencial
        for (const secret of [
          PRIMARY.login,
          PRIMARY.password,
          SECONDARY.login,
          SECONDARY.password,
        ]) {
          assert.ok(!err.message.includes(secret));
        }
        return true;
      },
    );
    assert.deepEqual(
      calls.map((x) => x.kind),
      ["failure", "failure", "exhausted"],
    );
    assert.deepEqual(calls[2].args, ["all_credentials_failed"]);
  } finally {
    fx.restore();
  }
});

test("nenhuma credencial => erro generico 500 + authExhausted(credentials_absent)", async () => {
  const { auditor, calls } = capturingAuditor();
  const c = cfg({ eposiLogin: "", eposiPassword: "" });
  const client = new LiveEposiClient(c, new EnvEposiCredentialProvider(c), auditor);
  await assert.rejects(
    () => client.query("11222333000181", "TOTAL_PJ"),
    (err: any) => {
      assert.equal(err.status, 500);
      assert.match(err.message, /Credenciais E-POSI ausentes/);
      return true;
    },
  );
  assert.deepEqual(calls, [{ kind: "exhausted", args: ["credentials_absent"] }]);
});

test("token cacheado e reusado dentro do TTL (sem reauth)", async () => {
  const { auditor, calls } = capturingAuditor();
  const fx = mockFetch((url) =>
    url.includes("/auth")
      ? { status: 200, json: { token: "TOK" } }
      : { status: 200, json: { ok: true } },
  );
  try {
    const c = cfg();
    const client = new LiveEposiClient(c, new EnvEposiCredentialProvider(c), auditor);
    await client.query("11222333000181", "TOTAL_PJ");
    await client.query("11222333000181", "TOTAL_PJ");
    const authCalls = fx.calls.filter((x) => x.url.includes("/auth"));
    assert.equal(authCalls.length, 1, "deve autenticar so uma vez");
    assert.equal(calls.filter((x) => x.kind === "success").length, 1);
  } finally {
    fx.restore();
  }
});

test("query 401 invalida token e forca reautenticacao", async () => {
  const { auditor } = capturingAuditor();
  let queryHits = 0;
  const fx = mockFetch((url) => {
    if (url.includes("/auth")) return { status: 200, json: { token: "TOK" } };
    queryHits += 1;
    return queryHits === 1 ? { status: 401, json: {} } : { status: 200, json: { ok: true } };
  });
  try {
    const c = cfg();
    const client = new LiveEposiClient(c, new EnvEposiCredentialProvider(c), auditor);
    await client.query("11222333000181", "TOTAL_PJ"); // 401 -> invalida token
    await client.query("11222333000181", "TOTAL_PJ"); // reautentica
    const authCalls = fx.calls.filter((x) => x.url.includes("/auth"));
    assert.equal(authCalls.length, 2, "401 deve forcar reauth na proxima query");
  } finally {
    fx.restore();
  }
});

test("auditor NUNCA recebe login/senha/token em nenhum argumento", async () => {
  const { auditor, calls } = capturingAuditor();
  const fx = mockFetch((_url, body) =>
    body.login === PRIMARY.login
      ? { status: 500, json: {} }
      : { status: 200, json: { token: "SENSITIVE-TOKEN-XYZ" } },
  );
  try {
    const c = cfg({
      eposiLoginSecondary: SECONDARY.login,
      eposiPasswordSecondary: SECONDARY.password,
    });
    const client = new LiveEposiClient(c, new EnvEposiCredentialProvider(c), auditor);
    await client.query("11222333000181", "TOTAL_PJ");
    const blob = JSON.stringify(calls);
    for (const secret of [
      PRIMARY.login,
      PRIMARY.password,
      SECONDARY.login,
      SECONDARY.password,
      "SENSITIVE-TOKEN-XYZ",
    ]) {
      assert.ok(!blob.includes(secret), `auditor vazou: ${secret}`);
    }
  } finally {
    fx.restore();
  }
});

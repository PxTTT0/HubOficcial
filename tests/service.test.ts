import { test } from "node:test";
import assert from "node:assert/strict";
import { MakScoreService, MakScoreInputError } from "../src/modules/makscore/service";
import { InMemoryMakScoreRepository } from "../src/modules/makscore/repository";
import { InMemoryAuditSink } from "../src/modules/makscore/audit";
import { MockEposiClient } from "../src/modules/makscore/eposiClient";
import type { MakScoreConfig } from "../src/modules/makscore/config";
import type { EposiClient, EposiRawResponse } from "../src/modules/makscore/eposiClient";

const cfg: MakScoreConfig = {
  eposiMode: "mock",
  eposiAuthUrl: "",
  eposiQueryUrl: "",
  eposiLogin: "",
  eposiPassword: "",
  eposiLoginSecondary: "",
  eposiPasswordSecondary: "",
  eposiActiveCredential: "primary",
  defaultProduct: "TOTAL_PJ",
  approveMinScore: 700,
  reproveMaxScore: 400,
  validityHours: 24,
  httpTimeoutMs: 8000,
  rateLimitPerMin: 20,
  highTicketAmount: 50_000,
};

const VALID_CNPJ = "11222333000181";

function silentSink() {
  const sink = new InMemoryAuditSink();
  // suprime ruido do console.log nos testes (write e async no contrato)
  (sink as any).write = async function (e: any) {
    (this as any).events.push({ ...e });
  };
  return sink;
}

test("CNPJ invalido nao chama E-POSI", async () => {
  let called = false;
  const client: EposiClient = {
    async query() {
      called = true;
      return { raw: {}, httpStatus: 200, fromMock: true };
    },
  };
  const svc = new MakScoreService(cfg, client, new InMemoryMakScoreRepository(), silentSink());
  await assert.rejects(
    () => svc.query({ cnpj: "123" }),
    (e: any) => e instanceof MakScoreInputError && e.code === "cnpj_invalido",
  );
  assert.equal(called, false);
});

test("falha externa retorna estado seguro indisponivel_temporariamente", async () => {
  const broken: EposiClient = {
    async query(): Promise<EposiRawResponse> {
      throw new Error("network down");
    },
  };
  const svc = new MakScoreService(cfg, broken, new InMemoryMakScoreRepository(), silentSink());
  const r = await svc.query({ cnpj: VALID_CNPJ });
  assert.equal(r.outcome, "indisponivel_temporariamente");
  assert.equal(r.score, null);
});

test("CNPJ retornado e mascarado e mock e marcado como tal", async () => {
  const svc = new MakScoreService(cfg, new MockEposiClient(), new InMemoryMakScoreRepository(), silentSink());
  const r = await svc.query({ cnpj: VALID_CNPJ });
  assert.match(r.cnpj, /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
  assert.equal(r.sourceIsMock, true);
});

test("mock baseline com sufixo regular aprova (score >= 700)", async () => {
  const svc = new MakScoreService(cfg, new MockEposiClient(), new InMemoryMakScoreRepository(), silentSink());
  const r = await svc.query({ cnpj: VALID_CNPJ });
  assert.equal(r.outcome, "aprovado");
  assert.ok((r.score ?? 0) >= 700);
});

test("ticket alto + mock com restritivo (..06) sustenta exige_analise", async () => {
  // CNPJ valido com final 06: 11.222.333/0001-06? Primeiro precisa ser valido.
  // Usamos ..06 nao no checksum, mas sim sufixo arbitrario do mock.
  // O mock olha .slice(-2) do CNPJ recebido. Precisamos gerar um CNPJ valido
  // que termine em "06" - mais simples: passamos sem validacao via cliente
  // direto; aqui usamos o caminho de servico com CNPJ valido que NAO termine
  // em 06, e injetamos um cliente mock fixo para o cenario.
  const fixed: EposiClient = {
    async query(_cnpj, _p) {
      return new MockEposiClient().query("00000000000006", _p);
    },
  };
  const svc = new MakScoreService(cfg, fixed, new InMemoryMakScoreRepository(), silentSink());
  const r = await svc.query({
    cnpj: VALID_CNPJ,
    context: { ticketPretendido: 100_000 },
  });
  assert.equal(r.outcome, "exige_analise");
});

test("LiveEposiClient envia { documento, consultas: [product] }", async () => {
  const calls: any[] = [];
  const realFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    if (String(url).includes("/auth")) {
      return new Response(JSON.stringify({ token: "T" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        VerifiQPJResponseEx: {
          Response: {
            VerifiQPJOutput: [
              { Analytics: { ScorePJ: { Score: "800" } } },
            ],
          },
        },
        ReportPJResponseEx: {
          Response: {
            ReportPJOutput: [{ BestInfo: { CompanyStatus: "ATIVO", CompanyName: "X" } }],
          },
        },
      }),
      { status: 200 },
    );
  };
  try {
    const { LiveEposiClient } = await import("../src/modules/makscore/eposiClient");
    const live = new LiveEposiClient({
      ...cfg,
      eposiMode: "live",
      eposiAuthUrl: "https://example/auth",
      eposiQueryUrl: "https://example/query",
      eposiLogin: "u",
      eposiPassword: "p",
    });
    const r = await live.query(VALID_CNPJ, "TOTAL_PJ");
    assert.equal(r.httpStatus, 200);
    const queryCall = calls.find((c) => String(c.url).includes("query"));
    assert.ok(queryCall, "query chamado");
    const body = JSON.parse(queryCall.init.body);
    assert.equal(body.documento, VALID_CNPJ);
    assert.deepEqual(body.consultas, ["TOTAL_PJ"]);
    // bearer token presente; sem vazar para resposta da API publica
    assert.match(queryCall.init.headers.authorization, /^Bearer /);
  } finally {
    (globalThis as any).fetch = realFetch;
  }
});

test("auditoria registra correlation_id e CNPJ mascarado", async () => {
  const sink = silentSink();
  const svc = new MakScoreService(cfg, new MockEposiClient(), new InMemoryMakScoreRepository(), sink);
  const r = await svc.query({ cnpj: VALID_CNPJ, context: { userId: "u1" } });
  const events = await sink.recent(50);
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.equal(e.correlationId, r.correlationId);
    assert.match(e.cnpjMasked, /^\d{2}\.\*\*\*\.\*\*\*\/\*\*\*\*-\d{2}$/);
    // garante que o CNPJ aberto nunca aparece nos eventos
    assert.ok(!JSON.stringify(e).includes(VALID_CNPJ));
  }
});

test("cache hit reutiliza score vigente", async () => {
  let calls = 0;
  const client: EposiClient = {
    async query(): Promise<EposiRawResponse> {
      calls++;
      return new MockEposiClient().query("00000000000099", "TOTAL_PJ");
    },
  };
  const repo = new InMemoryMakScoreRepository();
  const svc = new MakScoreService(cfg, client, repo, silentSink());
  await svc.query({ cnpj: VALID_CNPJ });
  await svc.query({ cnpj: VALID_CNPJ });
  assert.equal(calls, 1);
});

test("forceRefresh ignora cache", async () => {
  let calls = 0;
  const client: EposiClient = {
    async query(): Promise<EposiRawResponse> {
      calls++;
      return new MockEposiClient().query("00000000000099", "TOTAL_PJ");
    },
  };
  const svc = new MakScoreService(cfg, client, new InMemoryMakScoreRepository(), silentSink());
  await svc.query({ cnpj: VALID_CNPJ });
  await svc.query({ cnpj: VALID_CNPJ, forceRefresh: true });
  assert.equal(calls, 2);
});

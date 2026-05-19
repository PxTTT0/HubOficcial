import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMakfilPolicy } from "../src/modules/makscore/policy";
import type { NormalizedEposi } from "../src/modules/makscore/types";
import type { MakScoreConfig } from "../src/modules/makscore/config";

const cfg: MakScoreConfig = {
  eposiMode: "mock",
  eposiAuthUrl: "",
  eposiQueryUrl: "",
  eposiLogin: "",
  eposiPassword: "",
  defaultProduct: "TOTAL_PJ",
  approveMinScore: 700,
  reproveMaxScore: 400,
  validityHours: 24,
  httpTimeoutMs: 8000,
  rateLimitPerMin: 20,
  highTicketAmount: 50_000,
};

function base(overrides: Partial<NormalizedEposi> = {}): NormalizedEposi {
  return {
    product: "TOTAL_PJ",
    score: 800,
    reasonCodes: [],
    errorCode: null,
    errorMessage: null,
    cadastralStatus: "ativa",
    razaoSocial: "X",
    nomeFantasia: null,
    naturezaJuridica: null,
    cnaePrincipal: null,
    dataAbertura: null,
    endereco: null,
    email: null,
    telefone: null,
    hasNegativacao: false,
    hasProtesto: false,
    consultasAnteriores: null,
    sourceIsMock: true,
    ...overrides,
  };
}

test("ErrorCode 1005 reprova", () => {
  const d = applyMakfilPolicy(base({ errorCode: "1005" }), cfg);
  assert.equal(d.outcome, "reprovado");
  assert.equal(d.primaryRule, "eposi:situacao_cadastral_irregular");
});

test("ErrorCode 1021 vira indisponivel_temporariamente", () => {
  const d = applyMakfilPolicy(base({ errorCode: "1021" }), cfg);
  assert.equal(d.outcome, "indisponivel_temporariamente");
});

test("Situacao inapta reprova", () => {
  const d = applyMakfilPolicy(base({ cadastralStatus: "inapta" }), cfg);
  assert.equal(d.outcome, "reprovado");
});

test("Score baixo nao reprova automaticamente: exige analise", () => {
  const d = applyMakfilPolicy(base({ score: 350 }), cfg);
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "score:baixo");
});

test("Negativacao sempre exige analise (nao reprova)", () => {
  const d = applyMakfilPolicy(base({ hasNegativacao: true, score: 800 }), cfg);
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "restritivo:presente");
});

test("Protesto sempre exige analise (nao reprova)", () => {
  const d = applyMakfilPolicy(base({ hasProtesto: true, score: 800 }), cfg);
  assert.equal(d.outcome, "exige_analise");
});

test("Score >= 700 sem bloqueios aprova", () => {
  const d = applyMakfilPolicy(base({ score: 720 }), cfg);
  assert.equal(d.outcome, "aprovado");
});

test("Score intermediario (entre reprove e approve) exige analise", () => {
  const d = applyMakfilPolicy(base({ score: 550 }), cfg);
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "score:intermediario");
});

test("Score ausente exige analise", () => {
  const d = applyMakfilPolicy(base({ score: null }), cfg);
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "score:ausente");
});

test("Reason code critico empurra para analise", () => {
  const d = applyMakfilPolicy(base({ score: 750, reasonCodes: ["R3"] }), cfg);
  assert.equal(d.outcome, "exige_analise");
});

test("Ticket alto reforca exige_analise em score intermediario", () => {
  const d = applyMakfilPolicy(
    base({ score: 600 }),
    cfg,
    { ticketPretendido: 80_000 },
  );
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "ticket:alto_risco_intermediario");
});

test("Ticket alto + empresa recente (R1) reforca exige_analise mesmo com score alto", () => {
  const d = applyMakfilPolicy(
    base({ score: 750, reasonCodes: ["R1"] }),
    cfg,
    { ticketPretendido: 100_000 },
  );
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "ticket:alto_risco_intermediario");
});

test("Ticket alto sozinho NAO reprova nem aprova", () => {
  // score alto + sem fragilidade -> ainda aprova mesmo com ticket alto
  const d = applyMakfilPolicy(base({ score: 800 }), cfg, { ticketPretendido: 200_000 });
  assert.equal(d.outcome, "aprovado");
});

test("Ticket ausente nao quebra consulta", () => {
  const d = applyMakfilPolicy(base({ score: 720 }), cfg, {});
  assert.equal(d.outcome, "aprovado");
});

test("Cadastral desconhecida em modo live -> exige analise", () => {
  const d = applyMakfilPolicy(
    base({ score: 900, sourceIsMock: false, cadastralStatus: "desconhecida" }),
    cfg,
  );
  assert.equal(d.outcome, "exige_analise");
});

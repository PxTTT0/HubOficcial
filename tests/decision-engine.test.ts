import { test } from "node:test";
import assert from "node:assert/strict";
import { runDecisionEngine } from "../src/modules/makscore/decision/engine";
import { MAKFIL_RULES } from "../src/modules/makscore/decision/rules";
import type { NormalizedEposi } from "../src/modules/makscore/types";
import type { MakScoreConfig } from "../src/modules/makscore/config";

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

// ───────────────── Estrutura das regras ─────────────────

test("toda regra emite RuleHit com contrato completo quando dispara", () => {
  const d = runDecisionEngine(base({ score: 350, hasNegativacao: true, reasonCodes: ["R3"] }), cfg);
  assert.ok(d.ruleHits.length > 0);
  for (const h of d.ruleHits) {
    assert.ok(typeof h.code === "string" && h.code.length > 0);
    assert.ok(["eposi_error", "cadastral", "score", "restritivo", "reason", "ticket", "recency_info"].includes(h.category));
    assert.ok(["block", "review", "approve", "info"].includes(h.severity));
    assert.ok(typeof h.explanation === "string" && h.explanation.length > 0);
    assert.ok(typeof h.impact === "string" && h.impact.length > 0);
    assert.ok(typeof h.priority === "number");
  }
});

test("conjunto de regras tem ids unicos", () => {
  const ids = MAKFIL_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ───────────────── Precedência ─────────────────

test("eposi-error e OVERRIDE mesmo com score aprovavel", () => {
  const d = runDecisionEngine(base({ score: 900, errorCode: "1021" }), cfg);
  assert.equal(d.outcome, "indisponivel_temporariamente");
  assert.equal(d.primaryRule, "eposi:provedor_indisponivel");
});

test("block (cadastral) vence review e approve", () => {
  const d = runDecisionEngine(
    base({ score: 800, cadastralStatus: "inapta", hasNegativacao: true }),
    cfg,
  );
  assert.equal(d.outcome, "reprovado");
  assert.equal(d.primaryRule, "cadastral:inapta");
});

test("review vence approve (score alto + restritivo)", () => {
  const d = runDecisionEngine(base({ score: 800, hasNegativacao: true }), cfg);
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "restritivo:presente");
});

test("primaryRule escolhe maior prioridade entre reviews (score-baixo > restritivo)", () => {
  const d = runDecisionEngine(base({ score: 300, hasNegativacao: true }), cfg);
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "score:baixo");
});

test("aprovado quando so ha hit de approve", () => {
  const d = runDecisionEngine(base({ score: 850 }), cfg);
  assert.equal(d.outcome, "aprovado");
  assert.equal(d.primaryRule, "score:aprovado");
});

// ───────────────── Fatores individuais ─────────────────

test("CNPJ irregular (baixada) reprova", () => {
  assert.equal(runDecisionEngine(base({ cadastralStatus: "baixada" }), cfg).outcome, "reprovado");
});

test("score ausente exige analise", () => {
  const d = runDecisionEngine(base({ score: null }), cfg);
  assert.equal(d.primaryRule, "score:ausente");
});

test("reason critico (R5) empurra para analise", () => {
  const d = runDecisionEngine(base({ score: 750, reasonCodes: ["R5"] }), cfg);
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "reason:critico");
});

test("reason nao-critico (R1) nao empurra sozinho", () => {
  const d = runDecisionEngine(base({ score: 750, reasonCodes: ["R1"] }), cfg);
  assert.equal(d.outcome, "aprovado");
});

test("ticket alto + score intermediario => analise", () => {
  const d = runDecisionEngine(base({ score: 600 }), cfg, { ticketPretendido: 80_000 });
  assert.equal(d.primaryRule, "ticket:alto_risco_intermediario");
});

test("ticket alto sem fragilidade nao altera aprovacao", () => {
  const d = runDecisionEngine(base({ score: 850 }), cfg, { ticketPretendido: 500_000 });
  assert.equal(d.outcome, "aprovado");
});

// ───────────────── riskLevel ─────────────────

test("riskLevel: reprovado => critico", () => {
  assert.equal(runDecisionEngine(base({ cadastralStatus: "inapta" }), cfg).riskLevel, "critico");
});

test("riskLevel: aprovado => baixo", () => {
  assert.equal(runDecisionEngine(base({ score: 850 }), cfg).riskLevel, "baixo");
});

test("riskLevel: indisponivel => indeterminado", () => {
  assert.equal(runDecisionEngine(base({ errorCode: "1021" }), cfg).riskLevel, "indeterminado");
});

test("riskLevel: exige_analise com restritivo => alto", () => {
  assert.equal(
    runDecisionEngine(base({ score: 800, hasNegativacao: true }), cfg).riskLevel,
    "alto",
  );
});

test("riskLevel: exige_analise score ausente => alto", () => {
  assert.equal(runDecisionEngine(base({ score: null }), cfg).riskLevel, "alto");
});

test("riskLevel: exige_analise score intermediario sem restritivo => medio", () => {
  assert.equal(runDecisionEngine(base({ score: 550 }), cfg).riskLevel, "medio");
});

// ───────────────── Combinação de fatores ─────────────────

test("combinacao: eposi-error ignora restritivo/score (override total)", () => {
  const d = runDecisionEngine(
    base({ score: 350, hasNegativacao: true, errorCode: "1005" }),
    cfg,
  );
  assert.equal(d.outcome, "reprovado");
  assert.equal(d.primaryRule, "eposi:situacao_cadastral_irregular");
  // ruleHits ainda registra os demais sinais avaliados
  assert.ok(d.ruleHits.some((h) => h.category === "restritivo"));
});

test("combinacao: multiplos reviews preservam todos em ruleHits", () => {
  const d = runDecisionEngine(
    base({ score: 600, hasNegativacao: true, reasonCodes: ["R3"] }),
    cfg,
    { ticketPretendido: 90_000 },
  );
  assert.equal(d.outcome, "exige_analise");
  const cats = d.ruleHits.map((h) => h.category).sort();
  assert.ok(cats.includes("restritivo"));
  assert.ok(cats.includes("reason"));
  assert.ok(cats.includes("ticket"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { runDecisionEngine } from "../src/modules/makscore/decision/engine";
import type { MakScoreConfig } from "../src/modules/makscore/config";
import type { NormalizedEposi } from "../src/modules/makscore/types";
import {
  MAK_SCORE_QUESTIONNAIRE_VERSION,
  QUESTIONNAIRE_BLOCKERS,
  QUESTIONNAIRE_MITIGATORS,
  QUESTIONNAIRE_PILLARS,
  scoreQuestionnaire,
  type MakScoreQuestionnaireAnswers,
} from "../src/modules/makscore/questionnaire";

const cfg: MakScoreConfig = {
  eposiMode: "mock",
  eposiAuthUrl: "",
  eposiQueryUrl: "",
  eposiLogin: "",
  eposiPassword: "",
  eposiLoginSecondary: "",
  eposiPasswordSecondary: "",
  eposiActiveCredential: "primary",
  httpTimeoutMs: 5000,
  defaultProduct: "TOTAL_PJ",
  approveMinScore: 700,
  reproveMaxScore: 400,
  validityHours: 24,
  rateLimitPerMin: 30,
  highTicketAmount: 50_000,
};

function base(overrides: Partial<NormalizedEposi> = {}): NormalizedEposi {
  return {
    product: "TOTAL_PJ",
    score: 850,
    reasonCodes: [],
    errorCode: null,
    errorMessage: null,
    cadastralStatus: "ativa",
    razaoSocial: "Cliente Teste",
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
    sourceIsMock: false,
    ...overrides,
  };
}

function answers(): MakScoreQuestionnaireAnswers {
  return {
    version: MAK_SCORE_QUESTIONNAIRE_VERSION,
    bloqueios: {},
    pilares: {},
    agravantes: {},
    mitigadores: {},
  };
}

test("questionario calcula total e classificacao A quando todos os itens positivos estao marcados", () => {
  const a = answers();
  for (const pillar of Object.values(QUESTIONNAIRE_PILLARS)) {
    for (const item of pillar.items) a.pilares[item.key] = true;
  }
  for (const item of QUESTIONNAIRE_MITIGATORS) a.mitigadores[item.key] = true;

  const scored = scoreQuestionnaire(a);
  assert.equal(scored.total, 250);
  assert.equal(scored.classification, "A");
  assert.equal(scored.hasBloqueio, false);
});

test("bloqueio automatico do questionario reprova no Decision Engine", () => {
  const a = answers();
  a.bloqueios[QUESTIONNAIRE_BLOCKERS[0].key] = true;

  const d = runDecisionEngine(base(), cfg, { questionnaire: a });
  assert.equal(d.outcome, "reprovado");
  assert.equal(d.primaryRule, "questionnaire:bloqueio");
});

test("questionario Makfil E reprova por pontuacao operacional insuficiente", () => {
  const d = runDecisionEngine(base(), cfg, { questionnaire: answers() });
  assert.equal(d.outcome, "reprovado");
  assert.equal(d.primaryRule, "questionnaire:makfil_e");
});

test("questionario Makfil C exige analise quando score operacional fica na faixa media", () => {
  const a = answers();
  let total = 0;
  for (const pillar of Object.values(QUESTIONNAIRE_PILLARS)) {
    for (const item of pillar.items) {
      if (total >= 150) break;
      a.pilares[item.key] = true;
      total += item.pts;
    }
  }
  const scored = scoreQuestionnaire(a);
  assert.equal(scored.classification, "C");

  const d = runDecisionEngine(base(), cfg, { questionnaire: a });
  assert.equal(d.outcome, "exige_analise");
  assert.equal(d.primaryRule, "questionnaire:makfil_c");
});

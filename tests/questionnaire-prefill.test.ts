import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestQuestionnaireFromEposi } from "../src/modules/makscore/questionnaire";

const APPROVE_MIN = 700;

function inputOf(over: Partial<Parameters<typeof suggestQuestionnaireFromEposi>[0]>) {
  return {
    cadastralStatus: "ativa",
    dataAbertura: null,
    score: null,
    hasProtesto: false,
    hasNegativacao: false,
    ...over,
  };
}

test("suggest: empresa ativa, sem restritivos, score alto, com 5 anos", () => {
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const s = suggestQuestionnaireFromEposi(
    inputOf({
      cadastralStatus: "ativa",
      dataAbertura: fiveYearsAgo.toISOString().slice(0, 10),
      score: 820,
      hasProtesto: false,
      hasNegativacao: false,
    }),
    APPROVE_MIN,
  );
  // pilares marcados
  assert.equal(s.answers.pilares?.a_abertura_12m, true);
  assert.equal(s.answers.pilares?.a_situacao_regular, true);
  assert.equal(s.answers.pilares?.b_sem_protesto, true);
  assert.equal(s.answers.pilares?.c_score_minimo, true);
  // bloqueios e agravantes nao tocados
  assert.equal(s.answers.bloqueios, undefined);
  assert.equal(s.answers.agravantes, undefined);
  // cada sugestao tem source explicativa
  assert.equal(s.sources.length, 4);
});

test("suggest: situacao cadastral irregular -> bloqueio bl_cnpj_inapto", () => {
  for (const status of ["inapta", "baixada", "suspensa", "nula"]) {
    const s = suggestQuestionnaireFromEposi(inputOf({ cadastralStatus: status }), APPROVE_MIN);
    assert.equal(s.answers.bloqueios?.bl_cnpj_inapto, true, `status=${status}`);
    // pilar de "situacao regular" NUNCA marca quando irregular
    assert.notEqual(s.answers.pilares?.a_situacao_regular, true);
  }
});

test("suggest: empresa com menos de 12 meses -> bloqueio bl_menos_12m", () => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const s = suggestQuestionnaireFromEposi(
    inputOf({ dataAbertura: sixMonthsAgo.toISOString().slice(0, 10) }),
    APPROVE_MIN,
  );
  assert.equal(s.answers.bloqueios?.bl_menos_12m, true);
  // E nao marca o pilar A de "abertura > 12m"
  assert.notEqual(s.answers.pilares?.a_abertura_12m, true);
});

test("suggest: protesto presente -> agravante ag_protesto_alto + nao marca b_sem_protesto", () => {
  const s = suggestQuestionnaireFromEposi(inputOf({ hasProtesto: true }), APPROVE_MIN);
  assert.equal(s.answers.agravantes?.ag_protesto_alto, true);
  assert.notEqual(s.answers.pilares?.b_sem_protesto, true);
});

test("suggest: score abaixo do minimo -> nao marca c_score_minimo", () => {
  const s = suggestQuestionnaireFromEposi(inputOf({ score: 500 }), APPROVE_MIN);
  assert.notEqual(s.answers.pilares?.c_score_minimo, true);
});

test("suggest: dataAbertura invalida nao quebra (sem sugestao de idade)", () => {
  const s = suggestQuestionnaireFromEposi(inputOf({ dataAbertura: "data-podre" }), APPROVE_MIN);
  assert.notEqual(s.answers.bloqueios?.bl_menos_12m, true);
  assert.notEqual(s.answers.pilares?.a_abertura_12m, true);
});

test("suggest: cada sugestao tem (group, key, reason) bem formada", () => {
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const s = suggestQuestionnaireFromEposi(
    inputOf({
      cadastralStatus: "ativa",
      dataAbertura: fiveYearsAgo.toISOString().slice(0, 10),
      score: 820,
    }),
    APPROVE_MIN,
  );
  for (const src of s.sources) {
    assert.ok(["bloqueios", "pilares", "agravantes", "mitigadores"].includes(src.group));
    assert.ok(src.key.length > 0);
    assert.ok(src.reason.length > 0);
    // sem CNPJ aberto na reason (defesa contra vazamento acidental)
    assert.ok(!/\d{14}/.test(src.reason));
  }
});

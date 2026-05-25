import type { MakScoreConfig } from "../config";
import { translateReasonCodes } from "../reasonCodes";
import type { MakfilDecision, MakfilOutcome, MakScoreContext, NormalizedEposi } from "../types";
import { MAKFIL_RULES } from "./rules";
import { toDecisionInput, type RiskLevel, type RuleHit } from "./types";

const ACTIONS: Record<MakfilOutcome, string> = {
  aprovado: "Seguir com a proposta nos limites comerciais padrao.",
  reprovado: "Nao prosseguir com a venda. Encaminhar conforme politica interna.",
  exige_analise: "Encaminhar para analise manual antes de prosseguir.",
  indisponivel_temporariamente:
    "Tentar novamente em alguns minutos ou seguir fluxo de fallback manual.",
};

function pickPrimary(hits: RuleHit[]): RuleHit {
  return hits.reduce((best, h) => (h.priority > best.priority ? h : best));
}

function deriveRiskLevel(
  outcome: MakfilOutcome,
  normalized: NormalizedEposi,
): RiskLevel {
  switch (outcome) {
    case "reprovado":
      return "critico";
    case "indisponivel_temporariamente":
      return "indeterminado";
    case "aprovado":
      return "baixo";
    case "exige_analise": {
      // "alto" quando ha sinal forte (restritivo, score baixo/ausente);
      // "medio" para os demais cenarios de analise.
      const forte =
        normalized.hasNegativacao ||
        normalized.hasProtesto ||
        normalized.score === null;
      return forte ? "alto" : "medio";
    }
  }
}

/**
 * Motor de decisao. Avalia todas as regras e agrega de forma
 * deterministica:
 *  - se houver hit de categoria eposi_error, ele e OVERRIDE (desfecho final);
 *  - senao, precedencia por severidade: block > review > approve;
 *  - primaryRule = hit de maior prioridade dentro do desfecho vencedor.
 *
 * Paridade total com a politica sequencial anterior (codigos de
 * primaryRule preservados). `riskLevel` e `ruleHits` sao aditivos.
 */
export function runDecisionEngine(
  normalized: NormalizedEposi,
  cfg: MakScoreConfig,
  ctx?: MakScoreContext,
): MakfilDecision {
  const reasons = translateReasonCodes(normalized.reasonCodes);
  const input = toDecisionInput(ctx);
  const ruleCtx = { normalized, cfg, input, reasons };

  const hits = MAKFIL_RULES.map((r) => r.evaluate(ruleCtx)).filter(
    (h): h is RuleHit => h !== null,
  );

  const build = (outcome: MakfilOutcome, primary: RuleHit): MakfilDecision => ({
    outcome,
    riskLevel: deriveRiskLevel(outcome, normalized),
    primaryRule: primary.code,
    recommendedAction: ACTIONS[outcome],
    translatedReasons: reasons,
    ruleHits: hits,
  });

  // 1) Override do ErrorCode E-POSI.
  const eposi = hits.find((h) => h.category === "eposi_error");
  if (eposi) return build(eposi.outcome, eposi);

  // 2) Precedencia por severidade entre os demais hits.
  const blocks = hits.filter((h) => h.severity === "block");
  if (blocks.length > 0) return build("reprovado", pickPrimary(blocks));

  const reviews = hits.filter((h) => h.severity === "review");
  if (reviews.length > 0) return build("exige_analise", pickPrimary(reviews));

  const approves = hits.filter((h) => h.severity === "approve");
  if (approves.length > 0) return build("aprovado", pickPrimary(approves));

  // 3) Salvaguarda (as regras de score cobrem todos os casos, mas mantemos
  //    um desfecho seguro caso nenhuma regra dispare).
  return {
    outcome: "exige_analise",
    riskLevel: "medio",
    primaryRule: "score:intermediario",
    recommendedAction: ACTIONS.exige_analise,
    translatedReasons: reasons,
    ruleHits: hits,
  };
}

import type { MakfilOutcome, MakScoreReviewStatus } from "../types";

/**
 * Decisao efetiva = o que o usuario deve seguir agora, combinando a
 * decisao automatica (outcome) com a analise manual (reviewStatus).
 *
 * Regra (manual sobrepoe): approved -> aprovado, rejected -> reprovado,
 * pending -> exige_analise. Sem review (none) usa o outcome automatico.
 *
 * NUNCA altera outcome/primaryRule/ruleHits automaticos - apenas deriva
 * a leitura final (rastreabilidade preservada).
 */
export interface EffectiveDecision {
  status: MakfilOutcome;
  label: string;
  source: "automatic" | "manual";
}

const AUTO_LABELS: Record<MakfilOutcome, string> = {
  aprovado: "Aprovado",
  reprovado: "Reprovado",
  exige_analise: "Exige análise",
  indisponivel_temporariamente: "Indisponível temporariamente",
};

export function computeEffectiveDecision(
  outcome: MakfilOutcome,
  reviewStatus: MakScoreReviewStatus = "none",
): EffectiveDecision {
  switch (reviewStatus) {
    case "approved":
      return { status: "aprovado", label: "Aprovado (análise manual)", source: "manual" };
    case "rejected":
      return { status: "reprovado", label: "Reprovado (análise manual)", source: "manual" };
    case "pending":
      return { status: "exige_analise", label: "Em análise manual", source: "manual" };
    default:
      return { status: outcome, label: AUTO_LABELS[outcome], source: "automatic" };
  }
}

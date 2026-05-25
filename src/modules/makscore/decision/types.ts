import type { MakScoreConfig } from "../config";
import type { MakfilOutcome, MakScoreContext, NormalizedEposi } from "../types";
import type { ReasonCodeInfo } from "../reasonCodes";

/**
 * Contratos do Decision Engine MakFil.
 *
 * Separa explicitamente: entrada da operacao, dados normalizados,
 * avaliacao de regras e decisao final. Cada regra emite um RuleHit
 * (codigo, severidade, explicacao operacional e impacto). O engine
 * agrega os hits numa MakfilDecision deterministica.
 */

export type RiskLevel = "baixo" | "medio" | "alto" | "critico" | "indeterminado";

export type RuleSeverity = "block" | "review" | "approve" | "info";

export type RuleCategory =
  | "eposi_error"
  | "cadastral"
  | "score"
  | "restritivo"
  | "reason"
  | "ticket"
  | "questionnaire"
  | "recency_info";

/**
 * Entrada da operacao (alem do CNPJ, validado/normalizado fora daqui).
 * `commercialContext` fica RESERVADO no contrato - nesta fase nao e
 * validado no Zod, nao e usado nas regras e nao e persistido.
 */
export interface DecisionInput {
  userId?: string;
  proposalId?: string;
  ticketPretendido?: number;
  durationMonths?: number;
  questionnaire?: import("../questionnaire").MakScoreQuestionnaireAnswers;
  commercialContext?: Record<string, string | number>;
}

export interface RuleHit {
  /** Codigo estavel da regra (compativel com primaryRule atual). */
  code: string;
  category: RuleCategory;
  severity: RuleSeverity;
  /** Outcome que esta regra imporia isoladamente. */
  outcome: MakfilOutcome;
  /** Explicacao operacional (para humano/analista). */
  explanation: string;
  /** Como a regra afeta a decisao final. */
  impact: string;
  /** Desempate na escolha do primaryRule (maior vence). */
  priority: number;
}

export interface RuleContext {
  normalized: NormalizedEposi;
  cfg: MakScoreConfig;
  input: DecisionInput;
  /** ReasonCodes ja traduzidos (evita retraduzir em cada regra). */
  reasons: ReasonCodeInfo[];
}

export interface MakfilRule {
  id: string;
  evaluate(ctx: RuleContext): RuleHit | null;
}

/** Adaptador: MakScoreContext (legado) -> DecisionInput. */
export function toDecisionInput(ctx?: MakScoreContext): DecisionInput {
  return {
    userId: ctx?.userId,
    proposalId: ctx?.proposalId,
    ticketPretendido: ctx?.ticketPretendido,
    durationMonths: ctx?.durationMonths,
    questionnaire: ctx?.questionnaire,
    // commercialContext intencionalmente ignorado nesta fase.
  };
}

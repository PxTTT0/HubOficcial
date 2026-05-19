import type { MakScoreConfig } from "./config";
import { lookupErrorCode } from "./errorCodes";
import { hasCriticalReason, translateReasonCodes } from "./reasonCodes";
import type { MakfilDecision, MakScoreContext, NormalizedEposi } from "./types";

const ACTIONS: Record<MakfilDecision["outcome"], string> = {
  aprovado: "Seguir com a proposta nos limites comerciais padrao.",
  reprovado: "Nao prosseguir com a venda. Encaminhar conforme politica interna.",
  exige_analise: "Encaminhar para analise manual antes de prosseguir.",
  indisponivel_temporariamente:
    "Tentar novamente em alguns minutos ou seguir fluxo de fallback manual.",
};

export function applyMakfilPolicy(
  n: NormalizedEposi,
  cfg: MakScoreConfig,
  ctx?: MakScoreContext,
): MakfilDecision {
  const reasons = translateReasonCodes(n.reasonCodes);
  const decide = (
    outcome: MakfilDecision["outcome"],
    primaryRule: string,
  ): MakfilDecision => ({
    outcome,
    primaryRule,
    recommendedAction: ACTIONS[outcome],
    translatedReasons: reasons,
  });

  // 1) ErrorCode E-POSI tem prioridade absoluta. HTTP 200 com ErrorCode
  //    NUNCA pode virar aprovacao automatica.
  const errInfo = lookupErrorCode(n.errorCode);
  if (errInfo) return decide(errInfo.outcome, `eposi:${errInfo.reason}`);

  // 2) Situacao cadastral irregular reprova.
  if (
    n.cadastralStatus === "inapta" ||
    n.cadastralStatus === "baixada" ||
    n.cadastralStatus === "nula" ||
    n.cadastralStatus === "suspensa"
  ) {
    return decide("reprovado", `cadastral:${n.cadastralStatus}`);
  }

  // 3) Sem score interpretavel -> exige analise (falha ambigua).
  if (n.score === null) {
    return decide("exige_analise", "score:ausente");
  }

  // 4) Score muito baixo NAO reprova automaticamente sozinho. Vai para
  //    exige analise (decisao Makfil: bloqueio so com base legal/cadastral).
  if (n.score <= cfg.reproveMaxScore) {
    return decide("exige_analise", "score:baixo");
  }

  // 5) Restritivos relevantes -> exige analise (nunca reprovacao automatica).
  if (n.hasNegativacao || n.hasProtesto) {
    return decide("exige_analise", "restritivo:presente");
  }

  // 6) Reason codes criticos -> exige analise.
  if (hasCriticalReason(n.reasonCodes)) {
    return decide("exige_analise", "reason:critico");
  }

  // 7) Status cadastral desconhecido em modo live -> exige analise.
  if (n.cadastralStatus === "desconhecida" && !n.sourceIsMock) {
    return decide("exige_analise", "cadastral:desconhecida");
  }

  // 8) Ticket pretendido alto reforca exige analise quando o cenario tem
  //    sinais de fragilidade (score intermediario, empresa recente,
  //    poucas informacoes no cadastro positivo). Ausencia de ticket nao
  //    afeta a decisao. Ticket sozinho nao aprova nem reprova.
  const isHighTicket =
    typeof ctx?.ticketPretendido === "number" &&
    ctx.ticketPretendido > 0 &&
    ctx.ticketPretendido >= cfg.highTicketAmount;

  if (isHighTicket) {
    const isIntermediario = n.score < cfg.approveMinScore;
    const recente = reasons.some((r) => r.code === "R1");
    const baixaInfo = reasons.some((r) => r.code === "R2" || r.code === "R0");
    if (isIntermediario || recente || baixaInfo) {
      return decide("exige_analise", "ticket:alto_risco_intermediario");
    }
  }

  // 9) Score acima do limite: aprovado.
  if (n.score >= cfg.approveMinScore) {
    return decide("aprovado", "score:aprovado");
  }

  return decide("exige_analise", "score:intermediario");
}

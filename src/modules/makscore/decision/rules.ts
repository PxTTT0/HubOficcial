import { lookupErrorCode } from "../errorCodes";
import type { MakfilRule, RuleHit } from "./types";

/**
 * Conjunto de regras MakFil, extensivel. A ORDEM e as PRIORIDADES
 * reproduzem a politica sequencial anterior (paridade garantida):
 *
 *   eposi-error (override) > cadastral-irregular (block) >
 *   score-ausente/baixo (review) > restritivo > reason-critico >
 *   cadastral-desconhecida > ticket-alto > score-aprovado (approve) >
 *   score-intermediario (fallback)
 *
 * Cada regra emite no maximo um RuleHit. O engine agrega.
 */

// Prioridades (maior vence no desempate do primaryRule).
const P = {
  eposi: 100,
  cadastralIrregular: 90,
  scoreAusente: 70,
  scoreBaixo: 70,
  restritivo: 65,
  reasonCritico: 60,
  cadastralDesconhecida: 55,
  ticket: 50,
  scoreAprovado: 10,
  scoreIntermediario: 5,
} as const;

const IRREGULAR = new Set(["inapta", "baixada", "nula", "suspensa"]);

export const MAKFIL_RULES: MakfilRule[] = [
  // 1) ErrorCode E-POSI: override absoluto. HTTP 200 com ErrorCode nunca
  //    vira aprovacao automatica.
  {
    id: "eposi-error",
    evaluate({ normalized }): RuleHit | null {
      const info = lookupErrorCode(normalized.errorCode);
      if (!info) return null;
      const severity =
        info.outcome === "reprovado"
          ? "block"
          : info.outcome === "aprovado"
            ? "approve"
            : info.outcome === "indisponivel_temporariamente"
              ? "info"
              : "review";
      return {
        code: `eposi:${info.reason}`,
        category: "eposi_error",
        severity,
        outcome: info.outcome,
        explanation: `E-POSI retornou ErrorCode ${info.code}: ${info.message}.`,
        impact: "Define o desfecho diretamente (override sobre score/cadastro).",
        priority: P.eposi,
      };
    },
  },

  // 2) Situacao cadastral irregular -> reprovado.
  {
    id: "cadastral-irregular",
    evaluate({ normalized }): RuleHit | null {
      if (!IRREGULAR.has(normalized.cadastralStatus)) return null;
      return {
        code: `cadastral:${normalized.cadastralStatus}`,
        category: "cadastral",
        severity: "block",
        outcome: "reprovado",
        explanation: `Situacao cadastral "${normalized.cadastralStatus}" impede a operacao.`,
        impact: "Bloqueia a venda (reprovado).",
        priority: P.cadastralIrregular,
      };
    },
  },

  // 3) Score ausente -> exige analise (falha ambigua).
  {
    id: "score-ausente",
    evaluate({ normalized }): RuleHit | null {
      if (normalized.score !== null) return null;
      return {
        code: "score:ausente",
        category: "score",
        severity: "review",
        outcome: "exige_analise",
        explanation: "Score nao interpretavel/ausente na resposta.",
        impact: "Empurra para analise manual.",
        priority: P.scoreAusente,
      };
    },
  },

  // 4) Score muito baixo -> exige analise (nunca reprova sozinho).
  {
    id: "score-baixo",
    evaluate({ normalized, cfg }): RuleHit | null {
      if (normalized.score === null) return null;
      if (normalized.score > cfg.reproveMaxScore) return null;
      return {
        code: "score:baixo",
        category: "score",
        severity: "review",
        outcome: "exige_analise",
        explanation: `Score ${normalized.score} <= limite de reprovacao (${cfg.reproveMaxScore}).`,
        impact: "Analise manual; bloqueio so com base legal/cadastral.",
        priority: P.scoreBaixo,
      };
    },
  },

  // 5) Restritivos (negativacao/protesto) -> exige analise.
  {
    id: "restritivo-presente",
    evaluate({ normalized }): RuleHit | null {
      if (!normalized.hasNegativacao && !normalized.hasProtesto) return null;
      const tipos = [
        normalized.hasNegativacao ? "negativacao" : null,
        normalized.hasProtesto ? "protesto" : null,
      ].filter(Boolean);
      return {
        code: "restritivo:presente",
        category: "restritivo",
        severity: "review",
        outcome: "exige_analise",
        explanation: `Restritivo presente: ${tipos.join(", ")}.`,
        impact: "Analise manual (nunca reprovacao automatica).",
        priority: P.restritivo,
      };
    },
  },

  // 6) ReasonCode critico -> exige analise.
  {
    id: "reason-critico",
    evaluate({ reasons }): RuleHit | null {
      const crit = reasons.filter((r) => r.critical);
      if (crit.length === 0) return null;
      return {
        code: "reason:critico",
        category: "reason",
        severity: "review",
        outcome: "exige_analise",
        explanation: `ReasonCode critico: ${crit.map((r) => r.code).join(", ")}.`,
        impact: "Analise manual por fator de risco relevante.",
        priority: P.reasonCritico,
      };
    },
  },

  // 7) Cadastral desconhecida em modo live -> exige analise.
  {
    id: "cadastral-desconhecida",
    evaluate({ normalized }): RuleHit | null {
      if (normalized.cadastralStatus !== "desconhecida" || normalized.sourceIsMock) {
        return null;
      }
      return {
        code: "cadastral:desconhecida",
        category: "cadastral",
        severity: "review",
        outcome: "exige_analise",
        explanation: "Situacao cadastral desconhecida em consulta real.",
        impact: "Analise manual ate confirmar o cadastro.",
        priority: P.cadastralDesconhecida,
      };
    },
  },

  // 8) Ticket alto + fragilidade (score intermediario, empresa recente R1,
  //    baixa info R0/R2) -> reforca exige analise. Ticket sozinho nao
  //    aprova nem reprova.
  {
    id: "ticket-alto-risco-intermediario",
    evaluate({ normalized, cfg, input, reasons }): RuleHit | null {
      const ticket = input.ticketPretendido;
      const isHighTicket =
        typeof ticket === "number" && ticket > 0 && ticket >= cfg.highTicketAmount;
      if (!isHighTicket) return null;
      const intermediario = normalized.score !== null && normalized.score < cfg.approveMinScore;
      const recente = reasons.some((r) => r.code === "R1");
      const baixaInfo = reasons.some((r) => r.code === "R2" || r.code === "R0");
      if (!intermediario && !recente && !baixaInfo) return null;
      return {
        code: "ticket:alto_risco_intermediario",
        category: "ticket",
        severity: "review",
        outcome: "exige_analise",
        explanation: "Ticket alto combinado com sinais de fragilidade.",
        impact: "Analise manual reforcada pelo valor da operacao.",
        priority: P.ticket,
      };
    },
  },

  // 9) Score acima do limite -> aprovado (proposta de aprovacao).
  {
    id: "score-aprovado",
    evaluate({ normalized, cfg }): RuleHit | null {
      if (normalized.score === null) return null;
      if (normalized.score < cfg.approveMinScore) return null;
      return {
        code: "score:aprovado",
        category: "score",
        severity: "approve",
        outcome: "aprovado",
        explanation: `Score ${normalized.score} >= limite de aprovacao (${cfg.approveMinScore}).`,
        impact: "Sugere aprovacao quando nao ha bloqueio/analise.",
        priority: P.scoreAprovado,
      };
    },
  },

  // 10) Score intermediario (entre reprova e aprova) -> exige analise.
  {
    id: "score-intermediario",
    evaluate({ normalized, cfg }): RuleHit | null {
      if (normalized.score === null) return null;
      if (normalized.score <= cfg.reproveMaxScore) return null;
      if (normalized.score >= cfg.approveMinScore) return null;
      return {
        code: "score:intermediario",
        category: "score",
        severity: "review",
        outcome: "exige_analise",
        explanation: `Score ${normalized.score} entre ${cfg.reproveMaxScore} e ${cfg.approveMinScore}.`,
        impact: "Analise manual por risco intermediario.",
        priority: P.scoreIntermediario,
      };
    },
  },
];

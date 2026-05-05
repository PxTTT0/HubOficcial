// Mapeamento dos ErrorCodes E-POSI documentados em
// .planning/MAKSCORE-ANALYSIS.md. Cada codigo aponta para um estado
// final Makfil seguro, nao para uma mensagem generica.

import type { MakfilOutcome } from "./types";

export interface ErrorCodeInfo {
  code: string;
  outcome: MakfilOutcome;
  reason: string;
  message: string;
}

export const ERROR_CODE_MAP: Record<string, ErrorCodeInfo> = {
  "1001": {
    code: "1001",
    outcome: "reprovado",
    reason: "cnpj_invalido",
    message: "CNPJ invalido",
  },
  "1002": {
    code: "1002",
    outcome: "exige_analise",
    reason: "cnpj_nao_disponivel",
    message: "CNPJ nao disponivel na base",
  },
  "1003": {
    code: "1003",
    outcome: "reprovado",
    reason: "bloqueio_judicial",
    message: "Bloqueio judicial",
  },
  "1004": {
    code: "1004",
    outcome: "reprovado",
    reason: "bloqueio_administrativo",
    message: "Bloqueio administrativo",
  },
  "1005": {
    code: "1005",
    outcome: "reprovado",
    reason: "situacao_cadastral_irregular",
    message: "CNPJ inapto, baixado, nulo ou suspenso",
  },
  "1006": {
    code: "1006",
    outcome: "exige_analise",
    reason: "opt_out",
    message: "Opt-Out: titular optou por nao compartilhar dados",
  },
  "1007": {
    code: "1007",
    outcome: "reprovado",
    reason: "empresa_falida",
    message: "Empresa falida",
  },
  "1010": {
    code: "1010",
    outcome: "exige_analise",
    reason: "informacao_insuficiente",
    message: "Sem informacoes suficientes para calculo",
  },
  "1021": {
    code: "1021",
    outcome: "indisponivel_temporariamente",
    reason: "provedor_indisponivel",
    message: "Provedor temporariamente indisponivel",
  },
  "1035": {
    code: "1035",
    outcome: "exige_analise",
    reason: "fora_publico_alvo",
    message: "CNPJ fora do publico alvo da solucao",
  },
  "1540": {
    code: "1540",
    outcome: "indisponivel_temporariamente",
    reason: "sem_permissao",
    message: "Sem permissao para consulta no provedor",
  },
};

export function lookupErrorCode(code: string | undefined | null): ErrorCodeInfo | null {
  if (!code) return null;
  return ERROR_CODE_MAP[String(code)] ?? null;
}

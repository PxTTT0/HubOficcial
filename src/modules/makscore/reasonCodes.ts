// Tabela inicial de ReasonCodes baseada na documentacao E-POSI
// (R0..R47706 conforme apendice). O dicionario oficial Makfil ainda
// nao foi formalizado: as descricoes abaixo sao genericas / temporarias
// e a flag "critical" reflete os fatores que historicamente indicam
// risco financeiro relevante.
//
// Comportamento defensivo: codigos desconhecidos sao aceitos e retornam
// label = code, critical = false (nao bloqueiam decisao automatica).

export interface ReasonCodeInfo {
  code: string;
  label: string;
  critical: boolean;
}

export const REASON_CODE_MAP: Record<string, ReasonCodeInfo> = {
  R0: { code: "R0", label: "Score sem motivo destacado", critical: false },
  R1: { code: "R1", label: "Empresa recente", critical: false },
  R2: { code: "R2", label: "Poucas informacoes no Cadastro Positivo", critical: false },
  R3: { code: "R3", label: "Atrasos ou pendencias financeiras", critical: true },
  R4: { code: "R4", label: "Alta quantidade de contratacoes recentes", critical: false },
  R5: { code: "R5", label: "Historico de atrasos", critical: true },
  R6: { code: "R6", label: "Comprometimento financeiro elevado", critical: true },
  R7: { code: "R7", label: "Baixo volume de pagamentos em dia", critical: false },
  R8: { code: "R8", label: "Relacionamento reduzido com instituicoes financeiras", critical: false },
  R9: { code: "R9", label: "Indicadores cadastrais limitados", critical: false },
  R10: { code: "R10", label: "Baixa diversidade de relacionamento bancario", critical: false },
  R11: { code: "R11", label: "Restritivos historicos", critical: true },
  R12: { code: "R12", label: "Concentracao em poucos credores", critical: false },
  R13: { code: "R13", label: "Volume baixo de operacoes ativas", critical: false },
  R14: { code: "R14", label: "Tempo curto desde ultima negativacao", critical: true },
  R15: { code: "R15", label: "Acoes judiciais associadas", critical: true },
  R16: { code: "R16", label: "Tendencia de inadimplencia recente", critical: true },
  R17: { code: "R17", label: "Padrao de pagamento instavel", critical: false },
  R18: { code: "R18", label: "Aumento de exposicao financeira", critical: false },
  R19: { code: "R19", label: "Quadro societario com restritivos", critical: true },
  R20: { code: "R20", label: "Baixo volume historico de consultas", critical: false },
  R21: { code: "R21", label: "Setor com risco elevado", critical: false },
  R22: { code: "R22", label: "Score historico baixo", critical: true },
  R23: { code: "R23", label: "Endereco recente / pouco estavel", critical: false },
  R24: { code: "R24", label: "Comportamento atipico de consulta", critical: false },
  R25: { code: "R25", label: "Indicadores de risco moderado", critical: false },
  R26: { code: "R26", label: "Pagamentos inconsistentes", critical: true },
  R27: { code: "R27", label: "Capacidade de pagamento limitada", critical: false },
  R28: { code: "R28", label: "Renovacoes de divida frequentes", critical: false },
  R29: { code: "R29", label: "Baixa atividade comercial recente", critical: false },
  R30: { code: "R30", label: "Concentracao de vencimentos proximos", critical: false },
  R31: { code: "R31", label: "Volume baixo de pagamentos em dia", critical: false },
};

export function translateReasonCodes(codes: string[]): ReasonCodeInfo[] {
  return codes
    .filter(Boolean)
    .map((c) => {
      const norm = String(c).trim().toUpperCase();
      if (REASON_CODE_MAP[norm]) return REASON_CODE_MAP[norm];
      // Codigos desconhecidos (ex.: R47706 do apendice) sao aceitos sem marcar
      // como criticos. Quando o dicionario oficial Makfil chegar, atualizar
      // este mapa - ate la, decisao critica fica sob responsabilidade da
      // politica (score, restritivos, ErrorCode).
      return { code: norm, label: norm, critical: false };
    });
}

export function hasCriticalReason(codes: string[]): boolean {
  return translateReasonCodes(codes).some((r) => r.critical);
}

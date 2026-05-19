import type { EposiProduct } from "./config";

export type MakfilOutcome =
  | "aprovado"
  | "reprovado"
  | "exige_analise"
  | "indisponivel_temporariamente";

export type CadastralStatus =
  | "ativa"
  | "inapta"
  | "baixada"
  | "suspensa"
  | "nula"
  | "desconhecida";

export interface NormalizedEposi {
  product: EposiProduct;
  // 0..1000 quando disponivel; null se ausente ou erro.
  score: number | null;
  reasonCodes: string[];
  errorCode: string | null;
  errorMessage: string | null;
  cadastralStatus: CadastralStatus;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  naturezaJuridica: string | null;
  cnaePrincipal: string | null;
  dataAbertura: string | null;
  endereco: string | null;
  email: string | null;
  telefone: string | null;
  hasNegativacao: boolean;
  hasProtesto: boolean;
  consultasAnteriores: number | null;
  // Indica que a fonte foi um mock controlado (homologacao).
  sourceIsMock: boolean;
}

export interface MakfilDecision {
  outcome: MakfilOutcome;
  primaryRule: string;
  recommendedAction: string;
  translatedReasons: { code: string; label: string; critical: boolean }[];
}

export interface MakScoreContext {
  userId?: string;
  proposalId?: string;
  // Valor pretendido da operacao (BRL). Usado pela politica Makfil
  // como reforco para `exige_analise` em risco intermediario.
  // Ausencia nao quebra a consulta.
  ticketPretendido?: number;
  // Reservado para evolucao futura: parecer manual quando
  // outcome === "exige_analise". NAO altera o outcome automatico.
  parecerManual?: string;
}

export interface MakScoreResult {
  correlationId: string;
  cnpj: string; // sempre mascarado para resposta de API
  product: EposiProduct;
  score: number | null;
  outcome: MakfilOutcome;
  primaryRule: string;
  recommendedAction: string;
  reasons: { code: string; label: string; critical: boolean }[];
  errorCode: string | null;
  errorMessage: string | null;
  validUntil: string;
  consultedAt: string;
  sourceIsMock: boolean;
  cadastral: {
    status: CadastralStatus;
    razaoSocial: string | null;
    cnaePrincipal: string | null;
    dataAbertura: string | null;
  };
  context?: MakScoreContext;
}

export interface PersistedMakScore extends MakScoreResult {
  cnpjHash: string;
  createdAtMs: number;
  expiresAtMs: number;
}

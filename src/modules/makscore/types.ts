import type { EposiProduct } from "./config";
import type { RiskLevel, RuleHit } from "./decision/types";
import type {
  MakScoreQuestionnaireAnswers,
  MakScoreQuestionnaireScore,
} from "./questionnaire";

export type { RiskLevel, RuleHit } from "./decision/types";
export type {
  MakScoreQuestionnaireAnswers,
  MakScoreQuestionnaireScore,
} from "./questionnaire";

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
  // Nivel de risco derivado (aditivo).
  riskLevel: RiskLevel;
  primaryRule: string;
  recommendedAction: string;
  translatedReasons: { code: string; label: string; critical: boolean }[];
  // Regras que dispararam (tecnico; projetado so p/ analista/admin).
  ruleHits: RuleHit[];
}

export interface MakScoreContext {
  userId?: string;
  proposalId?: string;
  // Valor pretendido da operacao (BRL). Usado pela politica Makfil
  // como reforco para `exige_analise` em risco intermediario.
  // Ausencia nao quebra a consulta.
  ticketPretendido?: number;
  // Prazo/duracao da operacao (meses). Reservado para regras futuras
  // de ticket; ausencia nao afeta a decisao.
  durationMonths?: number;
  // Questionario operacional Makfil. Quando presente, alimenta o
  // Decision Engine e fica persistido junto ao resultado.
  questionnaire?: MakScoreQuestionnaireAnswers;
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
  riskLevel: RiskLevel;
  primaryRule: string;
  recommendedAction: string;
  reasons: { code: string; label: string; critical: boolean }[];
  // Tecnico (projetado so p/ analista/admin).
  ruleHits: RuleHit[];
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
  questionnaire?: {
    answers: MakScoreQuestionnaireAnswers;
    score: MakScoreQuestionnaireScore;
  };
}

export type MakScoreReviewStatus = "none" | "pending" | "approved" | "rejected";

// Status alvo aceitos no endpoint de review (nao permite voltar p/ none).
export type MakScoreReviewTargetStatus = "pending" | "approved" | "rejected";

export interface MakScoreReviewEvent {
  correlationId: string;
  fromStatus: MakScoreReviewStatus;
  toStatus: MakScoreReviewStatus;
  reviewerId: string;
  note: string | null;
  createdAtMs: number;
}

export interface ReviewActionInput {
  correlationId: string;
  toStatus: MakScoreReviewTargetStatus;
  reviewerId: string;
  note?: string | null;
}

/** Resultado de applyReview: registro atualizado + status anterior. */
export interface ReviewApplied {
  record: PersistedMakScore;
  fromStatus: MakScoreReviewStatus;
}

export interface PersistedMakScore extends MakScoreResult {
  cnpjHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  // Estrutura de revisao manual (reservada; sem mutacao nesta branch).
  reviewStatus: MakScoreReviewStatus;
  reviewerId?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
}

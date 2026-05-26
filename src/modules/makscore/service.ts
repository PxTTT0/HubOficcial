import { randomUUID } from "crypto";
import { isValidCnpj, maskCnpjForLog, onlyDigits } from "./cnpj";
import type { EposiProduct, MakScoreConfig } from "./config";
import type { EposiClient } from "./eposiClient";
import { normalizeEposi } from "./normalizer";
import { applyMakfilPolicy } from "./policy";
import {
  scoreQuestionnaire,
  suggestQuestionnaireFromEposi,
  type QuestionnaireSuggestion,
} from "./questionnaire";
import {
  hashCnpj,
  type MakScoreHistoryFilter,
  type MakScoreRepository,
} from "./repository";
import type {
  MakScoreContext,
  MakScoreResult,
  MakScoreReviewEvent,
  MakScoreReviewStatus,
  PersistedMakScore,
  ReviewActionInput,
  ReviewApplied,
} from "./types";

/**
 * Retorno publico de `service.query`. Inclui `reviewStatus` para que a
 * rota possa compor a decisao efetiva corretamente mesmo em cache hit
 * (consulta repetida apos analise manual). Nunca inclui campos
 * exclusivos de persistencia (cnpjHash/createdAtMs/etc.) -- esses ficam
 * confinados ao repositorio.
 */
export interface MakScoreQueryResult extends MakScoreResult {
  reviewStatus: MakScoreReviewStatus;
}
import {
  InMemoryAuditSink,
  makeAuditEvent,
  type AuditEvent,
  type AuditSink,
} from "./audit";

export interface QueryInput {
  cnpj: string;
  product?: EposiProduct;
  context?: MakScoreContext;
  forceRefresh?: boolean;
}

export interface PrefillInput {
  cnpj: string;
  product?: EposiProduct;
  userId?: string;
}

/**
 * Resultado do prefill. NAO contem decisao -- apenas o snapshot
 * cadastral/score do E-POSI + sugestoes para o questionario do front.
 * NUNCA persiste e NUNCA passa pelo decision engine.
 */
export interface PrefillResult {
  cadastralStatus: string;
  razaoSocial: string | null;
  cnaePrincipal: string | null;
  dataAbertura: string | null;
  score: number | null;
  hasNegativacao: boolean;
  hasProtesto: boolean;
  sourceIsMock: boolean;
  suggestion: QuestionnaireSuggestion;
}

export class MakScoreInputError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export class MakScoreService {
  constructor(
    private cfg: MakScoreConfig,
    private client: EposiClient,
    private repo: MakScoreRepository,
    private audit: AuditSink = new InMemoryAuditSink(),
  ) {}

  get auditSink(): AuditSink {
    return this.audit;
  }

  /** Histórico (append-only). RBAC/projeção ficam na camada de rota. */
  history(filter: MakScoreHistoryFilter): Promise<PersistedMakScore[]> {
    return this.repo.listHistory(filter);
  }

  countHistory(filter: MakScoreHistoryFilter): Promise<number> {
    return this.repo.countHistory(filter);
  }

  /** Detalhe por correlationId. RBAC/projeção ficam na camada de rota. */
  getResult(correlationId: string): Promise<PersistedMakScore | null> {
    return this.repo.findByCorrelationId(correlationId);
  }

  /**
   * Aplica análise manual (atômico: estado + trilha). RBAC/auditoria
   * ficam na rota. Retorna null se o correlationId não existir.
   */
  review(input: ReviewActionInput): Promise<ReviewApplied | null> {
    return this.repo.applyReview(input);
  }

  /** Trilha de eventos de review (analista/admin). */
  reviewEvents(correlationId: string): Promise<MakScoreReviewEvent[]> {
    return this.repo.listReviewEvents(correlationId);
  }

  // Auditoria funcional e best-effort: DB e assincrono e uma falha de
  // persistencia NUNCA pode bloquear/derrubar a consulta MakScore.
  private emitAudit(ev: AuditEvent): void {
    void this.audit.write(ev).catch(() => {
      /* engolido: PgMakScoreAuditSink ja loga com throttle */
    });
  }

  /**
   * Consulta E-POSI sem decidir, sem persistir. Usado pelo front para
   * pre-preencher o questionario assim que o vendedor termina de
   * digitar o CNPJ. Decisao oficial sai apenas em `query()` com o
   * questionario completo.
   */
  async prefill(input: PrefillInput): Promise<PrefillResult> {
    const correlationId = randomUUID();
    const cnpj = onlyDigits(input.cnpj);
    const product = input.product ?? this.cfg.defaultProduct;

    if (!isValidCnpj(cnpj)) {
      this.emitAudit(
        makeAuditEvent({
          type: "prefill.invalid_input",
          correlationId,
          cnpj,
          userId: input.userId,
          message: "CNPJ invalido",
        }),
      );
      throw new MakScoreInputError("cnpj_invalido", "CNPJ invalido");
    }

    this.emitAudit(
      makeAuditEvent({
        type: "prefill.start",
        correlationId,
        cnpj,
        product,
        userId: input.userId,
      }),
    );

    let raw;
    try {
      raw = await this.client.query(cnpj, product);
    } catch (err: any) {
      this.emitAudit(
        makeAuditEvent({
          type: "prefill.fail",
          correlationId,
          cnpj,
          product,
          userId: input.userId,
          message: String(err?.message ?? err),
        }),
      );
      throw err;
    }
    const normalized = normalizeEposi(raw, product);
    const suggestion = suggestQuestionnaireFromEposi(
      {
        cadastralStatus: normalized.cadastralStatus,
        dataAbertura: normalized.dataAbertura,
        score: normalized.score,
        hasProtesto: normalized.hasProtesto,
        hasNegativacao: normalized.hasNegativacao,
      },
      this.cfg.approveMinScore,
    );

    this.emitAudit(
      makeAuditEvent({
        type: "prefill.ok",
        correlationId,
        cnpj,
        product,
        sourceIsMock: normalized.sourceIsMock,
        userId: input.userId,
      }),
    );

    return {
      cadastralStatus: normalized.cadastralStatus,
      razaoSocial: normalized.razaoSocial,
      cnaePrincipal: normalized.cnaePrincipal,
      dataAbertura: normalized.dataAbertura,
      score: normalized.score,
      hasNegativacao: normalized.hasNegativacao,
      hasProtesto: normalized.hasProtesto,
      sourceIsMock: normalized.sourceIsMock,
      suggestion,
    };
  }

  async query(input: QueryInput): Promise<MakScoreQueryResult> {
    const correlationId = randomUUID();
    const cnpj = onlyDigits(input.cnpj);
    const product = input.product ?? this.cfg.defaultProduct;
    const start = Date.now();

    if (!isValidCnpj(cnpj)) {
      this.emitAudit(
        makeAuditEvent({
          type: "query.invalid_input",
          correlationId,
          cnpj,
          userId: input.context?.userId,
          message: "CNPJ invalido",
        }),
      );
      throw new MakScoreInputError("cnpj_invalido", "CNPJ invalido");
    }

    this.emitAudit(
      makeAuditEvent({
        type: "query.start",
        correlationId,
        cnpj,
        product,
        userId: input.context?.userId,
      }),
    );

    // O questionario altera a decisao MakScore. Reusar cache por CNPJ aqui
    // poderia devolver uma aprovacao/reprovacao gerada com respostas antigas.
    const hasQuestionnaireDecision = Boolean(input.context?.questionnaire);
    if (!input.forceRefresh && !hasQuestionnaireDecision) {
      const cached = await this.repo.findValidByCnpj(cnpj);
      if (cached) {
        this.emitAudit(
          makeAuditEvent({
            type: "query.cache_hit",
            correlationId,
            cnpj,
            product: cached.product,
            outcome: cached.outcome,
            userId: input.context?.userId,
          }),
        );
        // IMPORTANTE: nao espalhar `cached` direto. PersistedMakScore tem
        // campos so de persistencia (cnpjHash/createdAtMs/expiresAtMs/
        // reviewerId/reviewNote/reviewedAt) que NUNCA devem sair do
        // repositorio na resposta de /query. reviewStatus vem separado
        // para a rota compor effectiveDecision (manual sobrepoe automatico
        // mesmo em cache hit).
        const {
          cnpjHash: _cnpjHash,
          createdAtMs: _createdAtMs,
          expiresAtMs: _expiresAtMs,
          reviewerId: _reviewerId,
          reviewNote: _reviewNote,
          reviewedAt: _reviewedAt,
          reviewStatus,
          ...publicResult
        } = cached;
        return { ...publicResult, correlationId, reviewStatus };
      }
    }

    let result: MakScoreQueryResult;
    try {
      const raw = await this.client.query(cnpj, product);
      this.emitAudit(
        makeAuditEvent({
          type: "query.external_ok",
          correlationId,
          cnpj,
          product,
          httpStatus: raw.httpStatus,
          sourceIsMock: raw.fromMock,
          userId: input.context?.userId,
        }),
      );

      const normalized = normalizeEposi(raw, product);
      const decision = applyMakfilPolicy(normalized, this.cfg, input.context);
      const questionnaire = input.context?.questionnaire
        ? {
            answers: input.context.questionnaire,
            score: scoreQuestionnaire(input.context.questionnaire),
          }
        : undefined;

      const consultedAt = new Date();
      const validUntilMs =
        consultedAt.getTime() + this.cfg.validityHours * 60 * 60 * 1000;

      result = {
        correlationId,
        cnpj: maskCnpjForLog(cnpj),
        product,
        score: normalized.score,
        outcome: decision.outcome,
        riskLevel: decision.riskLevel,
        primaryRule: decision.primaryRule,
        recommendedAction: decision.recommendedAction,
        reasons: decision.translatedReasons,
        ruleHits: decision.ruleHits,
        errorCode: normalized.errorCode,
        errorMessage: normalized.errorMessage,
        validUntil: new Date(validUntilMs).toISOString(),
        consultedAt: consultedAt.toISOString(),
        sourceIsMock: normalized.sourceIsMock,
        cadastral: {
          status: normalized.cadastralStatus,
          razaoSocial: normalized.razaoSocial,
          cnaePrincipal: normalized.cnaePrincipal,
          dataAbertura: normalized.dataAbertura,
        },
        context: input.context,
        questionnaire,
        // Consulta fresca: ainda nao tem analise manual.
        reviewStatus: "none",
      };

      const { reviewStatus: _rs, ...resultForPersist } = result;
      const persisted: PersistedMakScore = {
        ...resultForPersist, // cnpj ja mascarado (minimizacao em toda a app)
        cnpjHash: hashCnpj(cnpj),
        createdAtMs: consultedAt.getTime(),
        expiresAtMs: validUntilMs,
        reviewStatus: "none",
      };
      await this.repo.save(persisted);

      this.emitAudit(
        makeAuditEvent({
          type: "query.decision",
          correlationId,
          cnpj,
          product,
          outcome: result.outcome,
          primaryRule: result.primaryRule,
          errorCode: result.errorCode,
          sourceIsMock: result.sourceIsMock,
          durationMs: Date.now() - start,
          userId: input.context?.userId,
        }),
      );

      return result;
    } catch (err: any) {
      // Falha externa NUNCA vira aprovacao. Estado seguro: indisponivel.
      this.emitAudit(
        makeAuditEvent({
          type: "query.external_fail",
          correlationId,
          cnpj,
          product,
          message: String(err?.message ?? err),
          userId: input.context?.userId,
        }),
      );
      const consultedAt = new Date();
      return {
        correlationId,
        cnpj: maskCnpjForLog(cnpj),
        product,
        score: null,
        outcome: "indisponivel_temporariamente",
        riskLevel: "indeterminado",
        primaryRule: "external:fail",
        recommendedAction:
          "Servico de score indisponivel. Tentar novamente em instantes.",
        reasons: [],
        ruleHits: [],
        errorCode: null,
        errorMessage: null,
        validUntil: consultedAt.toISOString(),
        consultedAt: consultedAt.toISOString(),
        sourceIsMock: false,
        cadastral: {
          status: "desconhecida",
          razaoSocial: null,
          cnaePrincipal: null,
          dataAbertura: null,
        },
        context: input.context,
        questionnaire: input.context?.questionnaire
          ? {
              answers: input.context.questionnaire,
              score: scoreQuestionnaire(input.context.questionnaire),
            }
          : undefined,
        // Falha externa: sem persistencia, logo sem review.
        reviewStatus: "none",
      };
    }
  }
}

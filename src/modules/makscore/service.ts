import { randomUUID } from "crypto";
import { isValidCnpj, maskCnpjForLog, onlyDigits } from "./cnpj";
import type { EposiProduct, MakScoreConfig } from "./config";
import type { EposiClient } from "./eposiClient";
import { normalizeEposi } from "./normalizer";
import { applyMakfilPolicy } from "./policy";
import { scoreQuestionnaire } from "./questionnaire";
import {
  hashCnpj,
  type MakScoreHistoryFilter,
  type MakScoreRepository,
} from "./repository";
import type {
  MakScoreContext,
  MakScoreResult,
  MakScoreReviewEvent,
  PersistedMakScore,
  ReviewActionInput,
  ReviewApplied,
} from "./types";
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

  async query(input: QueryInput): Promise<MakScoreResult> {
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
        return { ...cached, correlationId };
      }
    }

    let result: MakScoreResult;
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
      };

      const persisted: PersistedMakScore = {
        ...result, // result.cnpj ja vem mascarado (minimizacao em toda a app)
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
      };
    }
  }
}

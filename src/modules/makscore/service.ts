import { randomUUID } from "crypto";
import { isValidCnpj, maskCnpjForDisplay, onlyDigits } from "./cnpj";
import type { EposiProduct, MakScoreConfig } from "./config";
import type { EposiClient } from "./eposiClient";
import { normalizeEposi } from "./normalizer";
import { applyMakfilPolicy } from "./policy";
import { hashCnpj, type MakScoreRepository } from "./repository";
import type {
  MakScoreContext,
  MakScoreResult,
  PersistedMakScore,
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

    if (!input.forceRefresh) {
      const cached = this.repo.findValidByCnpj(cnpj);
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

      const consultedAt = new Date();
      const validUntilMs =
        consultedAt.getTime() + this.cfg.validityHours * 60 * 60 * 1000;

      result = {
        correlationId,
        cnpj: maskCnpjForDisplay(cnpj),
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
      };

      const persisted: PersistedMakScore = {
        ...result,
        cnpjHash: hashCnpj(cnpj),
        createdAtMs: consultedAt.getTime(),
        expiresAtMs: validUntilMs,
      };
      this.repo.save(persisted);

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
        cnpj: maskCnpjForDisplay(cnpj),
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
      };
    }
  }
}

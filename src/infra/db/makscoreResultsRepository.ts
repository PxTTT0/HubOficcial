import type { SqlExecutor } from "./pool";
import {
  hashCnpj,
  type MakScoreHistoryFilter,
  type MakScoreRepository,
} from "../../modules/makscore/repository";
import type {
  MakScoreResult,
  MakScoreReviewEvent,
  MakScoreReviewStatus,
  PersistedMakScore,
  ReviewActionInput,
  ReviewApplied,
} from "../../modules/makscore/types";

interface ResultRow {
  correlation_id: string;
  cnpj_hash: string;
  cnpj_masked: string;
  product: string;
  score: number | null;
  outcome: string;
  risk_level: string;
  primary_rule: string;
  recommended_action: string;
  reasons: unknown;
  rule_hits: unknown;
  cadastral: unknown;
  source_is_mock: boolean;
  error_code: string | null;
  error_message: string | null;
  proposal_id: string | null;
  user_id: string | null;
  valid_until: string;
  consulted_at: string;
  created_at_ms: string | number;
  expires_at_ms: string | number;
  review_status: string;
  reviewer_id: string | null;
  review_note: string | null;
  reviewed_at: string | null;
}

function asJson<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

function hydrate(row: ResultRow): PersistedMakScore {
  const context: PersistedMakScore["context"] = {};
  if (row.user_id) context.userId = row.user_id;
  if (row.proposal_id) context.proposalId = row.proposal_id;

  return {
    correlationId: row.correlation_id,
    cnpj: row.cnpj_masked,
    product: row.product as PersistedMakScore["product"],
    score: row.score,
    outcome: row.outcome as PersistedMakScore["outcome"],
    riskLevel: row.risk_level as PersistedMakScore["riskLevel"],
    primaryRule: row.primary_rule,
    recommendedAction: row.recommended_action,
    reasons: asJson<MakScoreResult["reasons"]>(row.reasons),
    ruleHits: asJson<MakScoreResult["ruleHits"]>(row.rule_hits),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    validUntil: row.valid_until,
    consultedAt: row.consulted_at,
    sourceIsMock: row.source_is_mock,
    cadastral: asJson<MakScoreResult["cadastral"]>(row.cadastral),
    context: Object.keys(context).length ? context : undefined,
    cnpjHash: row.cnpj_hash,
    createdAtMs: Number(row.created_at_ms),
    expiresAtMs: Number(row.expires_at_ms),
    reviewStatus: row.review_status as MakScoreReviewStatus,
    reviewerId: row.reviewer_id,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
  };
}

const SELECT = `
  SELECT correlation_id, cnpj_hash, cnpj_masked, product, score, outcome,
         risk_level, primary_rule, recommended_action, reasons, rule_hits,
         cadastral, source_is_mock, error_code, error_message, proposal_id,
         user_id, valid_until, consulted_at, created_at_ms, expires_at_ms,
         review_status, reviewer_id, review_note, reviewed_at
    FROM makscore_results`;

/**
 * Repositorio de resultados MakScore em Postgres. APPEND-ONLY (save =
 * INSERT). Cache = registro valido mais recente por cnpj_hash. Nunca
 * grava CNPJ aberto/payload/token/credenciais (so resumo seguro).
 */
export class PgMakScoreResultsRepository implements MakScoreRepository {
  constructor(private readonly exec: SqlExecutor) {}

  async save(r: PersistedMakScore): Promise<void> {
    await this.exec.query(
      `INSERT INTO makscore_results (
         correlation_id, cnpj_hash, cnpj_masked, product, score, outcome,
         risk_level, primary_rule, recommended_action, reasons, rule_hits,
         cadastral, source_is_mock, error_code, error_message, proposal_id,
         user_id, valid_until, consulted_at, created_at_ms, expires_at_ms,
         review_status, reviewer_id, review_note, reviewed_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
         $20,$21,$22,$23,$24,$25
       )
       ON CONFLICT (correlation_id) DO NOTHING`,
      [
        r.correlationId,
        r.cnpjHash,
        r.cnpj,
        r.product,
        r.score,
        r.outcome,
        r.riskLevel,
        r.primaryRule,
        r.recommendedAction,
        JSON.stringify(r.reasons),
        JSON.stringify(r.ruleHits),
        JSON.stringify(r.cadastral),
        r.sourceIsMock,
        r.errorCode,
        r.errorMessage,
        r.context?.proposalId ?? null,
        r.context?.userId ?? null,
        r.validUntil,
        r.consultedAt,
        r.createdAtMs,
        r.expiresAtMs,
        r.reviewStatus ?? "none",
        r.reviewerId ?? null,
        r.reviewNote ?? null,
        r.reviewedAt ?? null,
      ],
    );
  }

  async findValidByCnpj(
    cnpj: string,
    now = Date.now(),
  ): Promise<PersistedMakScore | null> {
    const r = await this.exec.query<ResultRow>(
      `${SELECT} WHERE cnpj_hash = $1 AND expires_at_ms > $2
        ORDER BY created_at_ms DESC LIMIT 1`,
      [hashCnpj(cnpj), now],
    );
    return r.rows[0] ? hydrate(r.rows[0]) : null;
  }

  async findByCorrelationId(
    correlationId: string,
  ): Promise<PersistedMakScore | null> {
    const r = await this.exec.query<ResultRow>(
      `${SELECT} WHERE correlation_id = $1`,
      [correlationId],
    );
    return r.rows[0] ? hydrate(r.rows[0]) : null;
  }

  async listHistory(filter: MakScoreHistoryFilter): Promise<PersistedMakScore[]> {
    const limit = Math.min(Math.max(filter.limit, 1), 200);
    const offset = Math.max(filter.offset, 0);
    if (filter.userId) {
      const r = await this.exec.query<ResultRow>(
        `${SELECT} WHERE user_id = $1 ORDER BY created_at_ms DESC LIMIT $2 OFFSET $3`,
        [filter.userId, limit, offset],
      );
      return r.rows.map(hydrate);
    }
    const r = await this.exec.query<ResultRow>(
      `${SELECT} ORDER BY created_at_ms DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows.map(hydrate);
  }

  async applyReview(input: ReviewActionInput): Promise<ReviewApplied | null> {
    const run = async (tx: SqlExecutor): Promise<ReviewApplied | null> => {
      const cur = await tx.query<{ review_status: string }>(
        "SELECT review_status FROM makscore_results WHERE correlation_id = $1",
        [input.correlationId],
      );
      if (!cur.rows[0]) return null;
      const fromStatus = cur.rows[0].review_status as MakScoreReviewStatus;
      const now = Date.now();
      // Estado atual (outcome/primary_rule/rule_hits NUNCA tocados aqui).
      await tx.query(
        `UPDATE makscore_results
            SET review_status = $2, reviewer_id = $3, review_note = $4, reviewed_at = $5
          WHERE correlation_id = $1`,
        [
          input.correlationId,
          input.toStatus,
          input.reviewerId,
          input.note ?? null,
          new Date(now).toISOString(),
        ],
      );
      // Trilha append-only (mesma transacao).
      await tx.query(
        `INSERT INTO makscore_review_events
           (correlation_id, from_status, to_status, reviewer_id, note, created_at_ms)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.correlationId, fromStatus, input.toStatus, input.reviewerId, input.note ?? null, now],
      );
      const updated = await tx.query<ResultRow>(
        `${SELECT} WHERE correlation_id = $1`,
        [input.correlationId],
      );
      return { record: hydrate(updated.rows[0]), fromStatus };
    };
    // Atomicidade real no Postgres; fallback sequencial em fakes (pg-mem).
    return this.exec.withTransaction ? this.exec.withTransaction(run) : run(this.exec);
  }

  async listReviewEvents(correlationId: string): Promise<MakScoreReviewEvent[]> {
    const r = await this.exec.query<{
      correlation_id: string;
      from_status: string;
      to_status: string;
      reviewer_id: string;
      note: string | null;
      created_at_ms: string | number;
    }>(
      `SELECT correlation_id, from_status, to_status, reviewer_id, note, created_at_ms
         FROM makscore_review_events
        WHERE correlation_id = $1
        ORDER BY created_at_ms ASC, id ASC`,
      [correlationId],
    );
    return r.rows.map((row) => ({
      correlationId: row.correlation_id,
      fromStatus: row.from_status as MakScoreReviewStatus,
      toStatus: row.to_status as MakScoreReviewStatus,
      reviewerId: row.reviewer_id,
      note: row.note,
      createdAtMs: Number(row.created_at_ms),
    }));
  }
}

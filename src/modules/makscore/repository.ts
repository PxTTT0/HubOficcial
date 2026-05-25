import { createHash } from "crypto";
import { onlyDigits } from "./cnpj";
import type {
  MakScoreReviewEvent,
  PersistedMakScore,
  ReviewActionInput,
  ReviewApplied,
} from "./types";

// Repositorio de resultados MakScore. APPEND-ONLY: cada consulta gera
// uma linha (historico real). Persiste apenas resumo e metadados,
// nunca o payload bruto da E-POSI nem o CNPJ aberto.

export interface MakScoreHistoryFilter {
  // Quando definido, restringe ao usuario (vendedor ve so as proprias).
  userId?: string;
  limit: number;
  offset: number;
}

export interface MakScoreRepository {
  findValidByCnpj(cnpj: string, now?: number): Promise<PersistedMakScore | null>;
  save(record: PersistedMakScore): Promise<void>;
  findByCorrelationId(correlationId: string): Promise<PersistedMakScore | null>;
  listHistory(filter: MakScoreHistoryFilter): Promise<PersistedMakScore[]>;
  /**
   * Aplica analise manual de forma ATOMICA: atualiza o estado atual da
   * review em makscore_results E insere o evento na trilha append-only,
   * na mesma transacao. Nunca altera outcome/primaryRule/ruleHits
   * automaticos. Retorna o registro atualizado + status anterior, ou
   * null se o correlationId nao existir.
   */
  applyReview(input: ReviewActionInput): Promise<ReviewApplied | null>;
  listReviewEvents(correlationId: string): Promise<MakScoreReviewEvent[]>;
}

export function hashCnpj(cnpj: string): string {
  // Hash determinista para indexacao sem armazenar CNPJ aberto em chave externa.
  // Usar pepper de ambiente quando existir.
  const pepper = process.env.MAKSCORE_CNPJ_PEPPER ?? "";
  return createHash("sha256").update(pepper + onlyDigits(cnpj)).digest("hex");
}

export class InMemoryMakScoreRepository implements MakScoreRepository {
  // Append-only: lista de registros (nao Map por hash) p/ manter historico.
  private records: PersistedMakScore[] = [];
  // Trilha append-only de eventos de review.
  private reviewEvents: MakScoreReviewEvent[] = [];

  async findValidByCnpj(
    cnpj: string,
    now = Date.now(),
  ): Promise<PersistedMakScore | null> {
    const key = hashCnpj(cnpj);
    // Mais recente valido por cnpj_hash.
    const valid = this.records
      .filter((r) => r.cnpjHash === key && r.expiresAtMs > now)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
    return valid[0] ?? null;
  }

  async save(record: PersistedMakScore): Promise<void> {
    this.records.push({ ...record });
  }

  async findByCorrelationId(
    correlationId: string,
  ): Promise<PersistedMakScore | null> {
    return this.records.find((r) => r.correlationId === correlationId) ?? null;
  }

  async listHistory(filter: MakScoreHistoryFilter): Promise<PersistedMakScore[]> {
    const all = filter.userId
      ? this.records.filter((r) => r.context?.userId === filter.userId)
      : this.records;
    return all
      .slice()
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(filter.offset, filter.offset + filter.limit);
  }

  async applyReview(input: ReviewActionInput): Promise<ReviewApplied | null> {
    const rec = this.records.find((r) => r.correlationId === input.correlationId);
    if (!rec) return null;
    const fromStatus = rec.reviewStatus;
    const now = Date.now();
    // Atualiza estado atual (single-process => atomico).
    rec.reviewStatus = input.toStatus;
    rec.reviewerId = input.reviewerId;
    rec.reviewNote = input.note ?? null;
    rec.reviewedAt = new Date(now).toISOString();
    // Append na trilha.
    this.reviewEvents.push({
      correlationId: input.correlationId,
      fromStatus,
      toStatus: input.toStatus,
      reviewerId: input.reviewerId,
      note: input.note ?? null,
      createdAtMs: now,
    });
    return { record: { ...rec }, fromStatus };
  }

  async listReviewEvents(correlationId: string): Promise<MakScoreReviewEvent[]> {
    return this.reviewEvents
      .filter((e) => e.correlationId === correlationId)
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .map((e) => ({ ...e }));
  }
}

import { createHash } from "crypto";
import { onlyDigits } from "./cnpj";
import type {
  MakfilOutcome,
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
  // Filtros opcionais.
  outcome?: MakfilOutcome;
  fromMs?: number; // createdAtMs >= fromMs
  toMs?: number;   // createdAtMs <= toMs
  q?: string;      // substring no cnpj mascarado
  limit: number;
  offset: number;
}

export interface MakScoreRepository {
  findValidByCnpj(cnpj: string, now?: number): Promise<PersistedMakScore | null>;
  save(record: PersistedMakScore): Promise<void>;
  findByCorrelationId(correlationId: string): Promise<PersistedMakScore | null>;
  listHistory(filter: MakScoreHistoryFilter): Promise<PersistedMakScore[]>;
  /** Total de registros que casam o filtro (ignora limit/offset). */
  countHistory(filter: MakScoreHistoryFilter): Promise<number>;
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

  private filtered(filter: MakScoreHistoryFilter): PersistedMakScore[] {
    let arr = this.records.slice();
    if (filter.userId) arr = arr.filter((r) => r.context?.userId === filter.userId);
    if (filter.outcome) arr = arr.filter((r) => r.outcome === filter.outcome);
    if (filter.fromMs != null) arr = arr.filter((r) => r.createdAtMs >= filter.fromMs!);
    if (filter.toMs != null) arr = arr.filter((r) => r.createdAtMs <= filter.toMs!);
    if (filter.q) {
      const q = filter.q.toLowerCase();
      arr = arr.filter((r) => r.cnpj.toLowerCase().includes(q));
    }
    return arr.sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  async listHistory(filter: MakScoreHistoryFilter): Promise<PersistedMakScore[]> {
    return this.filtered(filter).slice(filter.offset, filter.offset + filter.limit);
  }

  async countHistory(filter: MakScoreHistoryFilter): Promise<number> {
    return this.filtered(filter).length;
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

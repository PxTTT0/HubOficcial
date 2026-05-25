import { createHash } from "crypto";
import { onlyDigits } from "./cnpj";
import type { PersistedMakScore } from "./types";

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
}

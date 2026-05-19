import { createHash } from "crypto";
import { onlyDigits } from "./cnpj";
import type { PersistedMakScore } from "./types";

// Repositorio em memoria. Persiste apenas resumo e metadados,
// nunca o payload bruto da E-POSI.
// Substituir por implementacao real (DB) sem alterar a interface.

export interface MakScoreRepository {
  findValidByCnpj(cnpj: string, now?: number): PersistedMakScore | null;
  save(record: PersistedMakScore): void;
  recentByUser(userId: string | undefined, limit?: number): PersistedMakScore[];
}

export function hashCnpj(cnpj: string): string {
  // Hash determinista para indexacao sem armazenar CNPJ aberto em chave externa.
  // Usar pepper de ambiente quando existir.
  const pepper = process.env.MAKSCORE_CNPJ_PEPPER ?? "";
  return createHash("sha256").update(pepper + onlyDigits(cnpj)).digest("hex");
}

export class InMemoryMakScoreRepository implements MakScoreRepository {
  private records = new Map<string, PersistedMakScore>();

  findValidByCnpj(cnpj: string, now = Date.now()): PersistedMakScore | null {
    const key = hashCnpj(cnpj);
    const r = this.records.get(key);
    if (!r) return null;
    if (r.expiresAtMs <= now) return null;
    return r;
  }

  save(record: PersistedMakScore): void {
    this.records.set(record.cnpjHash, record);
  }

  recentByUser(userId: string | undefined, limit = 20): PersistedMakScore[] {
    const all = Array.from(this.records.values());
    const filtered = userId
      ? all.filter((r) => r.context?.userId === userId)
      : all;
    return filtered
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, limit);
  }
}

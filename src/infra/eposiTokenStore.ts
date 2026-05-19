import type { RedisLike } from "./redisClient";

export interface EposiTokenEntry {
  token: string;
  credentialId: "primary" | "secondary";
  expiresAtMs: number;
}

/**
 * Cache compartilhado do token E-POSI entre replicas.
 *
 * FAIL-OPEN: qualquer erro de backend e tratado como cache miss. O
 * cliente reautentica direto na E-POSI. Indisponibilidade do cache
 * NUNCA derruba a consulta - so perde a otimizacao.
 */
export interface EposiTokenStore {
  get(): Promise<EposiTokenEntry | null>;
  set(entry: EposiTokenEntry): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryEposiTokenStore implements EposiTokenStore {
  private entry: EposiTokenEntry | null = null;
  async get(): Promise<EposiTokenEntry | null> {
    return this.entry;
  }
  async set(entry: EposiTokenEntry): Promise<void> {
    this.entry = entry;
  }
  async clear(): Promise<void> {
    this.entry = null;
  }
}

export class RedisEposiTokenStore implements EposiTokenStore {
  private static KEY = "eposi:token";
  constructor(private readonly redis: RedisLike) {}

  async get(): Promise<EposiTokenEntry | null> {
    try {
      const raw = await this.redis.get(RedisEposiTokenStore.KEY);
      return raw ? (JSON.parse(raw) as EposiTokenEntry) : null;
    } catch {
      return null; // FAIL-OPEN: miss => reautentica
    }
  }

  async set(entry: EposiTokenEntry): Promise<void> {
    try {
      const ttl = Math.max(entry.expiresAtMs - Date.now(), 1000);
      await this.redis.set(RedisEposiTokenStore.KEY, JSON.stringify(entry), ttl);
    } catch {
      // FAIL-OPEN: nao conseguir cachear nao e erro fatal.
    }
  }

  async clear(): Promise<void> {
    try {
      await this.redis.del(RedisEposiTokenStore.KEY);
    } catch {
      // FAIL-OPEN
    }
  }
}

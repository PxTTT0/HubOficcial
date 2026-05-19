import type { RedisLike } from "./redisClient";

export interface ChallengeRecord {
  userId: string;
  expiresAtMs: number;
}

/**
 * Store do challenge MFA (estado efemero entre senha e TOTP).
 *
 * FAIL-CLOSED: erro de backend em get/consume => null. Sem challenge
 * valido o login MFA falha fechado (nega), nunca libera.
 */
export interface MfaChallengeStore {
  put(cid: string, record: ChallengeRecord, ttlMs: number): Promise<void>;
  get(cid: string): Promise<ChallengeRecord | null>;
  /** GET + DEL atomico (anti double-spend entre instancias). */
  consume(cid: string): Promise<ChallengeRecord | null>;
}

export class InMemoryMfaChallengeStore implements MfaChallengeStore {
  private map = new Map<string, ChallengeRecord>();

  private prune(): void {
    const now = Date.now();
    for (const [cid, r] of this.map) if (r.expiresAtMs <= now) this.map.delete(cid);
  }
  async put(cid: string, record: ChallengeRecord): Promise<void> {
    this.prune();
    this.map.set(cid, { ...record });
  }
  async get(cid: string): Promise<ChallengeRecord | null> {
    this.prune();
    const r = this.map.get(cid);
    return r ? { ...r } : null;
  }
  async consume(cid: string): Promise<ChallengeRecord | null> {
    this.prune();
    const r = this.map.get(cid);
    if (!r) return null;
    this.map.delete(cid);
    return { ...r };
  }
}

export class RedisMfaChallengeStore implements MfaChallengeStore {
  constructor(private readonly redis: RedisLike) {}

  private key(cid: string) {
    return `mfa:chal:${cid}`;
  }

  async put(cid: string, record: ChallengeRecord, ttlMs: number): Promise<void> {
    await this.redis.set(this.key(cid), JSON.stringify(record), Math.max(ttlMs, 1000));
  }

  async get(cid: string): Promise<ChallengeRecord | null> {
    try {
      const raw = await this.redis.get(this.key(cid));
      return raw ? (JSON.parse(raw) as ChallengeRecord) : null;
    } catch {
      return null; // FAIL-CLOSED
    }
  }

  async consume(cid: string): Promise<ChallengeRecord | null> {
    try {
      const raw = await this.redis.getdel(this.key(cid));
      return raw ? (JSON.parse(raw) as ChallengeRecord) : null;
    } catch {
      return null; // FAIL-CLOSED
    }
  }
}

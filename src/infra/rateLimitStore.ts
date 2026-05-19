import type { RedisLike } from "./redisClient";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  resetAtMs: number;
}

/** Backend de contagem com janela fixa. */
export interface RateLimitBackend {
  /** Consome 1. Atomico. */
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  /** So leitura, nao consome. */
  peek(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

interface Bucket {
  start: number;
  count: number;
}

function result(count: number, limit: number, resetAtMs: number, now: number): RateLimitResult {
  return {
    ok: count <= limit,
    remaining: Math.max(limit - count, 0),
    retryAfterSec: Math.max(Math.ceil((resetAtMs - now) / 1000), 1),
    resetAtMs,
  };
}

export class InMemoryRateLimitBackend implements RateLimitBackend {
  private buckets = new Map<string, Bucket>();

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || now - existing.start >= windowMs) {
      this.buckets.set(key, { start: now, count: 1 });
      return result(1, limit, now + windowMs, now);
    }
    existing.count += 1;
    return result(existing.count, limit, existing.start + windowMs, now);
  }

  async peek(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || now - existing.start >= windowMs) {
      return { ok: true, remaining: limit, retryAfterSec: Math.ceil(windowMs / 1000), resetAtMs: now + windowMs };
    }
    return result(existing.count, limit, existing.start + windowMs, now);
  }
}

export class RedisRateLimitBackend implements RateLimitBackend {
  constructor(private readonly redis: RedisLike) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const { count, ttlMs } = await this.redis.incrWithWindow(`rl:${key}`, windowMs);
    const resetAtMs = now + (ttlMs > 0 ? ttlMs : windowMs);
    return result(count, limit, resetAtMs, now);
  }

  async peek(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const raw = await this.redis.get(`rl:${key}`);
    if (raw === null) {
      return { ok: true, remaining: limit, retryAfterSec: Math.ceil(windowMs / 1000), resetAtMs: now + windowMs };
    }
    const count = Number(raw) || 0;
    const ttlMs = await this.redis.pttl(`rl:${key}`);
    const resetAtMs = now + (ttlMs > 0 ? ttlMs : windowMs);
    return result(count, limit, resetAtMs, now);
  }
}

export type RateLimitFailMode = "closed" | "open";

/**
 * Facade de um limiter logico. Encapsula a politica de Redis-down:
 *  - "closed": erro de backend => bloqueia (ok=false). Usado em
 *    auth/login/MFA (seguranca acima de disponibilidade).
 *  - "open": erro de backend => libera (ok=true) e dispara
 *    `onFailOpen` (auditoria warning persistente). Usado no MakScore.
 */
export class RateLimiter {
  constructor(
    private readonly backend: RateLimitBackend,
    private readonly name: string,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly failMode: RateLimitFailMode,
    private readonly onFailOpen?: (name: string, err: unknown) => void,
  ) {}

  private fallback(): RateLimitResult {
    const now = Date.now();
    if (this.failMode === "closed") {
      return {
        ok: false,
        remaining: 0,
        retryAfterSec: Math.ceil(this.windowMs / 1000),
        resetAtMs: now + this.windowMs,
      };
    }
    return {
      ok: true,
      remaining: this.limit,
      retryAfterSec: Math.ceil(this.windowMs / 1000),
      resetAtMs: now + this.windowMs,
    };
  }

  async check(key: string): Promise<RateLimitResult> {
    try {
      return await this.backend.hit(`${this.name}:${key}`, this.limit, this.windowMs);
    } catch (err) {
      if (this.failMode === "open" && this.onFailOpen) this.onFailOpen(this.name, err);
      return this.fallback();
    }
  }

  async peek(key: string): Promise<RateLimitResult> {
    try {
      return await this.backend.peek(`${this.name}:${key}`, this.limit, this.windowMs);
    } catch (err) {
      if (this.failMode === "open" && this.onFailOpen) this.onFailOpen(this.name, err);
      return this.fallback();
    }
  }
}

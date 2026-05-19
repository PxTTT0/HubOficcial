interface Bucket {
  start: number;
  count: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  resetAtMs: number;
}

export class FixedWindowRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  peek(key: string, now = Date.now()): RateLimitResult {
    const existing = this.buckets.get(key);
    if (!existing || now - existing.start >= this.windowMs) {
      return {
        ok: true,
        remaining: this.limit,
        retryAfterSec: Math.ceil(this.windowMs / 1000),
        resetAtMs: now + this.windowMs,
      };
    }

    const resetAtMs = existing.start + this.windowMs;
    return {
      ok: existing.count < this.limit,
      remaining: Math.max(this.limit - existing.count, 0),
      retryAfterSec: Math.max(Math.ceil((resetAtMs - now) / 1000), 1),
      resetAtMs,
    };
  }

  check(key: string, now = Date.now()): RateLimitResult {
    const existing = this.buckets.get(key);
    if (!existing || now - existing.start >= this.windowMs) {
      const resetAtMs = now + this.windowMs;
      this.buckets.set(key, { start: now, count: 1 });
      return {
        ok: true,
        remaining: Math.max(this.limit - 1, 0),
        retryAfterSec: Math.ceil(this.windowMs / 1000),
        resetAtMs,
      };
    }

    const resetAtMs = existing.start + this.windowMs;
    if (existing.count >= this.limit) {
      return {
        ok: false,
        remaining: 0,
        retryAfterSec: Math.max(Math.ceil((resetAtMs - now) / 1000), 1),
        resetAtMs,
      };
    }

    existing.count += 1;
    return {
      ok: true,
      remaining: Math.max(this.limit - existing.count, 0),
      retryAfterSec: Math.max(Math.ceil((resetAtMs - now) / 1000), 1),
      resetAtMs,
    };
  }
}

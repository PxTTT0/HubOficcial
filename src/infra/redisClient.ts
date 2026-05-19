/**
 * Seam minima sobre Redis. Definimos so as operacoes que os stores
 * usam. Producao usa ioredis (carregado lazy via require - nao acopla o
 * tsc nem os testes). Testes injetam um fake que implementa esta mesma
 * interface (sem Redis real no CI).
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, pxMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** GET + DEL atomico. Retorna o valor anterior (ou null). */
  getdel(key: string): Promise<string | null>;
  /** INCR + (PEXPIRE no primeiro hit). Retorna { count, ttlMs }. */
  incrWithWindow(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
  pttl(key: string): Promise<number>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  ping(): Promise<void>;
}

export type BackingMode = "redis" | "memory";

export interface RedisConfig {
  url: string | null;
  keyPrefix: string;
  tls: boolean;
  /** opt-out de emergencia: permite memoria mesmo em producao. */
  allowInMemoryState: boolean;
}

function boolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export function loadRedisConfig(): RedisConfig {
  const url = process.env.REDIS_URL?.trim();
  return {
    url: url && url.length > 0 ? url : null,
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? "hubvendas:",
    tls: boolEnv(process.env.REDIS_TLS, false),
    allowInMemoryState: boolEnv(process.env.ALLOW_IN_MEMORY_STATE, false),
  };
}

export function resolveBackingMode(cfg: RedisConfig): BackingMode {
  return cfg.url ? "redis" : "memory";
}

/**
 * Cliente real baseado em ioredis. Carregado via require dinamico para
 * NAO obrigar ioredis em tempo de tsc/teste. So e chamado quando
 * REDIS_URL esta presente (producao/homolog com Redis).
 */
export function createRealRedis(cfg: RedisConfig): RedisLike {
  if (!cfg.url) throw new Error("createRealRedis chamado sem REDIS_URL");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IORedis = require("ioredis");
  const client = new IORedis(cfg.url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    ...(cfg.tls ? { tls: {} } : {}),
  });
  const k = (key: string) => `${cfg.keyPrefix}${key}`;

  return {
    async get(key) {
      return client.get(k(key));
    },
    async set(key, value, pxMs) {
      if (pxMs && pxMs > 0) await client.set(k(key), value, "PX", pxMs);
      else await client.set(k(key), value);
    },
    async del(key) {
      await client.del(k(key));
    },
    async getdel(key) {
      // GETDEL e atomico (Redis >= 6.2). Fallback para script se faltar.
      if (typeof client.getdel === "function") {
        return client.getdel(k(key));
      }
      const lua =
        "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v";
      return client.eval(lua, 1, k(key));
    },
    async incrWithWindow(key, windowMs) {
      // Atomico: INCR e, se for o primeiro hit, define PEXPIRE.
      const lua =
        "local c = redis.call('INCR', KEYS[1]); " +
        "if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; " +
        "local t = redis.call('PTTL', KEYS[1]); return {c, t}";
      const [count, ttlMs] = (await client.eval(lua, 1, k(key), String(windowMs))) as [
        number,
        number,
      ];
      return { count, ttlMs };
    },
    async pttl(key) {
      return client.pttl(k(key));
    },
    async sadd(key, member) {
      await client.sadd(k(key), member);
    },
    async srem(key, member) {
      await client.srem(k(key), member);
    },
    async smembers(key) {
      return client.smembers(k(key));
    },
    async ping() {
      await client.ping();
    },
  };
}

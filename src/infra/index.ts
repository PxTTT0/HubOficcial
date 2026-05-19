import {
  createRealRedis,
  loadRedisConfig,
  resolveBackingMode,
  type BackingMode,
  type RedisConfig,
  type RedisLike,
} from "./redisClient";
import {
  InMemorySessionStore,
  RedisSessionStore,
  type SessionStore,
} from "./sessionStore";
import {
  InMemoryRateLimitBackend,
  RateLimiter,
  RedisRateLimitBackend,
  type RateLimitBackend,
  type RateLimitFailMode,
} from "./rateLimitStore";
import {
  InMemoryMfaChallengeStore,
  RedisMfaChallengeStore,
  type MfaChallengeStore,
} from "./mfaChallengeStore";
import {
  InMemoryEposiTokenStore,
  RedisEposiTokenStore,
  type EposiTokenStore,
} from "./eposiTokenStore";

export * from "./redisClient";
export * from "./sessionStore";
export * from "./rateLimitStore";
export * from "./mfaChallengeStore";
export * from "./eposiTokenStore";

export interface InfraStores {
  mode: BackingMode;
  redisConfig: RedisConfig;
  sessionStore: SessionStore;
  mfaChallengeStore: MfaChallengeStore;
  eposiTokenStore: EposiTokenStore;
  rateLimitBackend: RateLimitBackend;
  /** Cria um limiter logico nomeado com politica de Redis-down. */
  makeRateLimiter: (
    name: string,
    limit: number,
    windowMs: number,
    failMode: RateLimitFailMode,
    onFailOpen?: (name: string, err: unknown) => void,
  ) => RateLimiter;
}

/**
 * Resolve os stores conforme REDIS_URL:
 *  - presente  => stores Redis (estado compartilhado entre replicas)
 *  - ausente   => stores em memoria (dev/test, sem mudanca de comportamento)
 *
 * Permite injetar um RedisLike (fake nos testes). Quando `redis` e
 * fornecido, usa modo Redis independentemente de REDIS_URL.
 */
export function createInfraStores(redis?: RedisLike): InfraStores {
  const redisConfig = loadRedisConfig();
  const mode: BackingMode = redis ? "redis" : resolveBackingMode(redisConfig);

  const client: RedisLike | null =
    redis ?? (mode === "redis" ? createRealRedis(redisConfig) : null);

  const sessionStore: SessionStore = client
    ? new RedisSessionStore(client)
    : new InMemorySessionStore();
  const mfaChallengeStore: MfaChallengeStore = client
    ? new RedisMfaChallengeStore(client)
    : new InMemoryMfaChallengeStore();
  const eposiTokenStore: EposiTokenStore = client
    ? new RedisEposiTokenStore(client)
    : new InMemoryEposiTokenStore();
  const rateLimitBackend: RateLimitBackend = client
    ? new RedisRateLimitBackend(client)
    : new InMemoryRateLimitBackend();

  return {
    mode,
    redisConfig,
    sessionStore,
    mfaChallengeStore,
    eposiTokenStore,
    rateLimitBackend,
    makeRateLimiter: (name, limit, windowMs, failMode, onFailOpen) =>
      new RateLimiter(rateLimitBackend, name, limit, windowMs, failMode, onFailOpen),
  };
}

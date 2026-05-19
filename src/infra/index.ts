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
import {
  createPgExecutor,
  loadDbConfig,
  resolveDbBackingMode,
  type DbBackingMode,
  type DbConfig,
  type SqlExecutor,
} from "./db/pool";
import { requireEncryptionKey } from "./db/crypto";
import { PgUserRepository } from "./db/userRepository";
import { PgMakScoreAuditSink } from "./db/makscoreAuditSink";
import {
  InMemoryUserRepository,
  type UserRepository,
} from "../security/users";
import {
  InMemoryAuditSink,
  type AuditSink,
} from "../modules/makscore/audit";

export * from "./redisClient";
export * from "./sessionStore";
export * from "./rateLimitStore";
export * from "./mfaChallengeStore";
export * from "./eposiTokenStore";
export * from "./db/pool";

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
  // ── Persistencia duravel (Postgres) ──────────────────────────────────
  dbMode: DbBackingMode;
  dbConfig: DbConfig;
  /** Executor SQL quando em modo pg; null em modo memoria. */
  sqlExecutor: SqlExecutor | null;
  userRepository: UserRepository;
  makscoreAuditSink: AuditSink;
}

/**
 * Resolve os stores conforme REDIS_URL:
 *  - presente  => stores Redis (estado compartilhado entre replicas)
 *  - ausente   => stores em memoria (dev/test, sem mudanca de comportamento)
 *
 * Permite injetar um RedisLike (fake nos testes). Quando `redis` e
 * fornecido, usa modo Redis independentemente de REDIS_URL.
 */
export function createInfraStores(
  redis?: RedisLike,
  db?: SqlExecutor,
): InfraStores {
  const redisConfig = loadRedisConfig();
  const mode: BackingMode = redis ? "redis" : resolveBackingMode(redisConfig);

  const client: RedisLike | null =
    redis ?? (mode === "redis" ? createRealRedis(redisConfig) : null);

  // ── Postgres (estado duravel) ──────────────────────────────────────────
  const dbConfig = loadDbConfig();
  const dbMode: DbBackingMode = db ? "pg" : resolveDbBackingMode(dbConfig);
  const sqlExecutor: SqlExecutor | null =
    db ?? (dbMode === "pg" ? createPgExecutor(dbConfig) : null);

  let userRepository: UserRepository;
  let makscoreAuditSink: AuditSink;
  if (sqlExecutor) {
    // Em prod o bootstrap ja validou a chave antes de chegar aqui.
    // Em dev com DATABASE_URL, chave ausente => erro claro (sem valor).
    const encKey = requireEncryptionKey(
      process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY,
    );
    userRepository = new PgUserRepository(sqlExecutor, encKey);
    makscoreAuditSink = new PgMakScoreAuditSink(sqlExecutor);
  } else {
    userRepository = new InMemoryUserRepository();
    makscoreAuditSink = new InMemoryAuditSink();
  }

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
    dbMode,
    dbConfig,
    sqlExecutor,
    userRepository,
    makscoreAuditSink,
  };
}

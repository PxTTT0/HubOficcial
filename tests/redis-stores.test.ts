import { test } from "node:test";
import assert from "node:assert/strict";
import type { RedisLike } from "../src/infra/redisClient";
import { loadRedisConfig, resolveBackingMode } from "../src/infra/redisClient";
import { createInfraStores } from "../src/infra";
import {
  InMemorySessionStore,
  RedisSessionStore,
  type SessionRecord,
} from "../src/infra/sessionStore";
import {
  RedisRateLimitBackend,
  RateLimiter,
} from "../src/infra/rateLimitStore";
import { RedisMfaChallengeStore } from "../src/infra/mfaChallengeStore";
import {
  InMemoryEposiTokenStore,
  RedisEposiTokenStore,
} from "../src/infra/eposiTokenStore";
import {
  ProductionSecurityError,
  validateProductionEnvironment,
  type ProductionEnvironment,
} from "../src/security/bootstrap";
import type { SecurityConfig } from "../src/security/config";

// ───────────────── Fake Redis (in-process, compartilhavel) ─────────────────
// Implementa RRedisLike com semantica suficiente: TTL, GETDEL atomico,
// INCR+PEXPIRE atomico, sets. "Multiplas instancias" = varios stores
// apontando para o MESMO FakeRedis. "Restart" = novo store, mesmo backend.
class FakeRedis implements RedisLike {
  private kv = new Map<string, { v: string; exp: number | null }>();
  private sets = new Map<string, Set<string>>();
  private counters = new Map<string, { c: number; exp: number }>();

  private alive(k: string): boolean {
    const e = this.kv.get(k);
    if (!e) return false;
    if (e.exp !== null && e.exp <= Date.now()) {
      this.kv.delete(k);
      return false;
    }
    return true;
  }
  async get(key: string) {
    return this.alive(key) ? this.kv.get(key)!.v : null;
  }
  async set(key: string, value: string, pxMs?: number) {
    this.kv.set(key, { v: value, exp: pxMs ? Date.now() + pxMs : null });
  }
  async del(key: string) {
    this.kv.delete(key);
  }
  async getdel(key: string) {
    const v = this.alive(key) ? this.kv.get(key)!.v : null;
    this.kv.delete(key);
    return v;
  }
  async incrWithWindow(key: string, windowMs: number) {
    const now = Date.now();
    const cur = this.counters.get(key);
    if (!cur || cur.exp <= now) {
      this.counters.set(key, { c: 1, exp: now + windowMs });
      return { count: 1, ttlMs: windowMs };
    }
    cur.c += 1;
    return { count: cur.c, ttlMs: cur.exp - now };
  }
  async pttl(key: string) {
    const c = this.counters.get(key);
    return c ? Math.max(c.exp - Date.now(), 0) : -1;
  }
  async sadd(key: string, m: string) {
    (this.sets.get(key) ?? this.sets.set(key, new Set()).get(key)!).add(m);
  }
  async srem(key: string, m: string) {
    this.sets.get(key)?.delete(m);
  }
  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
  async ping() {}
}

class ThrowingRedis implements RedisLike {
  private err() {
    return Promise.reject(new Error("redis down"));
  }
  get = () => this.err() as Promise<string | null>;
  set = () => this.err() as Promise<void>;
  del = () => this.err() as Promise<void>;
  getdel = () => this.err() as Promise<string | null>;
  incrWithWindow = () => this.err() as Promise<{ count: number; ttlMs: number }>;
  pttl = () => this.err() as Promise<number>;
  sadd = () => this.err() as Promise<void>;
  srem = () => this.err() as Promise<void>;
  smembers = () => this.err() as Promise<string[]>;
  ping = () => this.err() as Promise<void>;
}

function session(sid: string, userId = "u1"): SessionRecord {
  const now = Date.now();
  return {
    sid,
    userId,
    username: "user",
    role: "vendedor",
    createdAtMs: now,
    expiresAtMs: now + 3_600_000,
    lastSeenAtMs: now,
    ip: "1.2.3.4",
    enrollmentPending: false,
  };
}

// ───────────────── Backing mode / factory ─────────────────

test("backing mode: sem REDIS_URL => memory; factory usa stores em memoria", () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    assert.equal(resolveBackingMode(loadRedisConfig()), "memory");
    const infra = createInfraStores();
    assert.equal(infra.mode, "memory");
    assert.ok(infra.sessionStore instanceof InMemorySessionStore);
  } finally {
    if (prev !== undefined) process.env.REDIS_URL = prev;
  }
});

test("factory com RedisLike injetado => modo redis", () => {
  const infra = createInfraStores(new FakeRedis());
  assert.equal(infra.mode, "redis");
  assert.ok(infra.sessionStore instanceof RedisSessionStore);
});

// ───────────────── Sessões: restart + multi-instância ─────────────────

test("SessionStore: sobrevive a restart (novo store, mesmo backend)", async () => {
  const redis = new FakeRedis();
  const a = new RedisSessionStore(redis);
  await a.create(session("s1"));
  // "restart": instancia nova, MESMO Redis
  const b = new RedisSessionStore(redis);
  const got = await b.get("s1");
  assert.equal(got?.sid, "s1");
});

test("SessionStore: revogação em uma instância vale na outra", async () => {
  const redis = new FakeRedis();
  const a = new RedisSessionStore(redis);
  const b = new RedisSessionStore(redis);
  await a.create(session("s2"));
  await b.delete("s2");
  assert.equal(await a.get("s2"), null);
});

test("SessionStore: deleteByUser revoga todas as sessões do usuário", async () => {
  const redis = new FakeRedis();
  const store = new RedisSessionStore(redis);
  await store.create(session("sA", "userX"));
  await store.create(session("sB", "userX"));
  await store.deleteByUser("userX");
  assert.equal(await store.get("sA"), null);
  assert.equal(await store.get("sB"), null);
});

test("SessionStore FAIL-CLOSED: backend down => get null (nunca abre sessão)", async () => {
  const store = new RedisSessionStore(new ThrowingRedis());
  assert.equal(await store.get("whatever"), null);
});

// ───────────────── Rate limit: compartilhado + fail policy ─────────────────

test("RateLimit: contagem compartilhada entre instâncias (mesmo backend)", async () => {
  const redis = new FakeRedis();
  const backend = new RedisRateLimitBackend(redis);
  const limA = new RateLimiter(backend, "login", 3, 60_000, "closed");
  const limB = new RateLimiter(backend, "login", 3, 60_000, "closed");
  assert.equal((await limA.check("ip")).ok, true); // 1
  assert.equal((await limB.check("ip")).ok, true); // 2 (outra instância)
  assert.equal((await limA.check("ip")).ok, true); // 3
  assert.equal((await limB.check("ip")).ok, false); // 4 > limite
});

test("RateLimit FAIL-CLOSED (auth/login/MFA): backend down => bloqueia", async () => {
  const lim = new RateLimiter(new RedisRateLimitBackend(new ThrowingRedis()), "login", 5, 60_000, "closed");
  const r = await lim.check("ip");
  assert.equal(r.ok, false);
});

test("RateLimit FAIL-OPEN (MakScore): backend down => libera + dispara onFailOpen", async () => {
  let warned = "";
  const lim = new RateLimiter(
    new RedisRateLimitBackend(new ThrowingRedis()),
    "makscore",
    5,
    60_000,
    "open",
    (name) => (warned = name),
  );
  const r = await lim.check("user:ip");
  assert.equal(r.ok, true);
  assert.equal(warned, "makscore");
});

// ───────────────── MFA challenge: consume atômico ─────────────────

test("MfaChallengeStore: consume é atômico (anti double-spend)", async () => {
  const redis = new FakeRedis();
  const store = new RedisMfaChallengeStore(redis);
  await store.put("cid1", { userId: "u9", expiresAtMs: Date.now() + 60_000 }, 60_000);
  const [a, b] = await Promise.all([store.consume("cid1"), store.consume("cid1")]);
  const hits = [a, b].filter((x) => x !== null);
  assert.equal(hits.length, 1, "exatamente um consume vence");
  assert.equal(await store.consume("cid1"), null);
});

test("MfaChallengeStore: sobrevive a restart antes de consumir", async () => {
  const redis = new FakeRedis();
  await new RedisMfaChallengeStore(redis).put(
    "cid2",
    { userId: "u", expiresAtMs: Date.now() + 60_000 },
    60_000,
  );
  const after = new RedisMfaChallengeStore(redis);
  assert.equal((await after.get("cid2"))?.userId, "u");
});

test("MfaChallengeStore FAIL-CLOSED: backend down => null", async () => {
  const store = new RedisMfaChallengeStore(new ThrowingRedis());
  assert.equal(await store.get("x"), null);
  assert.equal(await store.consume("x"), null);
});

// ───────────────── Token E-POSI: compartilhado + fail-open ─────────────────

test("EposiTokenStore: token compartilhado entre réplicas", async () => {
  const redis = new FakeRedis();
  const a = new RedisEposiTokenStore(redis);
  const b = new RedisEposiTokenStore(redis);
  await a.set({ token: "T", credentialId: "primary", expiresAtMs: Date.now() + 60_000 });
  assert.equal((await b.get())?.token, "T");
});

test("EposiTokenStore FAIL-OPEN: backend down => get null, set não lança", async () => {
  const store = new RedisEposiTokenStore(new ThrowingRedis());
  assert.equal(await store.get(), null);
  await store.set({ token: "T", credentialId: "primary", expiresAtMs: Date.now() + 1000 });
  await store.clear(); // não deve lançar
});

test("InMemoryEposiTokenStore: ciclo get/set/clear", async () => {
  const s = new InMemoryEposiTokenStore();
  assert.equal(await s.get(), null);
  await s.set({ token: "X", credentialId: "secondary", expiresAtMs: 1 });
  assert.equal((await s.get())?.credentialId, "secondary");
  await s.clear();
  assert.equal(await s.get(), null);
});

// ───────────────── Produção: fail-fast REDIS_URL ─────────────────

const VALID_SECURITY: SecurityConfig = {
  sessionSecret: "a-very-long-production-session-secret-0123456789",
  sessionCookieName: "hub_sid",
  sessionTtlMs: 43_200_000,
  sessionIdleMs: 1_800_000,
  sessionBindIpRoles: ["admin", "analista"],
  csrfCookieName: "hub_csrf",
  secureCookies: true,
  trustedOrigins: ["https://hub.makfil.com.br"],
  trustProxy: true,
  userRateLimitPerMin: 60,
  ipRateLimitPerMin: 120,
  authRateLimitPerMin: 10,
  authFailureLimitPer15Min: 25,
  allowDevHeaderAuth: false,
  envName: "production",
  mfaRequiredRoles: ["admin", "analista"],
  mfaIssuer: "HubVendasMakfil",
  mfaChallengeTtlMs: 300_000,
  mfaRecoveryCodes: 10,
  mfaRateLimitPerMin: 5,
  mfaFailureLimitPer15Min: 10,
};

function prodEnv(redis: ProductionEnvironment["redis"], envName = "production"): ProductionEnvironment {
  return {
    envName,
    security: { ...VALID_SECURITY, envName },
    audit: { filePath: "/var/log/x.jsonl", memoryRetain: 1000, configured: true },
    makscore: {
      cnpjPepper: "pepper-de-producao-suficientemente-longo",
      eposiMode: "mock",
      eposiLogin: "",
      eposiPassword: "",
      eposiLoginSecondary: "",
      eposiPasswordSecondary: "",
    },
    redis,
  };
}

test("produção sem REDIS_URL e sem opt-out => startup falha", () => {
  assert.throws(
    () => validateProductionEnvironment(prodEnv({ url: null, allowInMemoryState: false })),
    (err: unknown) => {
      assert.ok(err instanceof ProductionSecurityError);
      assert.match(err.message, /REDIS_URL nao definido em producao/);
      return true;
    },
  );
});

test("produção com REDIS_URL => sem issue de redis", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(prodEnv({ url: "redis://r:6379", allowInMemoryState: false })),
  );
});

test("produção sem REDIS_URL mas ALLOW_IN_MEMORY_STATE=true => permitido (opt-out)", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(prodEnv({ url: null, allowInMemoryState: true })),
  );
});

test("não-produção sem REDIS_URL => não falha (memória é ok em dev)", () => {
  assert.doesNotThrow(() =>
    validateProductionEnvironment(prodEnv({ url: null, allowInMemoryState: false }, "development")),
  );
});

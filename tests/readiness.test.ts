import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createInfraStores } from "../src/infra";
import type { RedisLike } from "../src/infra/redisClient";
import type { SqlExecutor } from "../src/infra/db/pool";

function redisStub(pingImpl: () => Promise<void>): RedisLike {
  const noop = async () => undefined as any;
  return {
    get: noop, set: noop, del: noop, getdel: noop,
    incrWithWindow: async () => ({ count: 1, ttlMs: 1000 }),
    pttl: async () => -1, sadd: noop, srem: noop, smembers: async () => [],
    ping: pingImpl,
  };
}
function execStub(queryImpl: () => Promise<any>): SqlExecutor {
  return { query: queryImpl };
}

const KEY_B64 = Buffer.alloc(32, 5).toString("base64");

// ───────────── Unit: checkReadiness ─────────────

test("readiness: modo memoria => ready, deps disabled", async () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const infra = createInfraStores();
    const r = await infra.checkReadiness();
    assert.equal(r.ready, true);
    assert.deepEqual(r.checks, { redis: "disabled", db: "disabled" });
  } finally {
    if (prev !== undefined) process.env.REDIS_URL = prev;
  }
});

test("readiness: redis e db OK => ready, ok/ok", async () => {
  const prev = process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY;
  process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY = KEY_B64;
  try {
    const infra = createInfraStores(
      redisStub(async () => undefined),
      execStub(async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 })),
    );
    const r = await infra.checkReadiness();
    assert.deepEqual(r.checks, { redis: "ok", db: "ok" });
    assert.equal(r.ready, true);
  } finally {
    process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY = prev;
  }
});

test("readiness: redis down => not ready", async () => {
  const infra = createInfraStores(redisStub(async () => { throw new Error("redis down"); }));
  const r = await infra.checkReadiness();
  assert.equal(r.checks.redis, "down");
  assert.equal(r.checks.db, "disabled");
  assert.equal(r.ready, false);
});

test("readiness: db down => not ready", async () => {
  const prev = process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY;
  process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY = KEY_B64;
  try {
    const infra = createInfraStores(
      redisStub(async () => undefined),
      execStub(async () => { throw new Error("db down"); }),
    );
    const r = await infra.checkReadiness();
    assert.equal(r.checks.db, "down");
    assert.equal(r.ready, false);
  } finally {
    process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY = prev;
  }
});

test("readiness: timeout em dep que pendura => down", async () => {
  const infra = createInfraStores(redisStub(() => new Promise(() => {})));
  const r = await infra.checkReadiness(50);
  assert.equal(r.checks.redis, "down");
  assert.equal(r.ready, false);
});

// ───────────── HTTP: /readyz e /healthz ─────────────

const ENV_KEYS = ["NODE_ENV", "DATABASE_URL", "REDIS_URL", "AUDIT_LOG_PATH", "MAKSCORE_EPOSI_MODE", "AUTH_SESSION_SECRET", "AUTH_SECURE_COOKIES", "AUTH_MFA_REQUIRED_ROLES", "AUTH_SESSION_BIND_IP_ROLES"];
function snapshot() { return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); }
function restore(s: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]!; }
}

test("HTTP: /healthz (liveness) e /readyz (readiness) publicos", { concurrency: false }, async () => {
  const snap = snapshot();
  Object.assign(process.env, {
    NODE_ENV: "test", DATABASE_URL: "", REDIS_URL: "", AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock", AUTH_SESSION_SECRET: "readiness-secret",
    AUTH_SECURE_COOKIES: "false", AUTH_MFA_REQUIRED_ROLES: "", AUTH_SESSION_BIND_IP_ROLES: "",
  });
  const { buildApp } = await import("../src/server");
  const { app } = buildApp();
  const server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("porta indisponivel");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const live = await fetch(`${base}/healthz`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { ok: true });

    const ready = await fetch(`${base}/readyz`);
    assert.equal(ready.status, 200); // memoria => deps disabled => ready
    const body = (await ready.json()) as any;
    assert.equal(body.ok, true);
    assert.deepEqual(body.checks, { redis: "disabled", db: "disabled" });
  } finally {
    restore(snap);
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});

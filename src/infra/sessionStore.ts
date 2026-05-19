import type { Role } from "../modules/makscore/auth";
import type { RedisLike } from "./redisClient";

export interface SessionRecord {
  sid: string;
  userId: string;
  username: string;
  role: Role;
  createdAtMs: number;
  expiresAtMs: number;
  lastSeenAtMs: number;
  ip: string;
  enrollmentPending: boolean;
}

/**
 * Store de sessoes. Fonte de verdade de existencia/revogacao.
 *
 * Politica Redis-down: FAIL-CLOSED. Se o backend falhar, `get` retorna
 * null (sessao tratada como inexistente => 401). Nunca "abre" sessao por
 * indisponibilidade de infra.
 */
export interface SessionStore {
  create(session: SessionRecord): Promise<void>;
  get(sid: string): Promise<SessionRecord | null>;
  /** Atualiza lastSeenAtMs (idle deslizante). Best-effort. */
  touch(sid: string, lastSeenAtMs: number): Promise<void>;
  delete(sid: string): Promise<void>;
  /** Revoga todas as sessoes de um usuario (ex.: desativar usuario). */
  deleteByUser(userId: string): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private byId = new Map<string, SessionRecord>();

  async create(session: SessionRecord): Promise<void> {
    this.byId.set(session.sid, { ...session });
  }
  async get(sid: string): Promise<SessionRecord | null> {
    const s = this.byId.get(sid);
    return s ? { ...s } : null;
  }
  async touch(sid: string, lastSeenAtMs: number): Promise<void> {
    const s = this.byId.get(sid);
    if (s) s.lastSeenAtMs = lastSeenAtMs;
  }
  async delete(sid: string): Promise<void> {
    this.byId.delete(sid);
  }
  async deleteByUser(userId: string): Promise<void> {
    for (const [sid, s] of this.byId) {
      if (s.userId === userId) this.byId.delete(sid);
    }
  }
}

/**
 * Backed por Redis. Chave `sess:{sid}` (JSON, TTL ate expiresAtMs) +
 * indice `sess:user:{userId}` (set de sids) para revogacao em massa.
 *
 * FAIL-CLOSED: qualquer erro de backend em `get` => null (401).
 */
export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: RedisLike) {}

  private key(sid: string) {
    return `sess:${sid}`;
  }
  private userKey(userId: string) {
    return `sess:user:${userId}`;
  }

  async create(session: SessionRecord): Promise<void> {
    const ttl = Math.max(session.expiresAtMs - Date.now(), 1000);
    await this.redis.set(this.key(session.sid), JSON.stringify(session), ttl);
    await this.redis.sadd(this.userKey(session.userId), session.sid);
  }

  async get(sid: string): Promise<SessionRecord | null> {
    try {
      const raw = await this.redis.get(this.key(sid));
      if (!raw) return null;
      return JSON.parse(raw) as SessionRecord;
    } catch {
      // FAIL-CLOSED: indisponibilidade nunca vira sessao valida.
      return null;
    }
  }

  async touch(sid: string, lastSeenAtMs: number): Promise<void> {
    try {
      const raw = await this.redis.get(this.key(sid));
      if (!raw) return;
      const s = JSON.parse(raw) as SessionRecord;
      s.lastSeenAtMs = lastSeenAtMs;
      const ttl = Math.max(s.expiresAtMs - Date.now(), 1000);
      await this.redis.set(this.key(sid), JSON.stringify(s), ttl);
    } catch {
      // best-effort: perder um touch nao compromete seguranca.
    }
  }

  async delete(sid: string): Promise<void> {
    try {
      const raw = await this.redis.get(this.key(sid));
      await this.redis.del(this.key(sid));
      if (raw) {
        const s = JSON.parse(raw) as SessionRecord;
        await this.redis.srem(this.userKey(s.userId), sid);
      }
    } catch {
      // best-effort
    }
  }

  async deleteByUser(userId: string): Promise<void> {
    try {
      const sids = await this.redis.smembers(this.userKey(userId));
      for (const sid of sids) await this.redis.del(this.key(sid));
      await this.redis.del(this.userKey(userId));
    } catch {
      // best-effort
    }
  }
}

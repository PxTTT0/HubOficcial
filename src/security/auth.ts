import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedUser, Role } from "../modules/makscore/auth";
import {
  JsonlSecurityAuditSink,
  buildAuditContext,
  loadSecurityAuditConfig,
  type SecurityAuditEvent,
  type SecurityAuditSink,
} from "./audit";
import { loadSecurityConfig, type SecurityConfig } from "./config";
import {
  clearCsrfCookieAttributes,
  computeCsrfToken,
  csrfCookieAttributes,
} from "./csrf";
import { getClientIp } from "./http";
import { MfaService } from "./mfa";
import { loadPasswordHashingConfig, verifyPassword, type PasswordHashingConfig } from "./password";
import { validatePasswordPolicy } from "./passwordPolicy";
import {
  InMemoryUserRepository,
  type StoredUser,
  type UserRepository,
} from "./users";
import { createInfraStores, type InfraStores } from "../infra";
import type { RateLimiter } from "../infra/rateLimitStore";
import type { SessionRecord } from "../infra/sessionStore";

export interface SecurityContext {
  cfg: SecurityConfig;
  passwordCfg: PasswordHashingConfig;
  users: UserRepository;
  mfa: MfaService;
  audit: SecurityAuditSink;
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireRole: (...allowed: Role[]) => (req: Request, res: Response, next: NextFunction) => void;
  canSeeTechnicalDetails: (role: Role | undefined) => boolean;
  authRouter: Router;
  userLimiter: RateLimiter;
  ipLimiter: RateLimiter;
}

function parseCookie(headerValue: string | undefined, name: string): string | null {
  if (!headerValue) return null;
  const cookies = headerValue.split(";");
  for (const item of cookies) {
    const [rawName, ...rest] = item.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function encodeTokenPart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeTokenPart(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signToken(cfg: SecurityConfig, sid: string, exp: number): string {
  return createHmac("sha256", cfg.sessionSecret).update(`${sid}.${exp}`).digest("base64url");
}

function cookieAttributes(cfg: SecurityConfig, expiresAtMs: number): string {
  const parts = [
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(Math.floor((expiresAtMs - Date.now()) / 1000), 0)}`,
  ];
  if (cfg.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

function clearCookieAttributes(cfg: SecurityConfig): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (cfg.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sanitizeUser(user: StoredUser): AuthenticatedUser {
  return { id: user.id, role: user.role };
}

export function createSecurityContext(
  cfg: SecurityConfig = loadSecurityConfig(),
  users: UserRepository = new InMemoryUserRepository(),
  passwordCfg: PasswordHashingConfig = loadPasswordHashingConfig(),
  audit: SecurityAuditSink = new JsonlSecurityAuditSink(loadSecurityAuditConfig()),
  infra: InfraStores = createInfraStores(),
): SecurityContext {
  const sessionStore = infra.sessionStore;
  const mfa = new MfaService(cfg, users, infra.mfaChallengeStore);

  function recordEvent(event: Omit<SecurityAuditEvent, "ts">): void {
    audit.write({ ts: new Date().toISOString(), ...event });
  }
  // Limiters de auth/login/MFA: FAIL-CLOSED (Redis down => bloqueia).
  const userLimiter = infra.makeRateLimiter("user", cfg.userRateLimitPerMin, 60_000, "closed");
  const ipLimiter = infra.makeRateLimiter("ip", cfg.ipRateLimitPerMin, 60_000, "closed");
  const loginLimiter = infra.makeRateLimiter("login", cfg.authRateLimitPerMin, 60_000, "closed");
  const loginFailureLimiter = infra.makeRateLimiter("login-failure", cfg.authFailureLimitPer15Min, 15 * 60_000, "closed");
  const mfaIpLimiter = infra.makeRateLimiter("mfa-ip", cfg.mfaRateLimitPerMin, 60_000, "closed");
  const mfaFailureLimiter = infra.makeRateLimiter("mfa-failure", cfg.mfaFailureLimitPer15Min, 15 * 60_000, "closed");

  async function issueSession(
    user: StoredUser,
    ip: string,
    options: { enrollmentPending?: boolean } = {},
  ): Promise<SessionRecord> {
    const now = Date.now();
    const session: SessionRecord = {
      sid: randomBytes(24).toString("base64url"),
      userId: user.id,
      username: user.username,
      role: user.role,
      createdAtMs: now,
      expiresAtMs: now + cfg.sessionTtlMs,
      lastSeenAtMs: now,
      ip,
      enrollmentPending: Boolean(options.enrollmentPending),
    };
    await sessionStore.create(session);
    return session;
  }

  function encodeSessionToken(session: SessionRecord): string {
    const exp = String(session.expiresAtMs);
    const sig = signToken(cfg, session.sid, session.expiresAtMs);
    return `${encodeTokenPart(session.sid)}.${encodeTokenPart(exp)}.${sig}`;
  }

  async function resolveSession(req: Request): Promise<SessionRecord | null> {
    const authHeader = req.header("authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;
    const cookie = parseCookie(req.header("cookie"), cfg.sessionCookieName);
    const token = bearer || cookie;
    if (!token) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    let sid: string;
    let expRaw: string;
    try {
      sid = decodeTokenPart(parts[0]);
      expRaw = decodeTokenPart(parts[1]);
    } catch {
      return null;
    }

    const exp = Number(expRaw);
    if (!Number.isFinite(exp)) return null;
    const expectedSig = signToken(cfg, sid, exp);
    if (!safeEqual(expectedSig, parts[2])) return null;
    const now = Date.now();
    if (now >= exp) {
      await sessionStore.delete(sid);
      return null;
    }

    const session = await sessionStore.get(sid);
    if (!session || session.expiresAtMs !== exp) return null;
    if (session.expiresAtMs <= now) {
      await sessionStore.delete(sid);
      return null;
    }
    if (cfg.sessionIdleMs > 0 && now - session.lastSeenAtMs > cfg.sessionIdleMs) {
      await sessionStore.delete(sid);
      recordEvent({
        scope: "auth.session",
        type: "session.idle_expired",
        severity: "info",
        outcome: "failure",
        ...buildAuditContext(req, {
          userId: session.userId,
          username: session.username,
          role: session.role,
        }),
        details: {
          inactiveMs: now - session.lastSeenAtMs,
          idleLimitMs: cfg.sessionIdleMs,
        },
      });
      return null;
    }
    if (cfg.sessionBindIpRoles.includes(session.role)) {
      const currentIp = getClientIp(req);
      if (session.ip !== currentIp) {
        await sessionStore.delete(sid);
        recordEvent({
          scope: "auth.session",
          type: "session.ip_mismatch",
          severity: "high",
          outcome: "failure",
          ...buildAuditContext(req, {
            userId: session.userId,
            username: session.username,
            role: session.role,
          }),
          details: { sessionIp: session.ip, currentIp },
        });
        return null;
      }
    }
    session.lastSeenAtMs = now;
    await sessionStore.touch(sid, now);
    return session;
  }

  function attachRateLimitHeaders(
    res: Response,
    prefix: string,
    remaining: number,
    resetAtMs: number,
  ): void {
    res.setHeader(`${prefix}-Remaining`, String(Math.max(remaining, 0)));
    res.setHeader(`${prefix}-Reset`, String(Math.ceil(resetAtMs / 1000)));
  }

  function rejectRateLimited(res: Response, retryAfterSec: number): void {
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: "rate_limited" });
  }

  function maybeResolveDevHeaderUser(req: Request): AuthenticatedUser | null {
    if (!cfg.allowDevHeaderAuth) return null;
    const id = req.header("x-user-id");
    const role = req.header("x-user-role");
    if (!id) return null;
    const normalizedRole: Role =
      role === "admin" || role === "analista" || role === "vendedor" ? role : "vendedor";
    return { id, role: normalizedRole };
  }

  async function applyAuth(
    req: Request,
    res: Response,
    next: NextFunction,
    options: { allowEnrollmentPending?: boolean } = {},
  ): Promise<void> {
    const ip = getClientIp(req);
    const ipWindow = await ipLimiter.check(`req:${ip}`);
    attachRateLimitHeaders(res, "X-RateLimit-IP", ipWindow.remaining, ipWindow.resetAtMs);
    if (!ipWindow.ok) {
      rejectRateLimited(res, ipWindow.retryAfterSec);
      return;
    }

    const session = await resolveSession(req);
    if (session) {
      const userWindow = await userLimiter.check(`user:${session.userId}`);
      attachRateLimitHeaders(res, "X-RateLimit-User", userWindow.remaining, userWindow.resetAtMs);
      if (!userWindow.ok) {
        rejectRateLimited(res, userWindow.retryAfterSec);
        return;
      }
      if (session.enrollmentPending && !options.allowEnrollmentPending) {
        res.status(403).json({ error: "mfa_enrollment_required" });
        return;
      }
      req.user = { id: session.userId, role: session.role };
      next();
      return;
    }

    const devUser = maybeResolveDevHeaderUser(req);
    if (devUser) {
      const userWindow = await userLimiter.check(`user:${devUser.id}`);
      attachRateLimitHeaders(res, "X-RateLimit-User", userWindow.remaining, userWindow.resetAtMs);
      if (!userWindow.ok) {
        rejectRateLimited(res, userWindow.retryAfterSec);
        return;
      }
      req.user = devUser;
      next();
      return;
    }

    res.status(401).json({ error: "unauthenticated" });
  }

  // Middleware async: erros inesperados de infra viram 500 (nunca
  // "passa" autenticacao por excecao).
  function wrapAuth(options: { allowEnrollmentPending?: boolean } = {}) {
    return (req: Request, res: Response, next: NextFunction): void => {
      applyAuth(req, res, next, options).catch(() => {
        if (!res.headersSent) res.status(500).json({ error: "internal_error" });
      });
    };
  }

  const requireAuth = wrapAuth();
  const requireAuthAllowingEnrollment = wrapAuth({ allowEnrollmentPending: true });

  function requireRole(...allowed: Role[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      if (!allowed.includes(req.user.role)) {
        recordEvent({
          scope: "auth",
          type: "rbac.denied",
          severity: "warn",
          outcome: "failure",
          reason: "role_not_allowed",
          ...buildAuditContext(req, { userId: req.user.id, role: req.user.role }),
          details: { allowedRoles: allowed, actualRole: req.user.role },
        });
        res.status(403).json({ error: "forbidden" });
        return;
      }
      next();
    };
  }

  function canSeeTechnicalDetails(role: Role | undefined): boolean {
    return role === "analista" || role === "admin";
  }

  function setSessionCookies(res: Response, session: SessionRecord, token: string, csrfToken: string): void {
    res.setHeader("Set-Cookie", [
      `${cfg.sessionCookieName}=${encodeURIComponent(token)}; ${cookieAttributes(cfg, session.expiresAtMs)}`,
      `${cfg.csrfCookieName}=${encodeURIComponent(csrfToken)}; ${csrfCookieAttributes(cfg, session.expiresAtMs)}`,
    ]);
  }

  function buildSessionPayload(session: SessionRecord, user: StoredUser, options: { enrollmentPending?: boolean } = {}) {
    const token = encodeSessionToken(session);
    const csrfToken = computeCsrfToken(cfg, session.sid);
    return {
      token,
      csrfToken,
      user: sanitizeUser(user),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      ...(options.enrollmentPending ? { mfaEnrollmentPending: true } : {}),
    };
  }

  function findSessionByRequest(req: Request): Promise<SessionRecord | null> {
    return resolveSession(req);
  }

  const authRouter = Router();

  authRouter.post("/login", async (req, res) => {
    const ip = getClientIp(req);
    const requestWindow = await loginLimiter.check(`login:${ip}`);
    attachRateLimitHeaders(res, "X-RateLimit-Login", requestWindow.remaining, requestWindow.resetAtMs);
    if (!requestWindow.ok) {
      recordEvent({
        scope: "auth",
        type: "login.failure",
        severity: "warn",
        outcome: "failure",
        reason: "rate_limited",
        ...buildAuditContext(req),
      });
      rejectRateLimited(res, requestWindow.retryAfterSec);
      return;
    }

    const failureKey = `login-failure:${ip}`;
    const throttleWindow = await loginFailureLimiter.peek(failureKey);
    if (!throttleWindow.ok) {
      recordEvent({
        scope: "auth",
        type: "login.failure",
        severity: "high",
        outcome: "failure",
        reason: "ip_locked_out",
        ...buildAuditContext(req),
      });
      rejectRateLimited(res, throttleWindow.retryAfterSec);
      return;
    }

    const username = typeof req.body?.username === "string"
      ? req.body.username.trim().toLowerCase()
      : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!username || !validatePasswordPolicy(password).ok) {
      res.status(400).json({ error: "invalid_credentials" });
      return;
    }

    const user = users.findByUsername(username);
    if (!user || user.disabled) {
      await loginFailureLimiter.check(failureKey);
      recordEvent({
        scope: "auth",
        type: "login.failure",
        severity: "warn",
        outcome: "failure",
        reason: user ? "user_disabled" : "unknown_user",
        ...buildAuditContext(req),
        details: { username },
      });
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      await loginFailureLimiter.check(failureKey);
      recordEvent({
        scope: "auth",
        type: "login.failure",
        severity: "warn",
        outcome: "failure",
        reason: "bad_password",
        ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
      });
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    if (user.mfa.enabled) {
      const challenge = await mfa.issueChallenge(user.id);
      recordEvent({
        scope: "auth.mfa",
        type: "login.mfa.challenge_issued",
        severity: "info",
        ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
      });
      res.status(200).json({
        mfaRequired: true,
        challengeToken: challenge.token,
        expiresAt: new Date(challenge.expiresAtMs).toISOString(),
      });
      return;
    }

    const enrollmentPending = mfa.isRequiredForRole(user.role) && !user.mfa.enabled;
    const session = await issueSession(user, ip, { enrollmentPending });
    const payload = buildSessionPayload(session, user, { enrollmentPending });
    setSessionCookies(res, session, payload.token, payload.csrfToken);
    recordEvent({
      scope: "auth",
      type: "login.success",
      severity: "info",
      outcome: "success",
      ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
      details: { enrollmentPending },
    });
    res.status(200).json(payload);
  });

  authRouter.post("/login/mfa", async (req, res) => {
    const ip = getClientIp(req);
    const ipWindow = await mfaIpLimiter.check(`mfa:${ip}`);
    attachRateLimitHeaders(res, "X-RateLimit-MFA", ipWindow.remaining, ipWindow.resetAtMs);
    if (!ipWindow.ok) {
      recordEvent({
        scope: "auth.mfa",
        type: "login.mfa.failure",
        severity: "warn",
        outcome: "failure",
        reason: "rate_limited",
        ...buildAuditContext(req),
      });
      rejectRateLimited(res, ipWindow.retryAfterSec);
      return;
    }

    const challengeToken =
      typeof req.body?.challengeToken === "string" ? req.body.challengeToken : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const useRecovery = req.body?.recovery === true;

    if (!challengeToken || !code) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }

    const resolved = await mfa.resolveChallenge(challengeToken);
    if (!resolved) {
      recordEvent({
        scope: "auth.mfa",
        type: "login.mfa.failure",
        severity: "warn",
        outcome: "failure",
        reason: "invalid_challenge",
        ...buildAuditContext(req),
      });
      res.status(401).json({ error: "invalid_challenge" });
      return;
    }

    const failureKey = `mfa-failure:${resolved.userId}`;
    const failureWindow = await mfaFailureLimiter.peek(failureKey);
    if (!failureWindow.ok) {
      recordEvent({
        scope: "auth.mfa",
        type: "login.mfa.failure",
        severity: "high",
        outcome: "failure",
        reason: "user_locked_out",
        ...buildAuditContext(req, { userId: resolved.userId }),
      });
      rejectRateLimited(res, failureWindow.retryAfterSec);
      return;
    }

    const ok = useRecovery
      ? mfa.verifyRecoveryCode(resolved.userId, code)
      : mfa.verifyTotp(resolved.userId, code);
    if (!ok) {
      await mfaFailureLimiter.check(failureKey);
      recordEvent({
        scope: "auth.mfa",
        type: "login.mfa.failure",
        severity: "warn",
        outcome: "failure",
        reason: useRecovery ? "invalid_recovery_code" : "invalid_totp",
        ...buildAuditContext(req, { userId: resolved.userId }),
      });
      res.status(401).json({ error: "invalid_code" });
      return;
    }

    const consumed = await mfa.consumeChallenge(challengeToken);
    if (!consumed) {
      res.status(401).json({ error: "invalid_challenge" });
      return;
    }

    const user = users.findById(consumed.userId);
    if (!user || user.disabled) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const session = await issueSession(user, ip);
    const payload = buildSessionPayload(session, user);
    setSessionCookies(res, session, payload.token, payload.csrfToken);
    recordEvent({
      scope: "auth.mfa",
      type: "login.mfa.success",
      severity: "info",
      outcome: "success",
      ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
      details: { recovery: useRecovery },
    });
    res.status(200).json(payload);
  });

  authRouter.post("/logout", requireAuthAllowingEnrollment, async (req, res) => {
    const token = parseCookie(req.header("cookie"), cfg.sessionCookieName)
      || (req.header("authorization")?.startsWith("Bearer ")
        ? req.header("authorization")!.slice("Bearer ".length).trim()
        : null);
    if (token) {
      const parts = token.split(".");
      if (parts.length >= 1) {
        try {
          const sid = decodeTokenPart(parts[0]);
          await sessionStore.delete(sid);
        } catch {
          // noop
        }
      }
    }
    res.setHeader("Set-Cookie", [
      `${cfg.sessionCookieName}=; ${clearCookieAttributes(cfg)}`,
      `${cfg.csrfCookieName}=; ${clearCsrfCookieAttributes(cfg)}`,
    ]);
    recordEvent({
      scope: "auth",
      type: "logout",
      severity: "info",
      outcome: "success",
      ...buildAuditContext(req, req.user ? { userId: req.user.id, role: req.user.role } : undefined),
    });
    res.status(204).end();
  });

  authRouter.get("/me", requireAuthAllowingEnrollment, async (req, res) => {
    const user = req.user ? users.findById(req.user.id) : null;
    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    const session = await findSessionByRequest(req);
    res.json({
      user: sanitizeUser(user),
      csrfToken: session ? computeCsrfToken(cfg, session.sid) : null,
      mfa: {
        enabled: user.mfa.enabled,
        required: mfa.isRequiredForRole(user.role),
        enrollmentPending: Boolean(session?.enrollmentPending),
      },
    });
  });

  authRouter.post("/mfa/enroll", requireAuthAllowingEnrollment, (req, res) => {
    const userId = req.user?.id;
    const user = userId ? users.findById(userId) : null;
    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    try {
      const result = mfa.beginEnrollment(user.id, user.username);
      recordEvent({
        scope: "auth.mfa",
        type: "mfa.enroll.started",
        severity: "info",
        outcome: "success",
        ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
      });
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "mfa_error";
      const status = message === "mfa_already_enabled" ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  authRouter.post("/mfa/verify-enrollment", requireAuthAllowingEnrollment, async (req, res) => {
    const userId = req.user?.id;
    const user = userId ? users.findById(userId) : null;
    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!code) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    try {
      const result = mfa.confirmEnrollment(user.id, code);
      // Rotaciona o sid: invalida a sessao "enrollmentPending" e emite uma nova
      // sessao plena, evitando que o token original (visto durante o estado
      // pre-MFA) continue valido apos a elevacao de privilegio.
      const previous = await findSessionByRequest(req);
      if (previous) await sessionStore.delete(previous.sid);
      const ip = getClientIp(req);
      const session = await issueSession(user, ip);
      const payload = buildSessionPayload(session, user);
      setSessionCookies(res, session, payload.token, payload.csrfToken);
      recordEvent({
        scope: "auth.mfa",
        type: "mfa.enroll.completed",
        severity: "info",
        outcome: "success",
        ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
        details: { rotatedSid: true, recoveryCodeCount: result.recoveryCodes.length },
      });
      res.status(200).json({ ...result, ...payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : "mfa_error";
      const status =
        message === "invalid_code"
          ? 401
          : message === "mfa_already_enabled"
            ? 409
            : 400;
      recordEvent({
        scope: "auth.mfa",
        type: "mfa.enroll.failure",
        severity: "warn",
        outcome: "failure",
        reason: message,
        ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
      });
      res.status(status).json({ error: message });
    }
  });

  authRouter.post("/mfa/disable", requireAuth, async (req, res) => {
    const userId = req.user?.id;
    const user = userId ? users.findById(userId) : null;
    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!validatePasswordPolicy(password).ok || !code) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (!passwordOk) {
      recordEvent({
        scope: "auth.mfa",
        type: "mfa.disable.failure",
        severity: "warn",
        outcome: "failure",
        reason: "bad_password",
        ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
      });
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    if (!user.mfa.enabled || !mfa.verifyTotp(user.id, code)) {
      recordEvent({
        scope: "auth.mfa",
        type: "mfa.disable.failure",
        severity: "warn",
        outcome: "failure",
        reason: "invalid_totp",
        ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
      });
      res.status(401).json({ error: "invalid_code" });
      return;
    }
    mfa.disable(user.id);
    recordEvent({
      scope: "auth.mfa",
      type: "mfa.disabled",
      severity: "high",
      outcome: "success",
      ...buildAuditContext(req, { userId: user.id, username: user.username, role: user.role }),
    });
    res.status(204).end();
  });

  authRouter.get("/audit/recent", requireAuth, requireRole("admin"), (req, res) => {
    const limitRaw = req.query.limit;
    const parsedLimit =
      typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : 100;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 500)
      : 100;
    res.json({ events: audit.recent(limit) });
  });

  return {
    cfg,
    passwordCfg,
    users,
    mfa,
    audit,
    requireAuth,
    requireRole,
    canSeeTechnicalDetails,
    authRouter,
    userLimiter,
    ipLimiter,
  };
}

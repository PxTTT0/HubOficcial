import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedUser, Role } from "../modules/makscore/auth";
import { loadSecurityConfig, type SecurityConfig } from "./config";
import { getClientIp } from "./http";
import { MfaService } from "./mfa";
import { loadPasswordHashingConfig, verifyPassword, type PasswordHashingConfig } from "./password";
import { FixedWindowRateLimiter } from "./rateLimit";
import {
  InMemoryUserRepository,
  type StoredUser,
  type UserRepository,
} from "./users";

interface SessionRecord {
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

export interface SecurityContext {
  cfg: SecurityConfig;
  passwordCfg: PasswordHashingConfig;
  users: UserRepository;
  mfa: MfaService;
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireRole: (...allowed: Role[]) => (req: Request, res: Response, next: NextFunction) => void;
  canSeeTechnicalDetails: (role: Role | undefined) => boolean;
  authRouter: Router;
  userLimiter: FixedWindowRateLimiter;
  ipLimiter: FixedWindowRateLimiter;
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
): SecurityContext {
  const sessions = new Map<string, SessionRecord>();
  const mfa = new MfaService(cfg, users);
  const userLimiter = new FixedWindowRateLimiter(cfg.userRateLimitPerMin, 60_000);
  const ipLimiter = new FixedWindowRateLimiter(cfg.ipRateLimitPerMin, 60_000);
  const loginLimiter = new FixedWindowRateLimiter(cfg.authRateLimitPerMin, 60_000);
  const loginFailureLimiter = new FixedWindowRateLimiter(cfg.authFailureLimitPer15Min, 15 * 60_000);
  const mfaIpLimiter = new FixedWindowRateLimiter(cfg.mfaRateLimitPerMin, 60_000);
  const mfaFailureLimiter = new FixedWindowRateLimiter(cfg.mfaFailureLimitPer15Min, 15 * 60_000);

  function issueSession(
    user: StoredUser,
    ip: string,
    options: { enrollmentPending?: boolean } = {},
  ): SessionRecord {
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
    sessions.set(session.sid, session);
    return session;
  }

  function encodeSessionToken(session: SessionRecord): string {
    const exp = String(session.expiresAtMs);
    const sig = signToken(cfg, session.sid, session.expiresAtMs);
    return `${encodeTokenPart(session.sid)}.${encodeTokenPart(exp)}.${sig}`;
  }

  function resolveSession(req: Request): SessionRecord | null {
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
    if (Date.now() >= exp) {
      sessions.delete(sid);
      return null;
    }

    const session = sessions.get(sid);
    if (!session || session.expiresAtMs !== exp) return null;
    if (session.expiresAtMs <= Date.now()) {
      sessions.delete(sid);
      return null;
    }
    session.lastSeenAtMs = Date.now();
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

  function applyAuth(
    req: Request,
    res: Response,
    next: NextFunction,
    options: { allowEnrollmentPending?: boolean } = {},
  ): void {
    const ip = getClientIp(req);
    const ipWindow = ipLimiter.check(`req:${ip}`);
    attachRateLimitHeaders(res, "X-RateLimit-IP", ipWindow.remaining, ipWindow.resetAtMs);
    if (!ipWindow.ok) {
      rejectRateLimited(res, ipWindow.retryAfterSec);
      return;
    }

    const session = resolveSession(req);
    if (session) {
      const userWindow = userLimiter.check(`user:${session.userId}`);
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
      const userWindow = userLimiter.check(`user:${devUser.id}`);
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

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    applyAuth(req, res, next);
  }

  function requireAuthAllowingEnrollment(req: Request, res: Response, next: NextFunction): void {
    applyAuth(req, res, next, { allowEnrollmentPending: true });
  }

  function requireRole(...allowed: Role[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      if (!allowed.includes(req.user.role)) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      next();
    };
  }

  function canSeeTechnicalDetails(role: Role | undefined): boolean {
    return role === "analista" || role === "admin";
  }

  function setSessionCookie(res: Response, session: SessionRecord, token: string): void {
    res.setHeader(
      "Set-Cookie",
      `${cfg.sessionCookieName}=${encodeURIComponent(token)}; ${cookieAttributes(cfg, session.expiresAtMs)}`,
    );
  }

  function findSessionByRequest(req: Request): SessionRecord | null {
    return resolveSession(req);
  }

  const authRouter = Router();

  authRouter.post("/login", async (req, res) => {
    const ip = getClientIp(req);
    const requestWindow = loginLimiter.check(`login:${ip}`);
    attachRateLimitHeaders(res, "X-RateLimit-Login", requestWindow.remaining, requestWindow.resetAtMs);
    if (!requestWindow.ok) {
      rejectRateLimited(res, requestWindow.retryAfterSec);
      return;
    }

    const failureKey = `login-failure:${ip}`;
    const throttleWindow = loginFailureLimiter.peek(failureKey);
    if (!throttleWindow.ok) {
      rejectRateLimited(res, throttleWindow.retryAfterSec);
      return;
    }

    const username = typeof req.body?.username === "string"
      ? req.body.username.trim().toLowerCase()
      : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!username || password.length < 8) {
      res.status(400).json({ error: "invalid_credentials" });
      return;
    }

    const user = users.findByUsername(username);
    if (!user || user.disabled) {
      loginFailureLimiter.check(failureKey);
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      loginFailureLimiter.check(failureKey);
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    if (user.mfa.enabled) {
      const challenge = mfa.issueChallenge(user.id);
      res.status(200).json({
        mfaRequired: true,
        challengeToken: challenge.token,
        expiresAt: new Date(challenge.expiresAtMs).toISOString(),
      });
      return;
    }

    const enrollmentPending = mfa.isRequiredForRole(user.role) && !user.mfa.enabled;
    const session = issueSession(user, ip, { enrollmentPending });
    const token = encodeSessionToken(session);
    setSessionCookie(res, session, token);
    res.status(200).json({
      token,
      user: sanitizeUser(user),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      ...(enrollmentPending ? { mfaEnrollmentPending: true } : {}),
    });
  });

  authRouter.post("/login/mfa", (req, res) => {
    const ip = getClientIp(req);
    const ipWindow = mfaIpLimiter.check(`mfa:${ip}`);
    attachRateLimitHeaders(res, "X-RateLimit-MFA", ipWindow.remaining, ipWindow.resetAtMs);
    if (!ipWindow.ok) {
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

    const resolved = mfa.resolveChallenge(challengeToken);
    if (!resolved) {
      res.status(401).json({ error: "invalid_challenge" });
      return;
    }

    const failureKey = `mfa-failure:${resolved.userId}`;
    const failureWindow = mfaFailureLimiter.peek(failureKey);
    if (!failureWindow.ok) {
      rejectRateLimited(res, failureWindow.retryAfterSec);
      return;
    }

    const ok = useRecovery
      ? mfa.verifyRecoveryCode(resolved.userId, code)
      : mfa.verifyTotp(resolved.userId, code);
    if (!ok) {
      mfaFailureLimiter.check(failureKey);
      res.status(401).json({ error: "invalid_code" });
      return;
    }

    const consumed = mfa.consumeChallenge(challengeToken);
    if (!consumed) {
      res.status(401).json({ error: "invalid_challenge" });
      return;
    }

    const user = users.findById(consumed.userId);
    if (!user || user.disabled) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const session = issueSession(user, ip);
    const token = encodeSessionToken(session);
    setSessionCookie(res, session, token);
    res.status(200).json({
      token,
      user: sanitizeUser(user),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
    });
  });

  authRouter.post("/logout", requireAuthAllowingEnrollment, (req, res) => {
    const token = parseCookie(req.header("cookie"), cfg.sessionCookieName)
      || (req.header("authorization")?.startsWith("Bearer ")
        ? req.header("authorization")!.slice("Bearer ".length).trim()
        : null);
    if (token) {
      const parts = token.split(".");
      if (parts.length >= 1) {
        try {
          const sid = decodeTokenPart(parts[0]);
          sessions.delete(sid);
        } catch {
          // noop
        }
      }
    }
    res.setHeader("Set-Cookie", `${cfg.sessionCookieName}=; ${clearCookieAttributes(cfg)}`);
    res.status(204).end();
  });

  authRouter.get("/me", requireAuthAllowingEnrollment, (req, res) => {
    const user = req.user ? users.findById(req.user.id) : null;
    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    const session = findSessionByRequest(req);
    res.json({
      user: sanitizeUser(user),
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
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "mfa_error";
      const status = message === "mfa_already_enabled" ? 409 : 400;
      res.status(status).json({ error: message });
    }
  });

  authRouter.post("/mfa/verify-enrollment", requireAuthAllowingEnrollment, (req, res) => {
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
      const session = findSessionByRequest(req);
      if (session) {
        session.enrollmentPending = false;
      }
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "mfa_error";
      const status =
        message === "invalid_code"
          ? 401
          : message === "mfa_already_enabled"
            ? 409
            : 400;
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
    if (password.length < 8 || !code) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (!passwordOk) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    if (!user.mfa.enabled || !mfa.verifyTotp(user.id, code)) {
      res.status(401).json({ error: "invalid_code" });
      return;
    }
    mfa.disable(user.id);
    res.status(204).end();
  });

  return {
    cfg,
    passwordCfg,
    users,
    mfa,
    requireAuth,
    requireRole,
    canSeeTechnicalDetails,
    authRouter,
    userLimiter,
    ipLimiter,
  };
}

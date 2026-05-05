function num(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function list(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

import type { Role } from "../modules/makscore/auth";

const VALID_ROLES: Role[] = ["vendedor", "analista", "admin"];

function roleList(raw: string | undefined, fallback: Role[]): Role[] {
  if (raw === undefined) return fallback;
  return list(raw)
    .map((r) => r.toLowerCase())
    .filter((r): r is Role => (VALID_ROLES as string[]).includes(r));
}

export interface SecurityConfig {
  sessionSecret: string;
  sessionCookieName: string;
  sessionTtlMs: number;
  secureCookies: boolean;
  trustedOrigins: string[];
  trustProxy: boolean;
  userRateLimitPerMin: number;
  ipRateLimitPerMin: number;
  authRateLimitPerMin: number;
  authFailureLimitPer15Min: number;
  allowDevHeaderAuth: boolean;
  envName: string;
  mfaRequiredRoles: Role[];
  mfaIssuer: string;
  mfaChallengeTtlMs: number;
  mfaRecoveryCodes: number;
  mfaRateLimitPerMin: number;
  mfaFailureLimitPer15Min: number;
}

export function loadSecurityConfig(): SecurityConfig {
  const envName = process.env.NODE_ENV ?? "development";
  const defaultRequiredRoles: Role[] =
    envName === "production" ? ["admin", "analista"] : [];
  return {
    sessionSecret: process.env.AUTH_SESSION_SECRET ?? "dev-insecure-session-secret-change-me",
    sessionCookieName: process.env.AUTH_SESSION_COOKIE_NAME ?? "hub_sid",
    sessionTtlMs: num(process.env.AUTH_SESSION_TTL_MS, 12 * 60 * 60 * 1000),
    secureCookies: bool(process.env.AUTH_SECURE_COOKIES, envName === "production"),
    trustedOrigins: list(process.env.AUTH_TRUSTED_ORIGINS),
    trustProxy: bool(process.env.AUTH_TRUST_PROXY, true),
    userRateLimitPerMin: num(process.env.AUTH_USER_RATE_LIMIT_PER_MIN, 60),
    ipRateLimitPerMin: num(process.env.AUTH_IP_RATE_LIMIT_PER_MIN, 120),
    authRateLimitPerMin: num(process.env.AUTH_LOGIN_RATE_LIMIT_PER_MIN, 10),
    authFailureLimitPer15Min: num(process.env.AUTH_LOGIN_FAILURE_LIMIT_PER_15_MIN, 25),
    allowDevHeaderAuth: bool(process.env.AUTH_ALLOW_DEV_HEADER_AUTH, envName !== "production"),
    envName,
    mfaRequiredRoles: roleList(process.env.AUTH_MFA_REQUIRED_ROLES, defaultRequiredRoles),
    mfaIssuer: process.env.AUTH_MFA_ISSUER ?? "HubVendasMakfil",
    mfaChallengeTtlMs: num(process.env.AUTH_MFA_CHALLENGE_TTL_MS, 5 * 60_000),
    mfaRecoveryCodes: num(process.env.AUTH_MFA_RECOVERY_CODES, 10),
    mfaRateLimitPerMin: num(process.env.AUTH_MFA_RATE_LIMIT_PER_MIN, 5),
    mfaFailureLimitPer15Min: num(process.env.AUTH_MFA_FAILURE_LIMIT_PER_15_MIN, 10),
  };
}

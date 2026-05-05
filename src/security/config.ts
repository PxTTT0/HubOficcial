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
}

export function loadSecurityConfig(): SecurityConfig {
  const envName = process.env.NODE_ENV ?? "development";
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
  };
}

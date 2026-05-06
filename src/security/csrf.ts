import { createHmac, timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import type { SecurityConfig } from "./config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function decodeTokenPart(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function computeCsrfToken(cfg: SecurityConfig, sid: string): string {
  return createHmac("sha256", cfg.sessionSecret).update(`csrf:${sid}`).digest("base64url");
}

export function csrfCookieAttributes(cfg: SecurityConfig, expiresAtMs: number): string {
  const parts = [
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${Math.max(Math.floor((expiresAtMs - Date.now()) / 1000), 0)}`,
  ];
  if (cfg.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

export function clearCsrfCookieAttributes(cfg: SecurityConfig): string {
  const parts = ["Path=/", "SameSite=Strict", "Max-Age=0"];
  if (cfg.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

function extractSidFromSessionCookie(cfg: SecurityConfig, headerValue: string | undefined): string | null {
  const token = parseCookie(headerValue, cfg.sessionCookieName);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return decodeTokenPart(parts[0]);
  } catch {
    return null;
  }
}

function originAllowed(origin: string, cfg: SecurityConfig): boolean {
  return cfg.trustedOrigins.includes(origin);
}

/**
 * CSRF middleware.
 *
 * Estrategia "synchronizer token" derivado do sid:
 * - Token CSRF = HMAC(sessionSecret, "csrf:" + sid). Stateless, validavel
 *   sem estado adicional alem da sessao existente.
 * - Aplicado apenas a metodos mutaveis (POST/PUT/DELETE/PATCH).
 * - So exige header X-CSRF-Token quando a requisicao traz o cookie de
 *   sessao (autenticacao "browser-style"). Bearer tokens sao imunes a
 *   CSRF e nao recebem o check.
 * - Tambem rejeita request com Origin/Referer presentes que nao estejam
 *   na allowlist `trustedOrigins` (defesa contra login-CSRF).
 */
export function applyCsrf(cfg: SecurityConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const origin = req.header("origin");
    if (origin && !originAllowed(origin, cfg)) {
      res.status(403).json({ error: "csrf_origin_invalid" });
      return;
    }

    const sid = extractSidFromSessionCookie(cfg, req.header("cookie"));
    if (!sid) {
      // sem cookie de sessao: ou e Bearer, ou e nao autenticado.
      // Em ambos os casos CSRF classico nao se aplica.
      next();
      return;
    }

    const headerToken = req.header("x-csrf-token");
    if (!headerToken) {
      res.status(403).json({ error: "csrf_token_missing" });
      return;
    }

    const expected = computeCsrfToken(cfg, sid);
    if (!safeEqual(expected, headerToken)) {
      res.status(403).json({ error: "csrf_token_invalid" });
      return;
    }

    next();
  };
}

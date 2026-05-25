import type { NextFunction, Request, Response } from "express";
import type { SecurityConfig } from "./config";

function setIfMissing(res: Response, name: string, value: string): void {
  if (!res.getHeader(name)) {
    res.setHeader(name, value);
  }
}

function originAllowed(origin: string, trustedOrigins: string[]): boolean {
  return trustedOrigins.includes(origin);
}

export function applySecurityHeaders(cfg: SecurityConfig) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    setIfMissing(res, "X-Content-Type-Options", "nosniff");
    setIfMissing(res, "X-Frame-Options", "DENY");
    setIfMissing(res, "Referrer-Policy", "no-referrer");
    setIfMissing(res, "Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    setIfMissing(
      res,
      "Content-Security-Policy",
      // Sem 'unsafe-inline': JS e CSS sao servidos como arquivos externos
      // (/makscore/app.js, /makscore/app.css) e o HTML nao tem style="".
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    if (cfg.secureCookies) {
      setIfMissing(res, "Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

export function applyCors(cfg: SecurityConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.header("origin");
    if (origin && originAllowed(origin, cfg.trustedOrigins)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-CSRF-Token, X-Requested-With",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

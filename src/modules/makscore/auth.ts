import type { Request, Response, NextFunction } from "express";
import type { SecurityContext } from "../../security";

export type Role = "vendedor" | "analista" | "admin";

export interface AuthenticatedUser {
  id: string;
  role: Role;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

export function requireAuth(security: SecurityContext) {
  return (req: Request, res: Response, next: NextFunction): void =>
    security.requireAuth(req, res, next);
}

export function requireRole(security: SecurityContext, ...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void =>
    security.requireRole(...allowed)(req, res, next);
}

export function canSeeTechnicalDetails(
  security: SecurityContext,
  role: Role | undefined,
): boolean {
  return security.canSeeTechnicalDetails(role);
}

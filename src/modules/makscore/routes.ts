import { Router } from "express";
import { z } from "zod";
import { canSeeTechnicalDetails, requireAuth, requireRole } from "./auth";
import { onlyDigits } from "./cnpj";
import type { MakScoreConfig } from "./config";
import { MakScoreInputError, type MakScoreService } from "./service";
import type { MakScoreResult } from "./types";
import type { SecurityContext } from "../../security";
import { FixedWindowRateLimiter } from "../../security/rateLimit";

const QuerySchema = z.object({
  cnpj: z.string().min(11).max(20),
  product: z.enum(["TOTAL_PJ", "COMPLETA_PJ"]).optional(),
  proposalId: z.string().max(64).optional(),
  ticketPretendido: z.number().nonnegative().max(1_000_000_000).optional(),
  forceRefresh: z.boolean().optional(),
});

// O MakScore v1 e usado 100% por usuarios internos. A separacao
// abaixo limita campos tecnicos (errorCode/errorMessage e regra
// interna primaryRule) ao perfil analista/admin. Usuario interno
// comum recebe resultado, score, motivos traduzidos e cadastral.
function projectForRole(
  result: MakScoreResult,
  security: SecurityContext,
  role: string | undefined,
): MakScoreResult | Omit<MakScoreResult, "errorCode" | "errorMessage" | "primaryRule"> {
  if (canSeeTechnicalDetails(security, role as any)) return result;
  const { errorCode, errorMessage, primaryRule, ...rest } = result;
  return rest;
}

export function buildMakScoreRouter(
  service: MakScoreService,
  cfg: MakScoreConfig,
  security: SecurityContext,
): Router {
  const router = Router();
  const limiter = new FixedWindowRateLimiter(cfg.rateLimitPerMin, 60_000);

  router.use(requireAuth(security));

  router.post("/query", async (req, res) => {
    const parse = QuerySchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "invalid_input", details: parse.error.flatten() });
      return;
    }
    const userId = req.user!.id;
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const rl = limiter.check(`${userId}:${ip}`);
    res.setHeader("X-RateLimit-MakScore-Remaining", String(rl.remaining));
    res.setHeader("X-RateLimit-MakScore-Reset", String(Math.ceil(rl.resetAtMs / 1000)));
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    try {
      const result = await service.query({
        cnpj: onlyDigits(parse.data.cnpj),
        product: parse.data.product,
        forceRefresh: parse.data.forceRefresh,
        context: {
          userId,
          proposalId: parse.data.proposalId,
          ticketPretendido: parse.data.ticketPretendido,
        },
      });
      res.json(projectForRole(result, security, req.user?.role));
    } catch (err) {
      if (err instanceof MakScoreInputError) {
        res.status(422).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get(
    "/audit/recent",
    requireRole(security, "analista", "admin"),
    (_req, res) => {
      res.json({ events: service.auditSink.recent(50) });
    },
  );

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      mode: cfg.eposiMode,
      defaultProduct: cfg.defaultProduct,
      approveMinScore: cfg.approveMinScore,
      reproveMaxScore: cfg.reproveMaxScore,
      validityHours: cfg.validityHours,
      highTicketAmount: cfg.highTicketAmount,
    });
  });

  return router;
}

import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { canSeeTechnicalDetails, requireAuth, requireRole } from "./auth";
import { onlyDigits } from "./cnpj";
import type { MakScoreConfig } from "./config";
import { MakScoreInputError, type MakScoreService } from "./service";
import type { MakScoreResult, PersistedMakScore } from "./types";
import { MAK_SCORE_QUESTIONNAIRE_VERSION, getQuestionnaireSchema } from "./questionnaire";
import { computeEffectiveDecision } from "./decision/effective";
import type { SecurityContext } from "../../security";
import { buildAuditContext } from "../../security/audit";
import type { InfraStores } from "../../infra";

const QuerySchema = z.object({
  cnpj: z.string().min(11).max(20),
  product: z.enum(["TOTAL_PJ", "COMPLETA_PJ"]).optional(),
  proposalId: z.string().max(64).optional(),
  ticketPretendido: z.number().nonnegative().max(1_000_000_000).optional(),
  durationMonths: z.number().int().positive().max(600).optional(),
  questionnaire: z
    .object({
      version: z.literal(MAK_SCORE_QUESTIONNAIRE_VERSION),
      bloqueios: z.record(z.string(), z.boolean()),
      pilares: z.record(z.string(), z.boolean()),
      agravantes: z.record(z.string(), z.boolean()),
      mitigadores: z.record(z.string(), z.boolean()),
    })
    .optional(),
  forceRefresh: z.boolean().optional(),
  // commercialContext NAO entra no Zod nesta fase (reservado, sem uso).
});

const HistorySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  userId: z.string().max(128).optional(),
  outcome: z.enum(["aprovado", "reprovado", "exige_analise", "indisponivel_temporariamente"]).optional(),
  from: z.string().max(40).optional(), // ISO ou data; convertido p/ ms
  to: z.string().max(40).optional(),
  q: z.string().max(40).optional(),    // busca no CNPJ mascarado
});

function toMs(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

const ResultParamSchema = z.object({
  correlationId: z.string().uuid(),
});

const ReviewActionSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  note: z.string().max(1000).optional(),
});

// O MakScore v1 e usado 100% por usuarios internos. A separacao
// abaixo limita campos tecnicos (errorCode/errorMessage e regra
// interna primaryRule) ao perfil analista/admin. Usuario interno
// comum recebe resultado, score, motivos traduzidos e cadastral.
function projectForRole(
  result: MakScoreResult,
  security: SecurityContext,
  role: string | undefined,
):
  | MakScoreResult
  | Omit<MakScoreResult, "errorCode" | "errorMessage" | "primaryRule" | "ruleHits"> {
  if (canSeeTechnicalDetails(security, role as any)) return result;
  // riskLevel permanece (nao tecnico); ruleHits/errorCode/errorMessage/
  // primaryRule ocultos para vendedor.
  const { errorCode, errorMessage, primaryRule, ruleHits, ...rest } = result;
  return rest;
}

// Converte o registro persistido em MakScoreResult (remove campos so de
// persistencia) e projeta por perfil. reviewStatus/reviewer* expostos
// apenas a analista/admin.
function projectPersisted(
  p: PersistedMakScore,
  security: SecurityContext,
  role: string | undefined,
) {
  const { cnpjHash, createdAtMs, expiresAtMs, reviewStatus, reviewerId, reviewNote, reviewedAt, ...result } = p;
  const base = projectForRole(result, security, role);
  // Decisao efetiva (automatica + review) para todos os perfis.
  const withEffective = {
    ...base,
    effectiveDecision: computeEffectiveDecision(result.outcome, reviewStatus),
  };
  if (canSeeTechnicalDetails(security, role as any)) {
    return {
      ...withEffective,
      reviewStatus,
      reviewerId: reviewerId ?? null,
      reviewNote: reviewNote ?? null,
      reviewedAt: reviewedAt ?? null,
    };
  }
  return withEffective;
}

export function buildMakScoreRouter(
  service: MakScoreService,
  cfg: MakScoreConfig,
  security: SecurityContext,
  infra: InfraStores,
): Router {
  const router = Router();
  // FAIL-OPEN: se o backend (Redis) cair, o MakScore continua atendendo
  // (disponibilidade comercial), mas emite auditoria persistente WARN
  // para visibilidade do incidente.
  let lastDegradedWarnAtMs = 0;
  const limiter = infra.makeRateLimiter(
    "makscore",
    cfg.rateLimitPerMin,
    60_000,
    "open",
    () => {
      const now = Date.now();
      // throttle do warn p/ nao floodar a auditoria sob Redis instavel
      if (now - lastDegradedWarnAtMs < 30_000) return;
      lastDegradedWarnAtMs = now;
      security.audit.write({
        ts: new Date().toISOString(),
        scope: "makscore",
        type: "query.rate_limit_degraded",
        severity: "warn",
        outcome: "failure",
        reason: "rate_limit_backend_unavailable",
        details: { failMode: "open" },
      });
    },
  );

  router.use(requireAuth(security));

  router.post("/query", async (req, res) => {
    const parse = QuerySchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "invalid_input", details: parse.error.flatten() });
      return;
    }
    const userId = req.user!.id;
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const rl = await limiter.check(`${userId}:${ip}`);
    res.setHeader("X-RateLimit-MakScore-Remaining", String(rl.remaining));
    res.setHeader("X-RateLimit-MakScore-Reset", String(Math.ceil(rl.resetAtMs / 1000)));
    if (!rl.ok) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      security.audit.write({
        ts: new Date().toISOString(),
        scope: "makscore",
        type: "query.rate_limited",
        severity: "warn",
        outcome: "failure",
        reason: "rate_limited",
        ...buildAuditContext(req, {
          userId: req.user?.id,
          role: req.user?.role,
        }),
      });
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    try {
      const queryResult = await service.query({
        cnpj: onlyDigits(parse.data.cnpj),
        product: parse.data.product,
        forceRefresh: parse.data.forceRefresh,
        context: {
          userId,
          proposalId: parse.data.proposalId,
          ticketPretendido: parse.data.ticketPretendido,
          durationMonths: parse.data.durationMonths,
          questionnaire: parse.data.questionnaire,
        },
      });
      // Separa reviewStatus (so analista/admin enxerga) e usa o valor REAL
      // para compor effectiveDecision -- garante que cache hit apos analise
      // manual reflita o veredicto do analista (e nao "automatico/none").
      const { reviewStatus, ...result } = queryResult;
      const role = req.user?.role;
      const projected = projectForRole(result, security, role);
      const tail = canSeeTechnicalDetails(security, role as any)
        ? { reviewStatus }
        : {};
      res.json({
        ...projected,
        ...tail,
        effectiveDecision: computeEffectiveDecision(result.outcome, reviewStatus),
      });
    } catch (err) {
      if (err instanceof MakScoreInputError) {
        res.status(422).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({ error: "internal_error" });
    }
  });

  // Historico. vendedor ve so as proprias; analista/admin veem geral
  // (com filtro userId opcional). Projecao por perfil.
  router.get("/history", async (req, res) => {
    const parse = HistorySchema.safeParse(req.query);
    if (!parse.success) {
      res.status(400).json({ error: "invalid_input", details: parse.error.flatten() });
      return;
    }
    const role = req.user?.role;
    const priv = canSeeTechnicalDetails(security, role as any);
    const limit = parse.data.limit ?? 20;
    const offset = parse.data.offset ?? 0;
    // vendedor sempre restrito ao proprio id (ignora userId da query).
    const filterUserId = priv ? parse.data.userId : req.user!.id;
    const filter = {
      userId: filterUserId,
      outcome: parse.data.outcome,
      fromMs: toMs(parse.data.from),
      toMs: toMs(parse.data.to),
      q: parse.data.q,
      limit,
      offset,
    };
    try {
      const [rows, total] = await Promise.all([
        service.history(filter),
        service.countHistory(filter),
      ]);
      // auditoria: privilegiado acessando dados gerais/de terceiros (sem CNPJ aberto).
      if (priv && filterUserId !== req.user!.id) {
        security.audit.write({
          ts: new Date().toISOString(),
          scope: "makscore",
          type: "history.access",
          severity: "info",
          ...buildAuditContext(req, { userId: req.user?.id, role: req.user?.role }),
          details: { filterUserId: filterUserId ?? "all", count: rows.length },
        });
      }
      res.json({
        items: rows.map((p) => projectPersisted(p, security, role)),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    } catch {
      res.status(503).json({ error: "history_unavailable" });
    }
  });

  // Detalhe por correlationId. vendedor so acessa as proprias (404 senao);
  // analista/admin acessam qualquer, com auditoria de acesso a terceiros.
  router.get("/results/:correlationId", async (req, res) => {
    const parse = ResultParamSchema.safeParse(req.params);
    if (!parse.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const role = req.user?.role;
    const priv = canSeeTechnicalDetails(security, role as any);
    try {
      const found = await service.getResult(parse.data.correlationId);
      if (!found) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const owner = found.context?.userId;
      if (!priv && owner !== req.user!.id) {
        // nao revela existencia de consulta de terceiros ao vendedor.
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (priv && owner !== req.user!.id) {
        security.audit.write({
          ts: new Date().toISOString(),
          scope: "makscore",
          type: "result.access",
          severity: "info",
          ...buildAuditContext(req, { userId: req.user?.id, role: req.user?.role }),
          details: { correlationId: found.correlationId, ownerUserId: owner ?? null },
        });
      }
      res.json(projectPersisted(found, security, role));
    } catch {
      res.status(503).json({ error: "result_unavailable" });
    }
  });

  // Guarda de review: exige analista/admin (mesmos papeis de requireRole)
  // e AUDITA a negacao como review.denied (sem CNPJ). Vendedor nao altera
  // nem le review-events.
  const requireReviewer = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const role = req.user?.role;
    if (role === "analista" || role === "admin") {
      next();
      return;
    }
    security.audit.write({
      ts: new Date().toISOString(),
      scope: "makscore",
      type: "review.denied",
      severity: "warn",
      outcome: "failure",
      reason: "role_not_allowed",
      ...buildAuditContext(req, { userId: req.user?.id, role: req.user?.role }),
    });
    res.status(403).json({ error: "forbidden" });
  };

  // Analise manual: marca pending/approved/rejected. Atomico (estado +
  // trilha). Nao altera outcome/primaryRule/ruleHits automaticos.
  router.post("/results/:correlationId/review", requireReviewer, async (req, res) => {
    const pp = ResultParamSchema.safeParse(req.params);
    const pb = ReviewActionSchema.safeParse(req.body);
    if (!pp.success || !pb.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const role = req.user?.role;
    try {
      const applied = await service.review({
        correlationId: pp.data.correlationId,
        toStatus: pb.data.status,
        reviewerId: req.user!.id,
        note: pb.data.note ?? null,
      });
      if (!applied) {
        security.audit.write({
          ts: new Date().toISOString(),
          scope: "makscore",
          type: "review.not_found",
          severity: "info",
          outcome: "failure",
          ...buildAuditContext(req, { userId: req.user?.id, role: req.user?.role }),
          details: { correlationId: pp.data.correlationId },
        });
        res.status(404).json({ error: "not_found" });
        return;
      }
      // Auditoria SEM CNPJ e SEM note (note pode ter contexto comercial).
      security.audit.write({
        ts: new Date().toISOString(),
        scope: "makscore",
        type: "review.changed",
        severity: "info",
        outcome: "success",
        ...buildAuditContext(req, { userId: req.user?.id, role: req.user?.role }),
        details: {
          correlationId: applied.record.correlationId,
          fromStatus: applied.fromStatus,
          toStatus: applied.record.reviewStatus,
        },
      });
      res.json(projectPersisted(applied.record, security, role));
    } catch {
      res.status(503).json({ error: "review_unavailable" });
    }
  });

  // Trilha de eventos da review (analista/admin). Sem CNPJ aberto.
  router.get("/results/:correlationId/review-events", requireReviewer, async (req, res) => {
    const parse = ResultParamSchema.safeParse(req.params);
    if (!parse.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    try {
      const found = await service.getResult(parse.data.correlationId);
      if (!found) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ events: await service.reviewEvents(parse.data.correlationId) });
    } catch {
      res.status(503).json({ error: "review_events_unavailable" });
    }
  });

  router.get(
    "/audit/recent",
    requireRole(security, "analista", "admin"),
    async (_req, res) => {
      try {
        res.json({ events: await service.auditSink.recent(50) });
      } catch {
        res.status(503).json({ error: "audit_unavailable" });
      }
    },
  );

  // Schema do questionario (fonte unica). Qualquer perfil autenticado
  // pode obter para renderizar o formulario e prever o score.
  router.get("/questionnaire", (_req, res) => {
    res.json(getQuestionnaireSchema());
  });

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

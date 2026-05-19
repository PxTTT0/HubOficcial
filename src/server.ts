import express from "express";
import path from "path";
import { createMakScoreModule } from "./modules/makscore";
import {
  applyCors,
  applyCsrf,
  applySecurityHeaders,
  createSecurityContext,
  loadSecurityAuditConfig,
} from "./security";
import { validateProductionEnvironment } from "./security/bootstrap";

export function buildApp() {
  const app = express();
  const security = createSecurityContext();
  const makscore = createMakScoreModule(security);
  validateProductionEnvironment({
    envName: security.cfg.envName,
    security: security.cfg,
    audit: {
      ...loadSecurityAuditConfig(),
      configured:
        process.env.AUDIT_LOG_PATH !== undefined &&
        process.env.AUDIT_LOG_PATH.trim().length > 0,
    },
    makscore: {
      cnpjPepper: process.env.MAKSCORE_CNPJ_PEPPER ?? "",
      eposiMode: makscore.cfg.eposiMode,
      eposiLogin: makscore.cfg.eposiLogin,
      eposiPassword: makscore.cfg.eposiPassword,
      eposiLoginSecondary: makscore.cfg.eposiLoginSecondary,
      eposiPasswordSecondary: makscore.cfg.eposiPasswordSecondary,
    },
  });
  app.disable("x-powered-by");
  app.set("trust proxy", security.cfg.trustProxy);
  app.use(applySecurityHeaders(security.cfg));
  app.use(applyCors(security.cfg));
  app.use(express.json({ limit: "16kb" }));
  app.use(applyCsrf(security.cfg, security.audit));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", security.authRouter);
  app.use("/api/makscore", makscore.router);

  // Static UI mobile-first do MakScore (apenas frontend operacional simples).
  app.use("/makscore", express.static(path.join(__dirname, "..", "public", "makscore")));

  app.get("/", (_req, res) => {
    res.redirect("/makscore");
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      scope: "server",
      level: "error",
      message: err instanceof Error ? err.message : "Unhandled server error",
    }));
    res.status(500).json({ error: "internal_error" });
  });

  return { app, makscore, security };
}

const { app, makscore } = buildApp();

const port = Number(process.env.PORT ?? 3000);
if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      scope: "server",
      message: `HUB Vendas API listening on :${port}`,
      makscoreMode: makscore.cfg.eposiMode,
    }));
  });
}

export { app };

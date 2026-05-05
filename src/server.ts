import express from "express";
import path from "path";
import { createMakScoreModule } from "./modules/makscore";
import {
  applyCors,
  applySecurityHeaders,
  createSecurityContext,
} from "./security";

export function buildApp() {
  const app = express();
  const security = createSecurityContext();
  app.disable("x-powered-by");
  app.set("trust proxy", security.cfg.trustProxy);
  app.use(applySecurityHeaders(security.cfg));
  app.use(applyCors(security.cfg));
  app.use(express.json({ limit: "16kb" }));

  const makscore = createMakScoreModule(security);
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

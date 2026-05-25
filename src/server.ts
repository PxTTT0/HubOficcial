import express from "express";
import path from "path";
import { createMakScoreModule } from "./modules/makscore";
import { loadConfig as loadMakScoreConfig } from "./modules/makscore/config";
import {
  applyCors,
  applyCsrf,
  applySecurityHeaders,
  createSecurityContext,
  loadSecurityAuditConfig,
  loadSecurityConfig,
} from "./security";
import { validateProductionEnvironment } from "./security/bootstrap";
import { createInfraStores } from "./infra";
import { loadRedisConfig } from "./infra/redisClient";
import { loadDbConfig } from "./infra/db/pool";
import { parseEncryptionKey } from "./infra/db/crypto";
import { assertSchemaReady, runMigrations } from "./infra/db/migrate";
import { seedBootstrapUsers } from "./infra/db/userRepository";

export function buildApp() {
  const app = express();

  // Validacao de producao ANTES de construir a infra: garante que todas
  // as issues sejam agregadas em ProductionSecurityError (em vez de o
  // factory lancar isolado, ex. chave de cifragem invalida).
  const securityCfg = loadSecurityConfig();
  const makscoreCfg = loadMakScoreConfig();
  const redisCfg = loadRedisConfig();
  const dbCfg = loadDbConfig();
  const keyParsed = parseEncryptionKey(
    process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY,
  );
  validateProductionEnvironment({
    envName: securityCfg.envName,
    security: securityCfg,
    audit: {
      ...loadSecurityAuditConfig(),
      configured:
        process.env.AUDIT_LOG_PATH !== undefined &&
        process.env.AUDIT_LOG_PATH.trim().length > 0,
    },
    makscore: {
      cnpjPepper: process.env.MAKSCORE_CNPJ_PEPPER ?? "",
      eposiMode: makscoreCfg.eposiMode,
      eposiLogin: makscoreCfg.eposiLogin,
      eposiPassword: makscoreCfg.eposiPassword,
      eposiLoginSecondary: makscoreCfg.eposiLoginSecondary,
      eposiPasswordSecondary: makscoreCfg.eposiPasswordSecondary,
    },
    redis: {
      url: redisCfg.url,
      allowInMemoryState: redisCfg.allowInMemoryState,
    },
    db: {
      url: dbCfg.url,
      // Opt-out de emergencia reusado (mesma flag do Redis).
      allowInMemoryState: redisCfg.allowInMemoryState,
      encryptionKeyOk: keyParsed.ok,
      encryptionKeyReason: keyParsed.reason,
    },
  });

  const infra = createInfraStores();
  const security = createSecurityContext(
    securityCfg,
    undefined,
    undefined,
    undefined,
    infra,
  );
  const makscore = createMakScoreModule(security, infra);

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

  return { app, makscore, security, infra };
}

/**
 * Preparacao do schema antes de servir. Em production NAO roda migration
 * automaticamente sem DB_RUN_MIGRATIONS_ON_STARTUP=true - apenas verifica
 * e falha claro se o schema estiver ausente/desatualizado.
 */
async function prepareDatabase(
  infra: ReturnType<typeof buildApp>["infra"],
): Promise<void> {
  if (infra.dbMode !== "pg" || !infra.sqlExecutor) return;
  if (infra.dbConfig.runMigrationsOnStartup) {
    const applied = await runMigrations(infra.sqlExecutor);
    await seedBootstrapUsers(infra.sqlExecutor);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      scope: "server",
      message: "db migrations applied",
      applied,
    }));
  } else {
    // Pode faltar schema: falha de forma clara, nao serve pela metade.
    await assertSchemaReady(infra.sqlExecutor);
  }
}

const built = buildApp();
const app = built.app;

const port = Number(process.env.PORT ?? 3000);
if (require.main === module) {
  prepareDatabase(built.infra)
    .then(() => {
      app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          scope: "server",
          message: `HUB Vendas API listening on :${port}`,
          makscoreMode: built.makscore.cfg.eposiMode,
          backing: built.infra.mode,
          db: built.infra.dbMode,
        }));
      });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        scope: "server",
        level: "fatal",
        message: err instanceof Error ? err.message : "db preparation failed",
      }));
      process.exit(1);
    });
}

export { app };

/**
 * Runner standalone de migrations. Uso em deploy controlado:
 *   npm run db:migrate           (ts-node)
 *   node dist/src/scripts/migrate.js
 *
 * Aplica migrations pendentes e roda o seed idempotente do bootstrap
 * admin. Exit 0 em sucesso, 1 em falha. Nao loga segredo/chave.
 */
import { createPgExecutor, loadDbConfig } from "../infra/db/pool";
import { runMigrations } from "../infra/db/migrate";
import { seedBootstrapUsers } from "../infra/db/userRepository";

async function main(): Promise<void> {
  const cfg = loadDbConfig();
  if (!cfg.url) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL ausente - nada a migrar");
    process.exit(1);
  }
  const exec = createPgExecutor(cfg);
  try {
    const applied = await runMigrations(exec);
    const created = await seedBootstrapUsers(exec);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        scope: "db:migrate",
        applied,
        bootstrapUsersCreated: created,
      }),
    );
  } finally {
    await exec.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      scope: "db:migrate",
      level: "fatal",
      message: err instanceof Error ? err.message : "migrate failed",
    }),
  );
  process.exit(1);
});

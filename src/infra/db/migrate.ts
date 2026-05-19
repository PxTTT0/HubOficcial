import type { SqlExecutor } from "./pool";
import { LATEST_MIGRATION_VERSION, MIGRATIONS } from "./migrations";

// Constante arbitraria e estavel para o advisory lock do migrate.
const MIGRATION_ADVISORY_LOCK = 873214567;

export class SchemaNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaNotReadyError";
  }
}

async function ensureMigrationsTable(exec: SqlExecutor): Promise<void> {
  // Select-or-create (em vez de CREATE IF NOT EXISTS repetido): valido no
  // Postgres real e evita o re-parse de constraints que o pg-mem rejeita
  // em modo estrito quando a tabela ja existe.
  try {
    await exec.query("SELECT 1 FROM schema_migrations LIMIT 1");
    return;
  } catch {
    // tabela ausente: cria abaixo
  }
  try {
    await exec.query(
      `CREATE TABLE schema_migrations (
         version    text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
  } catch {
    // corrida de boot concorrente (outra replica criou): ok
  }
}

async function appliedVersions(exec: SqlExecutor): Promise<Set<string>> {
  const r = await exec.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  return new Set(r.rows.map((x) => x.version));
}

/**
 * Aplica migrations pendentes. Usa pg_advisory_lock para serializar boot
 * multi-replica (best-effort: pg-mem nao implementa advisory lock, entao
 * a falha do lock e ignorada nos testes).
 */
export async function runMigrations(exec: SqlExecutor): Promise<string[]> {
  let locked = false;
  try {
    await exec.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK]);
    locked = true;
  } catch {
    // pg-mem / sem suporte a advisory lock: segue sem o lock.
  }
  try {
    await ensureMigrationsTable(exec);
    const done = await appliedVersions(exec);
    const applied: string[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await exec.query(m.sql);
      await exec.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
        m.version,
      ]);
      applied.push(m.version);
    }
    return applied;
  } finally {
    if (locked) {
      try {
        await exec.query("SELECT pg_advisory_unlock($1)", [
          MIGRATION_ADVISORY_LOCK,
        ]);
      } catch {
        /* noop */
      }
    }
  }
}

/**
 * Falha de forma clara se o schema esperado nao estiver presente. Usado
 * quando a migration automatica esta desabilitada (producao sem
 * DB_RUN_MIGRATIONS_ON_STARTUP=true): o app NAO deve subir servindo com
 * schema ausente/incompleto.
 */
export async function assertSchemaReady(exec: SqlExecutor): Promise<void> {
  try {
    await ensureMigrationsTable(exec);
  } catch (err) {
    throw new SchemaNotReadyError(
      "Nao foi possivel verificar schema_migrations - banco inacessivel ou schema ausente",
    );
  }
  const done = await appliedVersions(exec);
  const missing = MIGRATIONS.filter((m) => !done.has(m.version)).map(
    (m) => m.version,
  );
  if (missing.length > 0) {
    throw new SchemaNotReadyError(
      `Schema desatualizado. Migrations pendentes: ${missing.join(", ")}. ` +
        `Rode as migrations (DB_RUN_MIGRATIONS_ON_STARTUP=true ou 'npm run db:migrate') antes de subir. ` +
        `Versao esperada: ${LATEST_MIGRATION_VERSION}`,
    );
  }
}

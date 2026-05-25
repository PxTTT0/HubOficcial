/**
 * Seam minima sobre Postgres. Repositorios dependem de `SqlExecutor`,
 * nao de `pg` diretamente => testaveis com pg-mem e `pg` carregado lazy
 * (require) apenas quando DATABASE_URL existe.
 */
export interface SqlResult<R = any> {
  rows: R[];
  rowCount: number | null;
}

export interface SqlExecutor {
  query<R = any>(text: string, params?: unknown[]): Promise<SqlResult<R>>;
}

export type DbBackingMode = "pg" | "memory";

export interface DbConfig {
  url: string | null;
  ssl: boolean;
  poolMax: number;
  /**
   * Migrations automaticas no startup. Em production so roda se
   * explicitamente true. Em dev/test roda se DATABASE_URL presente.
   */
  runMigrationsOnStartup: boolean;
}

function boolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function numEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadDbConfig(): DbConfig {
  const url = process.env.DATABASE_URL?.trim();
  const envName = process.env.NODE_ENV ?? "development";
  const hasUrl = Boolean(url && url.length > 0);
  // Em dev/test: auto se ha DATABASE_URL. Em production: SO se a flag
  // estiver explicitamente true (evita migrar sem querer em prod).
  const runMigrationsOnStartup =
    envName === "production"
      ? boolEnv(process.env.DB_RUN_MIGRATIONS_ON_STARTUP, false)
      : hasUrl && boolEnv(process.env.DB_RUN_MIGRATIONS_ON_STARTUP, true);

  return {
    url: hasUrl ? (url as string) : null,
    ssl: boolEnv(process.env.DB_SSL, false),
    poolMax: numEnv(process.env.DB_POOL_MAX, 10),
    runMigrationsOnStartup,
  };
}

export function resolveDbBackingMode(cfg: DbConfig): DbBackingMode {
  return cfg.url ? "pg" : "memory";
}

/**
 * Pool real do pg, carregado via require dinamico (nao acopla tsc/testes).
 * So chamado quando DATABASE_URL existe.
 */
export function createPgExecutor(cfg: DbConfig): SqlExecutor & { end(): Promise<void> } {
  if (!cfg.url) throw new Error("createPgExecutor chamado sem DATABASE_URL");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: cfg.url,
    max: cfg.poolMax,
    ...(cfg.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  return {
    async query<R = any>(text: string, params?: unknown[]): Promise<SqlResult<R>> {
      const r = await pool.query(text, params as any[]);
      return { rows: r.rows as R[], rowCount: r.rowCount };
    },
    async end() {
      await pool.end();
    },
  };
}

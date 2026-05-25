/**
 * Conjunto de migrations versionadas (ordem = ordem do array).
 *
 * Embarcadas como modulo TS (nao .sql solto) para: estarem no dist sem
 * passo de copia no Docker, e rodarem identicas no pg-mem dos testes.
 *
 * Convencoes p/ portabilidade com pg-mem:
 *  - sem citext: username e normalizado (lowercase) pela app + unique
 *    simples na coluna.
 *  - sem extensoes; ids sao strings da app.
 */
export interface Migration {
  version: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: "0001_init",
    sql: `
CREATE TABLE IF NOT EXISTS users (
  id            text        PRIMARY KEY,
  username      text        NOT NULL UNIQUE,
  role          text        NOT NULL,
  password_hash text        NOT NULL,
  disabled      boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- secret_* guardam o AES-256-GCM em base64 (text). base64 e ASCII:
-- portavel (nenhuma corrupcao de binario por driver) e valido no
-- Postgres real. Nunca o secret em claro.
CREATE TABLE IF NOT EXISTS user_mfa (
  user_id        text     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled        boolean  NOT NULL DEFAULT false,
  secret_ct      text,
  secret_iv      text,
  secret_tag     text,
  last_used_step integer  NOT NULL DEFAULT -1,
  enrolled_at_ms bigint
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash    text NOT NULL,
  PRIMARY KEY (user_id, hash)
);
`,
  },
  {
    version: "0002_makscore_audit",
    sql: `
CREATE TABLE IF NOT EXISTS makscore_audit (
  id             bigserial   PRIMARY KEY,
  ts             timestamptz NOT NULL DEFAULT now(),
  correlation_id text,
  type           text        NOT NULL,
  cnpj_masked    text,
  product        text,
  outcome        text,
  primary_rule   text,
  error_code     text,
  http_status    integer,
  user_id        text,
  duration_ms    integer,
  source_is_mock boolean,
  message        text
);

CREATE INDEX IF NOT EXISTS makscore_audit_ts_idx   ON makscore_audit (ts);
CREATE INDEX IF NOT EXISTS makscore_audit_corr_idx ON makscore_audit (correlation_id);
CREATE INDEX IF NOT EXISTS makscore_audit_user_idx ON makscore_audit (user_id);
`,
  },
];

export const LATEST_MIGRATION_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]?.version ?? null;

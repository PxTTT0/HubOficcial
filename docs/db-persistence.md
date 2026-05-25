# Persistência durável (Postgres)

## O que vai para o DB (fonte de verdade)

| Domínio | Tabela |
|---|---|
| Usuários | `users` |
| MFA enrollment/secret | `user_mfa` (secret cifrado em repouso) |
| Replay TOTP | `user_mfa.last_used_step` (compare-and-set atômico) |
| Recovery codes | `mfa_recovery_codes` (1 linha/hash, consumo single-use atômico) |
| Auditoria funcional MakScore | `makscore_audit` |
| Controle de migrations | `schema_migrations` |

**Fronteira:** Redis continua dono de estado **efêmero** (sessões, rate
limit, challenge MFA, token E-POSI). O DB é a verdade **durável**.

## Configuração

| Env | Default | Papel |
|---|---|---|
| `DATABASE_URL` | (vazio) | Ausente ⇒ fallback memória (dev/test) |
| `DB_SSL` | `false` | TLS para Postgres gerenciado |
| `DB_POOL_MAX` | `10` | Tamanho do pool |
| `DB_RUN_MIGRATIONS_ON_STARTUP` | `false` | Migrations automáticas no boot |
| `AUTH_MFA_SECRET_ENCRYPTION_KEY` | (vazio) | **Obrigatória com DB**: base64 → 32 bytes |
| `ALLOW_IN_MEMORY_STATE` | `false` | Opt-out emergencial (reduz maturidade) |

## Migrations

Runner próprio (`src/infra/db/migrate.ts`) com `pg_advisory_lock` para
serializar boot multi-réplica. Migrations são módulo TS versionado
(`migrations.ts`) — sem passo de cópia no Docker.

- **dev/test:** com `DATABASE_URL` presente, roda automático no boot.
- **produção:** **não roda automático** salvo `DB_RUN_MIGRATIONS_ON_STARTUP=true`.
  Sem a flag, o app **verifica** o schema e **falha claro**
  (`SchemaNotReadyError`) se houver migration pendente — não serve pela
  metade. Rode no passo controlado de deploy:
  ```
  npm run db:migrate
  ```
- Idempotente: re-execução não reaplica versões já registradas.

## Seed bootstrap (idempotente)

`AUTH_BOOTSTRAP_ADMIN_*` / `AUTH_USERS_JSON` são **bootstrap inicial**,
não gestão permanente. O seed:

- Cria **apenas usuários ausentes** (`INSERT ... ON CONFLICT DO NOTHING`).
- **Nunca** sobrescreve `password_hash`, `role`, `disabled` ou MFA de
  usuário existente (senha rotacionada permanece).

## Cifragem do secret TOTP

AES-256-GCM. Chave `AUTH_MFA_SECRET_ENCRYPTION_KEY` em base64 que
decodifica para **exatamente 32 bytes**. Em produção com `DATABASE_URL`
ativo, chave ausente/fraca → **fail-fast** agregado no
`ProductionSecurityError`.

> ⚠️ Perder a chave equivale a **resetar o MFA de todos os usuários**
> (secrets ficam indecifráveis). Rotação de chave **fora de escopo**
> (próxima melhoria). Nunca logar a chave, o secret, o ciphertext ou
> recovery hashes.

## Atomicidade (multi-réplica)

- **Replay TOTP:** `UPDATE user_mfa SET last_used_step=$new WHERE
  user_id=$id AND last_used_step < $new`. Dois processos com o mesmo
  step: só um aplica; o outro recebe `false` ⇒ rejeitado.
- **Recovery single-use:** `DELETE FROM mfa_recovery_codes WHERE
  user_id=$id AND hash=$h RETURNING hash`. Só o primeiro consumidor
  deleta a linha; concorrentes recebem `rowCount=0`.

## Retenção da auditoria funcional

`makscore_audit` cresce indefinidamente. Indexada por `ts`,
`correlation_id`, `user_id`. **Limpeza automática fora de escopo** desta
entrega (próxima melhoria) — operacionalmente, agendar purge/partition
por data conforme política de retenção.

## Fallback dev/test

Sem `DATABASE_URL`: `InMemoryUserRepository` + `InMemoryAuditSink`
(comportamento idêntico ao legado). Testes rodam **sem Postgres real**
(`pg-mem` como devDependency) — cobrem migrations, repositório, CAS de
`last_used_step`, single-use de recovery e cifragem.

## Limitações conhecidas

- `pg-mem` não emula 100% do Postgres (advisory lock é best-effort no
  runner; validação final exige Postgres real em homologação).
- Sem HA do Postgres (réplica/failover) — fora de escopo.
- Rotação da chave de cifragem do MFA — fora de escopo.

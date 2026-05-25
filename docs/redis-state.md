# Estado distribuído (Redis)

## O que vai para o Redis

Estado **efêmero/operacional** — não é fonte de verdade de domínio:

| Estado | Store | Chave |
|---|---|---|
| Sessões | `SessionStore` | `sess:{sid}` + `sess:user:{userId}` |
| Rate limits (user/ip/login/login-failure/mfa-ip/mfa-failure/makscore) | `RateLimitBackend` | `rl:{name}:{key}` |
| Challenge MFA (senha→TOTP) | `MfaChallengeStore` | `mfa:chal:{cid}` |
| Token E-POSI (cache) | `EposiTokenStore` | `eposi:token` |

Chaves prefixadas por `REDIS_KEY_PREFIX` (default `hubvendas:`).

**Fora de escopo (fica para `codex/db-users-mfa-audit`):** usuários, segredo
MFA, `lastUsedStep` (replay), recovery hashes, auditoria — são dados
duráveis e vão para banco, não Redis.

## Configuração

| Env | Default | Papel |
|---|---|---|
| `REDIS_URL` | (vazio) | Ausente ⇒ fallback memória (dev/test) |
| `REDIS_KEY_PREFIX` | `hubvendas:` | Namespacing |
| `REDIS_TLS` | `false` | Redis gerenciado com TLS |
| `ALLOW_IN_MEMORY_STATE` | `false` | Opt-out emergencial (ver abaixo) |

## Política de Redis indisponível (fail policy)

| Domínio | Política | Comportamento se Redis cair |
|---|---|---|
| Sessões | **fail-closed** | `get` ⇒ null ⇒ 401 (nunca abre sessão por falha de infra) |
| Rate limit auth/login/MFA | **fail-closed** | bloqueia (segurança > disponibilidade) |
| Rate limit MakScore | **fail-open** | libera + `query.rate_limit_degraded` (audit WARN persistente, com throttle de 30s) |
| Token E-POSI | **fail-open** | cache miss ⇒ reautentica direto na E-POSI |
| MFA challenge | **fail-closed** | sem challenge válido ⇒ login MFA nega |

`consume` do challenge MFA usa GETDEL atômico ⇒ anti double-spend entre réplicas.

## Produção exige Redis

Em `NODE_ENV=production`, o startup **falha** (`ProductionSecurityError`,
agregado com os demais checks) se `REDIS_URL` estiver ausente.

### Opt-out emergencial — `ALLOW_IN_MEMORY_STATE=true`

> ⚠️ **Uso APENAS emergencial/dev.** Permite subir produção sem Redis.
> **Reduz a maturidade de segurança:** sessões, rate limits, challenges
> MFA e token E-POSI ficam em memória — **perdem no restart** e **não são
> compartilhados entre réplicas** (rate limit efetivo ≈ N × limite, com N
> instâncias). Não deve ser o estado permanente de produção. Remover
> assim que o Redis estiver disponível.

## Fallback dev/test

Sem `REDIS_URL`, todos os stores usam implementação em memória. Os testes
rodam **sem Redis real** (fake `RedisLike` in-process): cobrem store,
restart (novo store / mesmo backend), múltiplas instâncias (backend
compartilhado), consume atômico e as políticas fail-open/closed.

## Health endpoints

| Endpoint | Tipo | Comportamento | Uso |
|---|---|---|---|
| `GET /healthz` | liveness | 200 fixo se o processo está de pé (não checa deps) | restart do container |
| `GET /readyz` | readiness | ping Redis (`PING`) + Postgres (`SELECT 1`) com timeout; 200 se ok, **503** se alguma dep cair; em modo memória reporta `disabled` e 200 | load balancer / orquestrador (rotear tráfego) |

`/readyz` retorna `{ ok, checks: { redis, db } }` com status `ok|down|disabled`
— sem vazar string de conexão. Ambos são públicos (sem auth).

## Limitações conhecidas

- Token E-POSI compartilhado reduz reautenticações, mas não há lock
  distribuído na renovação (duas réplicas podem reautenticar quase
  simultaneamente no vencimento — aceitável, idempotente).
- Sem Redis Sentinel/Cluster (HA) nesta branch — fora de escopo.

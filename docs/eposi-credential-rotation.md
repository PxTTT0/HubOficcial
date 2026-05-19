# Runbook — Rotação de credencial E-POSI (primary/secondary)

## Modelo

O cliente E-POSI suporta duas credenciais: **primary** e **secondary**.
A secundária é **opcional**. Quando ambas existem, o cliente tenta a
primeira da ordem; se a autenticação falhar, cai automaticamente para a
outra (**fallback**).

| Variável | Obrigatória | Papel |
|---|---|---|
| `MAKSCORE_EPOSI_LOGIN` / `MAKSCORE_EPOSI_PASSWORD` | Sim (em `live`) | Credencial primária |
| `MAKSCORE_EPOSI_LOGIN_SECONDARY` / `MAKSCORE_EPOSI_PASSWORD_SECONDARY` | Não | Credencial secundária (rotação) |
| `MAKSCORE_EPOSI_ACTIVE_CREDENTIAL` | Não (`primary`) | `primary` \| `secondary` — inverte a ordem de tentativa |

### Garantias

- **Compat total:** só primária configurada → comportamento idêntico ao
  legado (1 credencial, sem fallback).
- **Secundária parcial falha o startup** em `NODE_ENV=production` +
  `MAKSCORE_EPOSI_MODE=live` (login sem senha ou vice-versa).
- `ACTIVE_CREDENTIAL` **inverte a ordem mas nunca desliga o fallback**.
- Erro final, quando **ambas** falham, é genérico e **sem segredo**.
- Auditoria persistente registra apenas `credentialId`, `reason`
  sanitizado e `httpStatus`. **Nunca** login, senha, token ou payload.

## Procedimento de rotação (sem downtime)

Cenário: a senha da credencial primária vai ser trocada na E-POSI.

1. **Provisionar a nova credencial como secundária.**
   No Portainer (aba Env do stack) defina:
   ```
   MAKSCORE_EPOSI_LOGIN_SECONDARY=<novo login>
   MAKSCORE_EPOSI_PASSWORD_SECONDARY=<nova senha>
   ```
   Redeploy. A primária continua servindo; a secundária fica de prontidão.

2. **Validar a secundária** sem afetar tráfego: faça o cutover de ordem:
   ```
   MAKSCORE_EPOSI_ACTIVE_CREDENTIAL=secondary
   ```
   Redeploy. Agora a secundária é tentada primeiro; a primária continua
   como fallback. Confirme no audit persistente:
   - `eposi.auth.success` com `details.credentialId = "secondary"`.

3. **Promover a secundária a primária.**
   Quando estável, mova os valores: a nova credencial vira
   `MAKSCORE_EPOSI_LOGIN` / `MAKSCORE_EPOSI_PASSWORD`, limpe as
   `_SECONDARY` e remova `MAKSCORE_EPOSI_ACTIVE_CREDENTIAL` (volta a
   `primary`). Redeploy.

4. **Revogar a credencial antiga** na plataforma E-POSI.

## Observação de auditoria

Eventos (escopo `makscore`) no audit persistente de segurança:

| `type` | Quando | severity |
|---|---|---|
| `eposi.auth.success` | autenticou | info |
| `eposi.auth.failure` | uma credencial falhou (segue p/ próxima) | warn |
| `eposi.auth.fallback` | trocou de credencial | warn |
| `eposi.auth.exhausted` | todas falharam OU nenhuma configurada | high |

`reason` usa vocabulário fixo: `auth_rejected_401`, `auth_rejected_403`,
`auth_http_<status>`, `missing_token`, `timeout`, `network_error`,
`credentials_absent`, `all_credentials_failed`, `previous_failed`.

## Limitações conhecidas

- Cache de token é **em memória por processo** (perde no restart;
  múltiplas réplicas não compartilham). Movido para Redis numa branch
  futura (`codex/redis-session-rate-limit`).
- Não há rotação automática agendada nem integração com secret manager
  externo — apenas o *seam* (`EposiCredentialProvider`) está pronto.

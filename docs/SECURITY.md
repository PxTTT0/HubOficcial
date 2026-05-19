# Contrato de Seguranca

Este contrato vale para todos os modulos atuais e futuros do HUB de Vendas.

## Rotas API

- Toda rota operacional em `/api/*` deve passar por autenticacao, exceto endpoints publicos explicitamente aprovados como `/api/auth/login`, `/api/auth/login/mfa` e `/healthz`.
- Rotas que leem dados administrativos, auditoria, parametros de preco, logistica ou score tecnico devem aplicar RBAC com `requireRole`.
- Rotas mutaveis acessadas por cookie devem aceitar somente requests com `X-CSRF-Token` valido.
- Todo input de rota deve ser validado com schema (Zod ou equivalente local) antes de chamar service/repository.
- Rotas sensiveis devem aplicar rate limit por identidade e/ou IP.
- Eventos sensiveis devem gerar auditoria persistente: login, logout, MFA, negacao de RBAC, rate limit, CSRF, alteracoes administrativas e acessos a dados sensiveis.
- Erros de seguranca retornados ao cliente devem usar codigos genericos (`unauthenticated`, `forbidden`, `rate_limited`, `invalid_input`) sem stack trace, segredo, token, senha, CNPJ aberto ou payload bruto de fornecedor.

## Endpoints Publicos

- `/healthz` e o endpoint publico operacional para healthcheck. Ele retorna somente `{ "ok": true }`.
- A UI estatica pode ser publica, mas nao deve carregar segredos nem dados sensiveis sem chamar APIs autenticadas.
- Novos endpoints publicos precisam ser documentados aqui e cobertos por teste.

## Producao

Em `NODE_ENV=production`, o app deve falhar ao subir se configuracoes criticas estiverem ausentes ou inseguras:

- `AUTH_SESSION_SECRET` forte e diferente do default de desenvolvimento.
- `AUTH_SECURE_COOKIES=true`.
- `AUTH_TRUSTED_ORIGINS` preenchido com origens HTTPS confiaveis.
- `MAKSCORE_CNPJ_PEPPER` preenchido.
- `AUDIT_LOG_PATH` preenchido e apontando para volume persistente.
- `AUTH_ALLOW_DEV_HEADER_AUTH=false`.

## Auditoria JSONL

- O arquivo `AUDIT_LOG_PATH` e append-only em JSON Lines.
- Configure volume persistente no container.
- Configure rotacao externa (`logrotate`, politica do host ou agente de logs) por tamanho/idade.
- Retencao recomendada inicial: 90 dias em storage operacional e exportacao para storage central quando disponivel.
- Nunca registrar senha, token, secret TOTP, codigo MFA, recovery code, CNPJ aberto ou payload bruto da E-POSI.

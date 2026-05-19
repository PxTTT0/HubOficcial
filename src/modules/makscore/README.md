# Modulo MakScore

Modulo de decisao assistida CNPJ no HUB de Vendas Makfil. Substitui o
checklist manual genérico anterior por um pipeline integrado:

```
E-POSI -> normalizacao -> politica Makfil -> persistencia resumida + auditoria
```

## Estados finais

- `aprovado`
- `reprovado`
- `exige_analise`
- `indisponivel_temporariamente`

## Decisoes Makfil aplicadas

- Produto E-POSI padrao: `TOTAL_PJ`. `COMPLETA_PJ` continua suportado como opcao.
- Payload live correto: `{ "documento": "...", "consultas": ["TOTAL_PJ"] }`
  conforme manual.
- Thresholds:
  - `MAKSCORE_APPROVE_MIN_SCORE=700`
  - `MAKSCORE_REPROVE_MAX_SCORE=400`
  - score baixo sozinho NAO reprova; vai para `exige_analise`.
- Bloqueios absolutos (reprovacao automatica):
  - CNPJ invalido
  - CNPJ inapto, baixado, suspenso ou nulo
  - bloqueio judicial / administrativo
  - empresa falida
  - ErrorCode E-POSI impeditivo
- Protesto e negativacao -> sempre `exige_analise`, nunca reprovacao automatica.
- Ticket pretendido (`ticketPretendido` no contrato + `MAKSCORE_HIGH_TICKET_AMOUNT`):
  - ausencia nao quebra consulta
  - ticket alto + score intermediario / empresa recente / baixa info -> reforca `exige_analise`
  - ticket sozinho NAO aprova nem reprova
- Validade do score: `24h`.
- Publico-alvo do MakScore v1: 100% usuarios internos.
- Sem override humano nesta fase. Estrutura `parecerManual` ja prevista no
  contexto, mas nao altera o outcome automatico.

## Estrutura

```
src/modules/makscore/
  index.ts          fabrica do modulo (router + service)
  config.ts         carga de configuracao por env var
  cnpj.ts           validacao + masking
  errorCodes.ts     ErrorCode E-POSI -> outcome Makfil
  reasonCodes.ts    ReasonCode (R0..R31+) -> traducao operacional
  eposiClient.ts    LiveEposiClient + MockEposiClient (formato real do manual)
  normalizer.ts     payload aninhado (VerifiQPJ/ReportPJ) -> NormalizedEposi
  policy.ts         politica Makfil de decisao + ticket pretendido
  service.ts        orquestracao + cache + auditoria
  repository.ts     persistencia resumida (sem payload bruto)
  audit.ts          trilha estruturada com CNPJ mascarado
  rateLimit.ts      limitador por usuario
  routes.ts         rotas Express + RBAC + visibilidade por perfil
  auth.ts           contrato de auth (stub para integrar com AUTH-*)
  types.ts
```

## Endpoints

- `POST /api/makscore/query`
  - body: `{ cnpj, product?, proposalId?, ticketPretendido?, forceRefresh? }`
- `GET  /api/makscore/audit/recent` - somente analista/admin
- `GET  /api/makscore/health` - diagnostico (sem segredos)

Auth via headers `x-user-id` e `x-user-role` (stub - substituir pelo
sistema de sessao da v1 quando AUTH-* estiver pronto).

### Visibilidade por perfil (usuario interno)

- `analista` / `admin`: recebem `score`, motivos, dados cadastrais,
  `errorCode`, `errorMessage`, `primaryRule` e `correlationId`.
- demais perfis internos: recebem `score`, motivos e dados cadastrais,
  sem campos tecnicos sensiveis.

Em qualquer caso o frontend NAO recebe token E-POSI nem payload bruto.

## Modos

- `MAKSCORE_EPOSI_MODE=mock` (default em dev): nao chama E-POSI, marca
  `sourceIsMock: true` em todas as respostas. Mock emite o formato real
  (`VerifiQPJResponseEx`/`ReportPJResponseEx`). Cenarios deterministicos por
  sufixo do CNPJ:
  - `..01` ErrorCode 1001 (reprova)
  - `..02` situacao inapta + 1005 (reprova)
  - `..03` bloqueio judicial 1003 (reprova)
  - `..04` indisponivel 1021
  - `..05` Opt-Out 1006 (exige analise)
  - `..06` score 350 + apontamento (exige analise)
  - `..07` score 550 (exige analise)
  - default: score >= 720 (aprovado)
- `MAKSCORE_EPOSI_MODE=live`: integracao real, exige
  `MAKSCORE_EPOSI_LOGIN` / `MAKSCORE_EPOSI_PASSWORD`.

> Importante: o login da ferramenta web E-POSI NAO e automaticamente o
> mesmo da API. Confirmar com a Makfil/E-POSI antes de usar live.

## Politica de decisao (ordem)

1. ErrorCode E-POSI -> `errorCodes.ts` (HTTP 200 com ErrorCode jamais aprova).
2. Situacao cadastral irregular -> `reprovado`.
3. Score ausente -> `exige_analise`.
4. Score <= reproveMaxScore -> `exige_analise` (nao reprova auto).
5. Negativacao ou protesto -> `exige_analise`.
6. Reason code critico -> `exige_analise`.
7. Cadastral desconhecida em modo live -> `exige_analise`.
8. Ticket alto + score intermediario / R1 / R0 / R2 -> `exige_analise`.
9. Score >= approveMinScore -> `aprovado`.
10. Caso contrario -> `exige_analise`.

## Seguranca

- Token E-POSI cacheado e renovado server-side (~4 min); nunca enviado ao frontend.
- Logs sempre com CNPJ mascarado; testes asseguram que CNPJ aberto nao vaza.
- Persistencia apenas resumo + metadados; payload bruto nao e armazenado.
- HTTP 200 com ErrorCode tratado como excecao operacional, nunca aprovacao.
- Falha de rede / timeout -> `indisponivel_temporariamente`.
- Rate limit por usuario.
- RBAC por endpoint e por campo tecnico.
- Auditoria com `correlation_id` em todas as etapas.
- Mock sempre marcado com `sourceIsMock: true`.

## Pontos parametrizados / pendentes Makfil

1. Credenciais E-POSI ainda nao confirmadas. Pendente validacao se o
   login web e o mesmo da API. Parametrizado em
   `MAKSCORE_EPOSI_LOGIN` / `MAKSCORE_EPOSI_PASSWORD`.
2. Dicionario oficial Makfil de ReasonCodes (atual e baseline genérico
   conforme manual; codigos desconhecidos sao aceitos com label = code).
3. Threshold `MAKSCORE_HIGH_TICKET_AMOUNT` (default 50.000) precisa
   validacao comercial.
4. Limitacoes desta fase:
   - repository in-memory
   - auth stub (headers x-user-id / x-user-role)
   - sem override humano (apenas estrutura `parecerManual` reservada)
   - sem integracao com proposta rapida ainda (apenas `proposalId` em auditoria)

## Como rodar

```
npm install
cp .env.example .env
npm run build
npm test
npm run dev      # ou npm start apos build
```

UI mobile-first em http://localhost:3000/makscore.

## Testes

- `tests/cnpj.test.ts` - validacao + masking
- `tests/normalizer.test.ts` - payload aninhado real, HTTP 200 + ErrorCode,
  apontamentos/protestos, compat com payload achatado
- `tests/policy.test.ts` - todos os outcomes, ticket alto, restritivos,
  score limites
- `tests/service.test.ts` - CNPJ invalido nao chama E-POSI, fallback
  seguro em falha externa, payload live `consultas: [product]`,
  CNPJ mascarado em auditoria, cache e force refresh

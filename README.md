# Hub de Vendas Makfil

Aplicacao backend do HUB de Vendas Makfil, iniciada pelo modulo isolado MakScore.

## Estrutura

```text
.
├── src/                         # Codigo-fonte da aplicacao
│   └── modules/makscore/        # Modulo MakScore isolado
├── public/                      # Assets estaticos servidos pela API
│   └── makscore/                # UI operacional atual do MakScore
├── tests/                       # Testes automatizados e test loader
├── deploy/                      # Arquivos auxiliares de deploy
│   └── nginx/                   # Configuracoes nginx/reverse proxy
├── docs/                        # Referencias de produto, design e assets
│   ├── assets/screenshots/      # Capturas usadas em analises de UI
│   └── design/claude-export/    # Exports de design do Claude
├── .planning/                   # Planejamento GSD e especificacoes do produto
├── Dockerfile                   # Build de imagem da API
├── docker-compose.yml           # Stack de deploy
├── package.json                 # Scripts e dependencias Node
└── tsconfig.json                # Configuracao TypeScript
```

## Comandos

```bash
npm install
npm run build
npm test
npm run dev
npm run auth:hash -- "SenhaForte123!"
```

## Seguranca

- Auth local com login em `/api/auth/login`, sessao assinada e cookie `httpOnly`.
- Senhas internas armazenadas com `argon2id`.
- Rate limit por IP, por usuario e por rota sensivel.
- Headers HTTP de endurecimento e CORS por allowlist (`AUTH_TRUSTED_ORIGINS`).
- Bootstrap de usuarios via `AUTH_BOOTSTRAP_ADMIN_*` ou `AUTH_USERS_JSON`.

## Convencoes

- `src/modules/*` deve concentrar codigo por modulo de produto.
- `docs/` guarda referencias e materiais de design, nao codigo de producao.
- `.planning/` guarda especificacoes e decisoes de produto.
- `dist/`, `node_modules/` e `.env` sao artefatos locais e nao devem ser versionados.
- Segredos da E-POSI ficam somente em variaveis de ambiente.

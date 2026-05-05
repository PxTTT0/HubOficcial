# ─── Stage 1: build ───────────────────────────────────────────────────────────
# Instala todas as deps (incluindo devDeps) e compila TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar manifests primeiro — preserva cache de camada se apenas o código mudar
COPY package*.json tsconfig.json ./
RUN npm ci

# Copiar código-fonte e compilar
COPY src/ ./src/
RUN npm run build

# ─── Stage 2: imagem de produção (enxuta) ─────────────────────────────────────
# Apenas runtime + prod deps; sem devDependencies (~40% menor)
FROM node:20-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

# Só prod dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Build compilado (TypeScript → JavaScript)
COPY --from=builder /app/dist ./dist

# Assets estáticos do servidor:
# dist/src/server.js resolve __dirname/../public => dist/public
# por isso copiamos public/ para dentro de dist/
COPY public/ ./dist/public/

# Executar como usuário sem privilégios (segurança)
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

# Health check: GET /api/makscore/health (endpoint real no routes.ts)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/makscore/health || exit 1

# Executar node diretamente — não usa npm start para não precisar de .env em disco
CMD ["node", "dist/src/server.js"]

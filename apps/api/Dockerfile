# syntax=docker/dockerfile:1
# Build a partir da RAIZ do monorepo:
#   docker build -f apps/api/Dockerfile -t wamux-api .

# ── base ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS base
# git é necessário para o Baileys (depende de `libsignal` via git).
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.4.0 --activate
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true

# ── deps: instala só o subtree da api (+ shared) ──────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
# patches/ precisa estar presente antes do install — pnpm-workspace.yaml referencia
# os .patch por caminho relativo (patchedDependencies: baileys, whatsapp-web.js).
COPY patches/ patches/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @wamux/api...

# ── builder: builda shared e depois a api ─────────────
FROM deps AS builder
COPY packages/config/ packages/config/
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
RUN pnpm --filter @wamux/shared build
RUN pnpm --filter @wamux/api build

# ── runner: imagem final (+ Chromium para o webjs) ────
FROM node:22-bookworm-slim AS runner
RUN corepack enable && corepack prepare pnpm@11.4.0 --activate
WORKDIR /app
ENV NODE_ENV=production
# Chromium para o provider whatsapp-web.js. Remova este bloco se não usar webjs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# pnpm usa o linker isolated (.pnpm store na raiz + symlinks por pacote).
# Precisamos do node_modules da RAIZ (store) E do de cada pacote do workspace
# (que tem os symlinks para o store). Sem os per-package, `require('reflect-metadata')`
# etc. não resolvem.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

EXPOSE 3000

# Readiness p/ orquestradores. Sem curl na base slim → usa o próprio Node.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]

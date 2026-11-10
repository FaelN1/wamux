# syntax=docker/dockerfile:1
# Build a partir da RAIZ do monorepo:
#   docker build -f apps/web/Dockerfile -t wamux-web .
#
# O Vite "bunda" o @wamux/shared no JS final, então a imagem de runtime (nginx)
# só precisa do dist estático — sem node_modules.

# ── build ─────────────────────────────────────────────
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.4.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
# patches/ precisa estar presente antes do install — pnpm-workspace.yaml referencia
# os .patch por caminho relativo (patchedDependencies: baileys, whatsapp-web.js).
COPY patches/ patches/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @wamux/web...
COPY packages/config/ packages/config/
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
RUN pnpm --filter @wamux/shared build
RUN pnpm --filter @wamux/web build

# ── serve (nginx) ─────────────────────────────────────
FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

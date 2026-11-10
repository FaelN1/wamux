# Deploy — Portainer

Stack pronta para subir o WAMux em um host com Docker, direto pelo Portainer,
usando as imagens publicadas (sem buildar nada no servidor).

## Pré-requisitos

- Portainer conectado ao host Docker.
- As imagens no registry: `faeln1/wamux-gateway`, `faeln1/wamux-web`,
  `faeln1/wamux-whatsmeow` (veja o push na raiz do projeto). Se os repositórios
  forem privados, cadastre o registry em **Registries** no Portainer.

## Passo a passo

1. **Stacks → Add stack**, nome `wamux`.
2. **Web editor**: cole o conteúdo de [`portainer-stack.yml`](portainer-stack.yml).
3. **Environment variables**: use os valores de
   [`portainer.env.example`](portainer.env.example). No mínimo defina:
   - `GLOBAL_API_KEY` — chave de admin (a stack não sobe sem ela).
   - `WHATSMEOW_MASTER_KEY` — chave interna do sidecar Go.
   - `PUBLIC_BASE_URL` e `WHATSMEOW_CALLBACK_BASE` — a URL pública real.
   - `DB_PASSWORD` / `RABBITMQ_PASS` — troque as senhas.
4. **Deploy the stack**.

Depois: painel em `http://SEU_HOST:8080`, API em `http://SEU_HOST:3000/api`,
docs OpenAPI em `/api/docs`. No painel, cole a `GLOBAL_API_KEY` para entrar.

## O que a stack faz de diferente do compose de dev

- **Só imagens** (sem `build:`) — o editor web do Portainer não tem o código.
- **`pg-init`**: um container one-shot cria o banco separado do whatsmeow
  (`WHATSMEOW_DB_NAME`, default `wamux`) se ele não existir. Substitui o script
  `docker/postgres/init` do compose de dev, que dependia de um arquivo no host.
- **Postgres e Redis não são expostos ao host** (só a rede interna). Publica
  apenas gateway, web e a UI do RabbitMQ.

## Persistência (volumes)

`pgdata`, `redisdata`, `whatsmeow_sessions`, `whatsmeow_logs`, `rabbitmqdata`,
`gateway_media`. As sessões do WhatsApp vivem no Postgres (Baileys/webjs) e nos
volumes do sidecar (whatsmeow) — sobrevivem a redeploy sem reparear.

## Notas de produção

- **TLS**: ponha um reverse proxy (Traefik, Nginx Proxy Manager, Caddy) na frente
  para HTTPS e aponte `PUBLIC_BASE_URL` para o domínio `https://`. Webhooks de
  entrada (Cloud API) e o callback do sidecar precisam de URL alcançável.
- **Atualizar versão**: mude `WAMUX_TAG` e faça *redeploy* (Pull image + redeploy).
- **`DB_SYNCHRONIZE=true`**: ainda não há migrations, então o schema é criado no
  boot. Mantenha `true` por enquanto; ao introduzir migrations, troque para `false`.
- **Arquitetura**: imagens são `amd64` (buildadas no Docker Desktop). Para hosts
  ARM, publique multiarch via a pipeline `release.yml` (buildx/QEMU).

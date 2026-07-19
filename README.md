<h1 align="center">🔀 WAMux</h1>

<p align="center">
  <b>A API de WhatsApp que fala todas as línguas.</b><br/>
  Uma única API REST para <b>Baileys</b>, <b>whatsapp-web.js</b>, <b>Cloud API oficial</b> e <b>whatsmeow</b> —
  você escolhe a engine <b>por instância</b>, sem mudar uma linha do seu código.
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e" />
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen" />
  <img alt="typescript" src="https://img.shields.io/badge/TypeScript-strict-3178c6" />
  <img alt="nestjs" src="https://img.shields.io/badge/NestJS-10-e0234e" />
  <img alt="api" src="https://img.shields.io/badge/API-OpenAPI%203-6ba539" />
  <img alt="docker" src="https://img.shields.io/badge/Docker-compose-2496ed" />
</p>

<p align="center">
  <a href="#-comece-em-2-minutos"><b>Comece em 2 min</b></a> ·
  <a href="#-o-que-o-wamux-faz"><b>Recursos</b></a> ·
  <a href="#-engines"><b>Engines</b></a> ·
  <a href="#-api"><b>API</b></a> ·
  <a href="ARCHITECTURE.md"><b>Arquitetura</b></a>
</p>

---

**WAMux** (WhatsApp Multiplexer) é uma **plataforma de WhatsApp self-hosted** para quem
precisa de escala e confiabilidade: uma API REST única, um formato de webhook único, e a
liberdade de escolher **qual engine roda cada conta**. Prototipe no Baileys, migre para o
whatsmeow **sem reparear o QR**, promova para a **Cloud API oficial** quando a carga ficar
crítica — tudo sem tocar no seu código de integração.

Sobe headless com um `docker compose up`: **sem licença, sem ativação manual, sem
telemetria obrigatória.**

```text
                    ┌─────────────── WAMux · API única ────────────────┐
 seu app  ──REST──▶ │  instâncias · mensagens · eventos · anti-ban     │
       ◀──eventos── │  Webhook · WebSocket · RabbitMQ                  │
                    └─────────────────────────┬────────────────────────┘
                                              │
            ┌─────────────────────┬───────────┴───────────┬─────────────────────┐
            ▼                     ▼                       ▼                     ▼
         Baileys           whatsapp-web.js            Cloud API             whatsmeow
       (WebSocket)           (Chromium)             (HTTP · Meta)         (sidecar Go)
```

## 💡 Por que WAMux

- 🔀 **Uma API, quatro engines.** Troque de biblioteca mudando **um campo** (`provider`).
  Seu código de integração nunca muda — e uma engine instável deixa de ser um problema de arquitetura.
- 🔁 **Migre de engine sem reparear.** Credenciais Multi-Device portáveis (Baileys ⇄ whatsmeow):
  mova uma conta de uma engine para outra mantendo o device linkado no celular.
- 🔓 **Self-hosted de verdade.** `docker compose up` e pronto — sem porteira de licença,
  ideal para CI/CD, Kubernetes e infraestrutura como código. Boot **não-bloqueante**: a API
  responde em segundos, mesmo com dezenas de sessões religando.
- 🛡️ **Confiável de fábrica.** Status de entrega rastreável, dedup de entrada, filas com
  retry + DLQ, circuit breaker por webhook, reconexão com backoff e camada **anti-ban**.
- 🏢 **Oficial e não-oficial, lado a lado.** Cloud API da Meta e engines não oficiais na
  mesma superfície, com a mesma autenticação e os mesmos webhooks.
- 🤖 **Pronto pra agentes de IA.** Servidor **MCP** embutido — Claude e outros agentes
  operam uma instância via protocolo MCP, autenticados com uma **API key de escopo
  restrito** (o agente só faz o que a key permite, nada além disso).

## ✨ O que o WAMux faz

### Mensagens

- Texto, **mídia rica** (imagem, vídeo, áudio, documento, sticker) por **URL ou base64** — com
  **GIF**, **voz (PTT)**, **vídeo-nota (PTV)** e **sticker animado**. Base64 grande vira stream (sem estourar memória).
- **Interativos**: enquetes (com **coleta e agregação de votos**), botões, listas e **botão PIX** —
  com _fallback_ automático para texto e resposta honesta (`422`) quando a engine não entrega.
- **Download de mídia recebida** (streaming ou base64) por endpoint dedicado.
- Storage de mídia plugável: **disco local** por padrão, ou bucket **S3-compatível** (AWS S3,
  MinIO, DigitalOcean Spaces) — configurável por env, com fallback automático pro local.

### Grupos, comunidades & canais

- **Grupos**: CRUD completo — criar, metadados, participantes (adicionar/remover/promover/
  rebaixar), assunto, descrição, configurações (announce/locked), convite (gerar/revogar),
  entrar por link, sair.
- **Comunidades** (grupo-pai + subgrupos vinculados): CRUD completo — nome, descrição,
  imagem, admins, membros agregados, convite, vincular/desvincular grupo, publicar no grupo
  de anúncios (com fanout opcional) e ressincronizar.
- **Canais (Newsletter)**: CRUD completo (criar, seguir/deixar de seguir, metadados) e envio
  de **texto, mídia e enquete**.
- **Perfil**: nome e foto da própria conta conectada, e foto de perfil de **qualquer contato,
  grupo ou comunidade**.

### Inbox — conversas persistidas

- Tela de **conversas, contatos e mensagens** persistidos no Postgres (opt-in via flags de
  env) — sobrevive a restart, independe de sessão ao vivo.
- **Tempo real** via WebSocket, mídia renderizando na própria thread (imagem, vídeo, **áudio
  que toca de verdade**, documento) e composer com anexo (arquivo + preview + progresso).

### Observabilidade — painel de Logs/Atividade

- Auditoria **cross-instância** de tudo que passa pela API: busca, tempo real, histograma de
  eventos, filtros (status, tipo, rota, conta, plataforma) e export.

### API keys com escopo & servidor MCP

- Além da key mestra por instância, crie **keys com escopo restrito**
  (`read`/`send`/`control`/`setting`/`app`/`delete`) — pra dar acesso de terceiro (bot,
  agência, agente de IA) sem expor a key mestra. Uma key nunca concede a outra uma ação que
  ela mesma não tem.
- **Servidor MCP embutido** (`/instances/:id/mcp`): agentes de IA compatíveis com o
  protocolo (Claude, etc.) leem chats/contatos e enviam mensagem, autenticados com uma key
  escopada — cada chamada aparece automaticamente no painel de Logs.

### Confiabilidade

- **Status de entrega** rastreável ponta a ponta (`pending → server_ack → delivered → read`)
  com timestamp por transição — consultável por mensagem.
- **Idempotência** por `clientMessageId`, **fila de saída** com pacing por instância, **retry + DLQ**
  reprocessável, **dedup de entrada** (nada some em silêncio) e **circuit breaker** por webhook.
- Eventos de **edição, reação e exclusão** de mensagem, normalizados.

### Eventos — 3 transportes, filtráveis por evento

- **Webhook** (HTTP, **assinado com HMAC-SHA256** + anti-replay), **WebSocket** (push em tempo real)
  e **RabbitMQ** (publica no broker). Escolha por instância quais eventos recebe em cada canal.

### Conexão

- QR com **TTL e proteção contra loop**, **código de pareamento** (8 dígitos, alternativo ao QR),
  **reconexão automática** com backoff + jitter e classificação de causa, e estado de **Passkey**.
- Sessão persistida em Postgres → **restart não repareia** contas saudáveis.

### Segurança & Anti-ban

- **Whitelist/blacklist de JIDs** (entrada e/ou saída), **auth por instância à prova de bypass**,
  segredo de webhook rotacionável.
- **Perfis de risco** (conservador/normal/agressivo) com **warmup** de conta nova, **auto-throttle**
  por sinais de risco e **checagem de número protegida** (teto + cache + rate-limit).

### Contatos & identidade

- Bloquear/desbloquear, **presença** ("digitando…"), marcar como lido, buscar mensagens
  paginadas, **etiquetas** (WhatsApp Business) e resolução de identidade **@lid ↔ número**.

### Histórico & operação

- **Import de histórico** por intervalo de data (assíncrono, com progresso e cancelamento).
- **Documentação OpenAPI/Swagger** viva, **painel web** e **Playground** de API embutido.

## 🔌 Engines

| `provider`  | Tipo        | Runtime                     | QR? | Oficial? |
| ----------- | ----------- | --------------------------- | --- | -------- |
| `baileys`   | não oficial | Node (WebSocket)            | ✅  | ❌       |
| `webjs`     | não oficial | Node + Chromium (Puppeteer) | ✅  | ❌       |
| `cloud`     | **oficial** | HTTP (Meta Graph API)       | ❌  | ✅       |
| `whatsmeow` | não oficial | **sidecar Go**              | ✅  | ❌       |

Cada instância declara suas **capabilities** (`GET /instances/:id/capabilities`) — o recurso que a
engine não entrega responde de forma uniforme (`501`), nunca com erro genérico. Recorte das
capabilities mais pedidas:

| Recurso                                        | `baileys` | `webjs`  | `cloud` | `whatsmeow` |
| ---------------------------------------------- | :-------: | :------: | :-----: | :---------: |
| Mensagens (texto/mídia/interativos)            |    ✅     |    ✅    |   ✅    |     ✅      |
| Grupos                                         |    ✅     |    ✅    |   ❌    |     ✅      |
| Comunidades                                    |    ✅     | ❌ `501` |   ❌    |     ✅      |
| Canais (Newsletter)                            |    ✅     |    ✅    |   ❌    |     ✅      |
| Perfil (conta própria + foto de contato/grupo) |    ✅     |    ✅    |   ❌    |     ✅      |

> ⚠️ **Aviso.** Baileys, whatsapp-web.js e whatsmeow são **não oficiais** e violam os Termos do
> WhatsApp — há risco de banimento. Apenas a **Cloud API** é oficial. Use com responsabilidade e
> prefira a Cloud API para cargas críticas.

## 🎯 Casos de uso

- **Atendimento multi-atendente** — receba e responda por webhook/WebSocket, com status de entrega e leitura.
- **Chatbots e automações** — plugue em n8n, filas ou seu backend via eventos unificados.
- **Agentes de IA** — conecte Claude (ou outro agente MCP) direto na instância, com uma key
  de escopo restrito controlando exatamente o que ele pode fazer.
- **Notificações transacionais** — dispare em escala com anti-ban, idempotência e status rastreável.
- **Consolidação de fornecedores** — coloque contas oficiais e não oficiais numa API só, sem reescrever nada.

## 🚀 Comece em 2 minutos

```bash
cp .env.example .env        # ajuste chaves/secrets
docker compose up --build
```

| Serviço               | URL                                |
| --------------------- | ---------------------------------- |
| 🖥️ **Painel**         | <http://localhost:8080>            |
| 🔌 **API**            | <http://localhost:3000/api/v1>     |
| 📖 **Docs (Swagger)** | <http://localhost:3000/api/docs>   |
| ❤️ **Health**         | <http://localhost:3000/api/health> |
| 🐰 RabbitMQ (gestão)  | <http://localhost:15672>           |

Sobe `gateway` (Node), `web` (painel React), `postgres`, `redis`, `rabbitmq` e o sidecar `whatsmeow` (Go).
No painel, cole a `GLOBAL_API_KEY` do `.env` e crie sua primeira instância.

## 🧪 Uso

```bash
GLOBAL=dev-global-key-change-me
API=http://localhost:3000/api/v1

# 1) criar instância escolhendo a engine  → guarde o apiKey retornado
curl -X POST $API/instances \
  -H "apikey: $GLOBAL" -H "Content-Type: application/json" \
  -d '{ "name": "vendas-01", "provider": "baileys" }'

# 2) conectar e ler o QR
curl -X POST $API/instances/<id>/connect -H "apikey: <apiKey>"
curl $API/instances/<id>/qr -H "apikey: <apiKey>"          # { qr, qrImage }

# 3) enviar (com idempotência opcional)
curl -X POST $API/messages/<id>/text \
  -H "apikey: <apiKey>" -H "Content-Type: application/json" \
  -d '{ "to": "5511999999999", "text": "Olá do WAMux!", "clientMessageId": "abc-1" }'

# 4) acompanhar a entrega
curl $API/messages/<id>/status/<messageId> -H "apikey: <apiKey>"
```

**Cloud API oficial** é só trocar o `provider` na criação:

```json
{
  "name": "oficial-01",
  "provider": "cloud",
  "config": { "phoneNumberId": "...", "accessToken": "..." }
}
```

**Migrar de engine sem reparear** (mantém o device linkado):

```bash
curl -X POST $API/instances/<id>/provider \
  -H "apikey: <apiKey>" -H "Content-Type: application/json" \
  -d '{ "provider": "whatsmeow", "migrate": true }'
```

## 📚 API

Autenticação por header `apikey`: a **GLOBAL_API_KEY** (admin), a **apiKey mestra da
instância** (acesso total) ou uma **key com escopo restrito** (`read`/`send`/`control`/
`setting`/`app`/`delete` — ver seção de API keys abaixo). A superfície completa (com
schemas e exemplos) fica no **Swagger em `/api/docs`**. Um recorte:

| Área                    | Exemplos                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Instâncias**          | `POST /instances` · `GET /instances/:id` · `POST /:id/connect` · `GET /:id/qr` · `POST /:id/pair-code` · `POST /:id/provider` · `GET /:id/capabilities` |
| **Mensagens**           | `POST /messages/:id/text` · `/media` · `/poll` · `/buttons` · `/list` · `/pix` · `GET /:id/status/:messageId`                                           |
| **Grupos**              | `GET/POST /instances/:id/groups` · `/:jid/participants` · `/:jid/subject` · `/:jid/invite`                                                              |
| **Comunidades**         | `GET/POST /instances/:id/communities` · `/:jid/admins` · `/:jid/groups` · `/:jid/announcement`                                                          |
| **Canais (Newsletter)** | `GET/POST /instances/:id/newsletters` · `/:jid/follow` · `/:jid/message`                                                                                |
| **Perfil**              | `GET /instances/:id/profile` (conta própria)                                                                                                            |
| **Eventos**             | `PUT /instances/:id/events` (webhook · websocket · rabbitmq, por evento) · `PUT /:id/webhook`                                                           |
| **Segurança**           | `PUT /instances/:id/filters` (whitelist/blacklist JID) · webhook HMAC · `GET /:id/webhook/dlq`                                                          |
| **API keys & MCP**      | `POST/GET/DELETE /instances/:id/api-keys` · `POST /:id/mcp` (protocolo MCP)                                                                             |
| **Anti-ban**            | `PUT /instances/:id/anti-ban` · `GET /:id/anti-ban/status`                                                                                              |
| **Contatos**            | `POST /:id/contacts/:jid/block` · `/presence` · `/numbers/check` · `GET /:id/chats/:jid/messages`                                                       |
| **Etiquetas**           | `GET/POST /instances/:id/labels` · `PUT /:labelId/associations`                                                                                         |
| **Identidade**          | `GET /instances/:id/identity/resolve` · `PUT /:id/settings`                                                                                             |
| **Inbox**               | `GET /instances/:id/chats` · `/chats/:jid/messages/db` · `/contacts` (conversas persistidas)                                                            |
| **Logs / Atividade**    | `GET /activity-logs` · `/facets` · `/histogram` · `/export` (escopo admin)                                                                              |
| **Histórico**           | `POST /instances/:id/history/import` · `GET /:id/history/import/:jobId`                                                                                 |
| **Mídia**               | `GET /messages/:id/media/:messageId` (download streaming/base64)                                                                                        |
| **Sistema**             | `GET /api/health` · `GET /api/docs` · webhooks de entrada `/api/webhooks/{cloud,whatsmeow}/:id`                                                         |

> Rotas de negócio ficam em `/api/v1/*`; `health` e webhooks de entrada são **version-neutral**
> (`/api/health`, `/api/webhooks/...`).

## 🖥️ Painel & Playground

Um **painel web** (React + shadcn/ui) acompanha o gateway: crie instâncias, leia o QR, configure
os transportes de eventos, defina o anti-ban, gerencie **API keys escopadas e apps MCP**, e
acompanhe o status ao vivo. O **Inbox** traz a lista de conversas persistidas com thread e
mídia renderizando (áudio tocando de verdade); o **painel de Logs** dá observabilidade
cross-instância em tempo real. O **Playground** embutido dispara qualquer endpoint direto do
navegador (com a instância já selecionada, preview de QR e cURL gerado) — ideal para testar
antes de integrar.

## 🧱 Stack

**Monorepo pnpm + Turborepo.** NestJS 10 · React (Vite + shadcn/ui) · TypeScript · PostgreSQL ·
Redis · BullMQ · RabbitMQ · Docker Compose. O provider `whatsmeow` roda como **sidecar Go**.

```text
apps/
  api/        gateway NestJS (@wamux/api)
  web/        painel React/shadcn (@wamux/web)
packages/
  shared/     tipos/enums canônicos (@wamux/shared) — usado por api E web
  config/     presets tsconfig/eslint/prettier (@wamux/config)
services/
  whatsmeow/  sidecar Go (fora do pipeline turbo, buildado por Docker)
```

Comandos: `pnpm dev` (tudo em watch) · `pnpm build` (turbo) · `pnpm lint` · `pnpm type-check`.

## 🏗️ Arquitetura

Veja **[ARCHITECTURE.md](ARCHITECTURE.md)** — padrão adapter + modelo canônico (nada fora dos
adapters conhece a lib da engine), registry distribuído para conexões stateful, e o fluxo de
mensagens (entrada → dedup → filtro → mídia → fan-out; saída → anti-ban → idempotência → fila).

## 🤝 Contribuindo

PRs e issues são bem-vindos. Antes de começar, dê uma olhada em [`ARCHITECTURE.md`](ARCHITECTURE.md).
Commits seguem [Conventional Commits](https://www.conventionalcommits.org/).

## 📄 Licença

[MIT](LICENSE) — use, modifique e distribua livremente.

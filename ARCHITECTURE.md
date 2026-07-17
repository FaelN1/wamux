# Arquitetura

## Objetivo

Uma API única que conecta contas de WhatsApp por diferentes bibliotecas,
escolhidas **por instância**, com a mesma superfície pública (REST + webhooks)
independentemente do provider por trás.

## Princípio central: Adapter + modelo canônico

Cada lib fala um "dialeto". Definimos **um modelo normalizado**
([`provider.types.ts`](apps/api/src/providers/provider.types.ts)) e um contrato
([`WhatsAppProvider`](apps/api/src/providers/provider.interface.ts)). Cada lib é um
adapter que traduz do seu dialeto para o canônico. Nada fora de
`apps/api/src/providers/*` conhece Baileys/webjs/Cloud/whatsmeow.

Recursos opcionais (etiquetas, grupos, canais/newsletter, **comunidades**) são
declarados em `ProviderCapabilities` e checados pelo serviço REST correspondente
(`groups/`, `newsletter/`, `communities/`) antes de chamar o método opcional do
provider — engine sem suporte responde **501** de forma uniforme, nunca 500.
Comunidades (grupo-pai + subgrupos vinculados) têm adapter em `baileys` (nativo,
socket `w:g2`) e `whatsmeow` (via CRUD nativo do sidecar Go, `/community`);
`webjs` fica 501 de propósito — a lib não tem API de Community (tentativa dos
mantenedores abandonada) — e `cloud` (Meta) também 501 (fora do escopo da Cloud
API oficial). Cada engine tem lacunas pontuais documentadas nos adapters e em
`docs/community-contract-handoff.md`.

```
             ┌───────────────── WhatsAppProvider (contrato) ─────────────────┐
             │ initialize · getQRCode · sendText · sendMedia · logout ·      │
             │ destroy · handleInboundWebhook · on(event)                    │
             └───────────────────────────────────────────────────────────────┘
                  ▲            ▲                ▲                  ▲
           BaileysProvider WebjsProvider  CloudApiProvider  WhatsmeowProvider
           (socket WS)   (Chromium)      (HTTP Meta)      (HTTP → sidecar Go)
```

## O desafio de robustez: conexões stateful

Providers não oficiais mantêm **sockets long-lived**. O socket da instância X
vive num processo (worker) específico — não dá para tratar como stateless e
balancear cada request. Solução:

- **[InstanceRegistryService](apps/api/src/providers/instance-registry.service.ts)**
  (Redis): mapeia `instância → worker` com posse por TTL renovada por
  heartbeat. `SET NX` evita corrida entre workers.
- **[InstanceManagerService](apps/api/src/instance/instance-manager.service.ts)**: mantém
  em memória os providers vivos **deste** worker, liga eventos → webhooks,
  religa instâncias ativas no boot e desconecta limpo no shutdown.
- Worker morre → posse expira → outro worker assume e **reconecta** a partir das
  credenciais persistidas (nenhuma sessão é perdida em deploy/restart).

> No MVP (1 processo) tudo roda junto; a mesma abstração escala para N workers
> só configurando `WORKER_ID` distinto por réplica e um roteador sticky à frente.

## Fluxo de uma mensagem

**Saída** (`POST /messages/:id/text`):
`MessagingService` → `InstanceManager.requireLive(id)` → provider.sendText → lib.

**Entrada:**

- Baileys/webjs: chega no socket → adapter normaliza → `emit('message')` →
  `InstanceManager` → `WebhookService.dispatch` → **fila BullMQ** →
  `WebhookProcessor` entrega no webhook do cliente (retry/backoff/DLQ).
- Cloud/whatsmeow: chega por HTTP em `/webhooks/{cloud,whatsmeow}/:id` →
  `provider.handleInboundWebhook` normaliza → mesmo caminho acima.

## Persistência

| Dado                        | Onde         | Entidade                 |
| --------------------------- | ------------ | ------------------------ |
| Metadados da instância      | Postgres     | `InstanceEntity`         |
| Credenciais de auth/sessão  | Postgres     | `SessionEntity`          |
| Log de mensagens (opcional) | Postgres     | `MessageLogEntity`       |
| Posse instância→worker      | Redis        | (chaves `wa:registry:*`) |
| Filas de webhook            | Redis/BullMQ | —                        |

O [`SessionService`](apps/api/src/session/session.service.ts) implementa `SessionStore`,
usado pelos adapters (ex.: [auth do Baileys](apps/api/src/providers/baileys/baileys-auth-state.ts))
para persistir/restaurar a sessão — é o que evita reparear o QR a cada restart.

## Robustez — checklist

- [x] Persistência de sessão → sobrevive a restart/deploy.
- [x] Registry distribuído + heartbeat + reatribuição de órfãs.
- [x] Filas com retry exponencial + DLQ para webhooks.
- [x] Reconexão automática (Baileys/webjs).
- [x] Graceful shutdown (desconecta sem deslogar, libera registry).
- [x] Guards de API key (global admin + por instância).
- [x] Health check (Postgres + Redis) e logs estruturados (pino).
- [x] Rate-limit de envio por instância (token bucket + fila outbound) — `throttle/`.
- [x] Idempotência de envio (dedup por `clientMessageId`) — `throttle/idempotency.service.ts`.
- [ ] Roteador sticky multi-worker à frente do gateway — quando escalar.
- [ ] Métricas Prometheus + tracing.

## Layout

```
apps/api/src/
  providers/            # núcleo: contrato + adapters + factory + registry
    baileys/  webjs/  cloud/  whatsmeow/
  instance/             # CRUD + motor de runtime (manager) + webhooks inbound
  groups/  newsletter/  communities/  # feature modules capability-gated (ver acima)
  messaging/            # envio (fachada + fila outbound BullMQ)
  throttle/             # rate-limit (token bucket) + idempotência
  webhook/              # entrega outbound (BullMQ)
  events/               # transportes "stream": WebSocket + RabbitMQ
  settings/             # settings globais (editáveis pelo painel)
  session/              # SessionStore sobre Postgres
  redis/  database/  config/  common/  health/
apps/web/               # painel React/Vite/shadcn (@wamux/web)
packages/shared/        # tipos/enums/zod canônicos (@wamux/shared)
services/whatsmeow/     # sidecar Go (Fiber + whatsmeow) — ver CLAUDE.md de lá
```

## Próximos passos sugeridos

1. Fila **outbound** por instância (rate-limit + idempotência).
2. Completar Cloud API (upload de mídia base64, mapeamento de status/ack).
3. `webjs`: `RemoteAuth` com Store no `SessionStore`.
4. `whatsmeow`: ✅ integrado ao serviço Go próprio (`wamux_go`, em
   `services/whatsmeow/`) — o adapter auto-provisiona a instância e configura o
   webhook de retorno. Fonte da verdade do whatsmeow é o serviço Go; o gateway
   só federa/normaliza (sem dupla gestão de instância/fila/webhook).
5. Migrations do TypeORM (`DB_SYNCHRONIZE=false` em produção).
6. Roteamento sticky multi-worker + métricas.

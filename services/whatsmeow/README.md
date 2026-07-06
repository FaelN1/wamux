# whatsmeow-service (sidecar Go)

Este é o serviço Go `wamux_go` (whatsmeow) do monorepo. Ele é o provider
`whatsmeow` do gateway.

O whatsmeow é uma lib **Go** — não roda no processo Node. O gateway fala com
este serviço por HTTP (ver [`whatsmeow.provider.ts`](../src/providers/whatsmeow/whatsmeow.provider.ts)).

## Como o gateway se integra a ele

O adapter age como **pass-through fino** — o serviço Go continua sendo a fonte
da verdade do whatsmeow (com proxy, grupos, fila, etc.):

1. **Provisionamento (automático):** ao conectar uma instância `whatsmeow` pela
   primeira vez, o adapter chama `POST /api/v1/instance/` (com a
   `MASTER_API_KEY`), guarda o `api_key` retornado no `SessionStore` do gateway
   e aponta o `webhook_url` da instância Go de volta para
   `…/api/webhooks/whatsmeow/:id` do gateway.
2. **Envio:** o adapter chama `/api/v1/message/text` e `/message/media` com o
   `X-API-Key` da instância.
3. **Recebimento:** o serviço Go entrega os eventos
   (`MESSAGE` / `CONNECTION_STATUS` / `MESSAGE_STATUS`) no webhook do gateway,
   que normaliza para o modelo canônico e repassa ao cliente final.

> Não há dupla gestão: o gateway **não** reimplementa instância/fila/webhook do
> whatsmeow — ele delega ao serviço Go e só federa/normaliza.

## Rodando

Via `docker compose up` na raiz do monorepo (recomendado): o serviço sobe como
`whatsmeow`, com banco próprio `wamux` no mesmo Postgres. Docs da API
em `http://localhost:8081/docs` (o painel administrativo foi removido — a UI
fica no WAMux).

## Configuração — sem `.env` próprio

Este sidecar **não tem `.env` próprio**: ele compartilha o `.env` do WAMux (na
raiz). O `docker-compose.yml` da raiz injeta as variáveis dele no bloco
`environment:` do serviço `whatsmeow`, derivando do `.env` único:

| Var do serviço Go       | De onde vem (root `.env` / compose)                     |
| ----------------------- | ------------------------------------------------------- |
| `DATABASE_URL`          | montada de `DB_USER`/`DB_PASSWORD` + `WHATSMEOW_DB_NAME` |
| `MASTER_API_KEY`        | `WHATSMEOW_MASTER_KEY` (a mesma que o gateway usa)      |
| `WHATSMEOW_SESSION_DIR` | fixa no compose (`/app/sessions`, volume)               |
| `WEBSHARE_API_KEY`      | `WHATSMEOW_WEBSHARE_API_KEY` (opcional, proxies)        |
| `SENTRY_DSN`            | `WHATSMEOW_SENTRY_DSN` (opcional)                       |

> Para rodar o serviço Go **standalone** (fora do compose, `go run`), exporte
> essas vars direto no ambiente — não recrie um `.env` aqui.

## Atenção

- O `media_base64` que este serviço inclui no webhook (mídia baixada e
  codificada) é conveniente, mas pesa em volume. O adapter do gateway mantém o
  base64 apenas no campo `raw` do evento, não no payload canônico.
- Este serviço mantém a conexão viva mesmo quando o gateway reinicia — o
  `destroy()` do adapter **não** derruba o serviço Go.

Os endpoints completos (chat, grupos, perfil, broadcast, etc.) estão
documentados na API em `http://localhost:8081/docs`.

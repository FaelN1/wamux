# WhatsApp Flows no WAMux

Flows são formulários/telas que abrem dentro do chat. A **gestão** (criar, publicar, enviar,
endpoint criptografado) existe só na engine `cloud` (API oficial da Meta) — nas demais as rotas
respondem **501**. A **resposta** de um Flow é normalizada em qualquer engine que a receba
(`cloud`, `baileys`, `whatsmeow`).

Três versões diferentes entram em jogo — não confunda:

| Versão                        | Onde fica                                      | Quem controla                |
| ----------------------------- | ---------------------------------------------- | ---------------------------- |
| Graph API (`vNN.0`)           | `CLOUD_API_VERSION` / `config.cloudApiVersion` | o gateway (URL das chamadas) |
| Flow JSON (`"version"`)       | dentro do seu `flow.json`                      | você, ao escrever o Flow     |
| Data API (`data_api_version`) | dentro do seu `flow.json`                      | você (só Flows com endpoint) |

`GET /instances/:id/flows/:flowId` devolve `json_version` e `data_api_version` do Flow.

Consultado em 2026-11-10: Graph API **v26.0** (default do gateway); Flow JSON recomendado **7.3**
(7.2–7.0, 6.3–6.1 e 5.1 ainda publicáveis; ≤5.0 congeladas — não publicam mais); Data API **4.0**
recomendada, 3.0 suportada. Versões congeladas continuam enviáveis até expirarem; a Meta avisa
pelo evento `flow.status_update` (`FLOW_VERSION_EXPIRY_WARNING`).

## Pré-requisitos (instância `cloud`)

`config` da instância: `phoneNumberId`, `accessToken`, `wabaId` (gestão de Flows usa a WABA) e,
opcionalmente, `managementToken`, `appSecret`, `verifyToken`. Permissões do token:
`whatsapp_business_messaging` (envio) e `whatsapp_business_management` (gestão).

Todas as rotas abaixo ficam em `/api/v1/instances/:id/flows` e usam o header `apikey`.

## 1. Ciclo de vida

| Operação                                                                  | Rota                      | Escopo    |
| ------------------------------------------------------------------------- | ------------------------- | --------- |
| Listar (paginado na Meta)                                                 | `GET /`                   | `read`    |
| Criar (aceita `flow_json`, `clone_flow_id`, `endpoint_uri`, `publish`)    | `POST /`                  | `setting` |
| Detalhar (`validation_errors`, `preview`, `health_status`, versões)       | `GET /:flowId`            | `read`    |
| Atualizar metadados (só DRAFT)                                            | `PATCH /:flowId`          | `setting` |
| Enviar/atualizar o Flow JSON (só DRAFT)                                   | `POST /:flowId/assets`    | `setting` |
| Baixar o Flow JSON vigente                                                | `GET /:flowId/assets`     | `read`    |
| Publicar                                                                  | `POST /:flowId/publish`   | `setting` |
| Depreciar                                                                 | `POST /:flowId/deprecate` | `setting` |
| Apagar (só DRAFT)                                                         | `DELETE /:flowId`         | `delete`  |
| Métricas — **410**: a Meta descontinuou a Flows Metrics API em 2026-04-30 | `GET /:flowId/metrics`    | `read`    |

Estados: `DRAFT` → `PUBLISHED` → `DEPRECATED` (a Meta também pode marcar `THROTTLED`/`BLOCKED`
por saúde do endpoint). **Flow publicado é imutável**: para mudar, crie outro com
`clone_flow_id` e publique o clone. Só `DRAFT` pode ser apagado.

```bash
# criar já com o JSON — a resposta traz os erros de validação da Meta
curl -X POST $API/instances/$ID/flows -H "apikey: $KEY" -H 'content-type: application/json' -d '{
  "name": "agendamento",
  "categories": ["APPOINTMENT_BOOKING"],
  "flow_json": "{\"version\":\"7.3\",\"screens\":[ ... ]}"
}'
# → { "id": "123456", "validation_errors": [ { "error": "INVALID_PROPERTY", "message": "...", "line_start": 4, ... } ] }
```

Erros da Graph API (JSON inválido, Flow já publicado, permissão ausente…) **não viram mais 500**:
o gateway devolve o status e o diagnóstico da Meta:

```json
{
  "statusCode": 400,
  "error": {
    "message": "Flow can't be updated because it is published",
    "code": 139001,
    "provider": "cloud",
    "details": { "upstreamStatus": 400, "error_subcode": 4233020, "fbtrace_id": "A1b2..." }
  }
}
```

## 2. Enviar um Flow

```bash
curl -X POST $API/instances/$ID/flows/send -H "apikey: $KEY" -H 'content-type: application/json' -d '{
  "to": "5511999999999",
  "flowId": "123456",
  "cta": "Agendar",
  "body": "Escolha o melhor horário.",
  "screen": "AGENDA",
  "data": { "nome": "Maria" },
  "mode": "published"
}'
# → { "id": "wamid.HBg...", "to": "5511999999999", "status": "sent", "flowToken": "6f1c…" }
```

- Exatamente um de `flowId` / `flowName`.
- `action`: `navigate` (default — exige `screen`; `data` opcional e não vazio) ou `data_exchange`
  (a primeira tela vem do seu endpoint, via `INIT`).
- `mode: "draft"` envia o rascunho (para testes).
- `flowToken` é a chave de correlação da execução. Se você não mandar, o gateway gera um UUID e o
  devolve. Use **um token por envio**.
- Flow dentro de **template**: use `POST /instances/:id/templates/send` com o botão
  `sub_type: "flow"` nos `components` (o `flow_token` vai em `parameters[].action`).

## 3. Receber a resposta

Quando o usuário conclui o Flow chegam dois eventos:

1. `message.received` normal, com `type: "interactive"` e o campo novo `flowResponse`;
2. `flow.response` — o evento dedicado, já correlacionado com o envio:

```json
{
  "event": "flow.response",
  "data": {
    "provider": "cloud",
    "instanceId": "…",
    "messageId": "wamid.resposta",
    "chatId": "5511999999999",
    "from": "5511999999999",
    "timestamp": 1762790000,
    "flowToken": "6f1c…",
    "name": "flow",
    "data": { "flow_token": "6f1c…", "dia": "2026-11-12", "horario": "14:00" },
    "flowId": "123456",
    "flowName": null,
    "sentMessageId": "wamid.HBg..."
  }
}
```

`flowId`/`sentMessageId` vêm `null` quando o Flow não foi enviado por este gateway (ex.: pelo
painel da Meta). Reentregas do webhook da Meta não duplicam o evento (dedup de entrada).

### Sessões (correlação persistida)

Cada envio abre uma linha em `flow_sessions`, atualizada a cada chamada ao endpoint e fechada na
resposta:

```bash
curl "$API/instances/$ID/flows/sessions?status=completed&limit=20" -H "apikey: $KEY"
curl "$API/instances/$ID/flows/sessions/6f1c…" -H "apikey: $KEY"
```

```json
{
  "flowToken": "6f1c…",
  "flowId": "123456",
  "contact": "5511999999999",
  "messageId": "wamid.HBg...",
  "status": "completed",
  "lastAction": "data_exchange",
  "lastScreen": "AGENDA",
  "exchanges": 2,
  "response": { "flow_token": "6f1c…", "dia": "2026-11-12" },
  "responseMessageId": "wamid.resposta",
  "completedAt": "2026-11-10T18:00:00.000Z"
}
```

`status`: `sent` → `in_progress` (endpoint chamado) → `completed` | `failed` (erro reportado pelo
app do usuário ou pelo seu serviço). `FLOWS_SAVE_RESPONSE_DATA=false` deixa de gravar `response`
(dado pessoal) e mantém só a correlação; `FLOWS_SESSION_RETENTION_DAYS` expurga sessões antigas.

## 4. Flows com endpoint (troca de dados)

Flows dinâmicos chamam um endpoint a cada tela, com payload cifrado. O gateway faz **toda a parte
de protocolo** (assinatura, RSA/AES, health check, notificação de erro) e repassa ao seu serviço o
JSON já decifrado.

```
WhatsApp ──cifrado──▶ POST {PUBLIC_BASE_URL}/api/webhooks/flows/:id ──JSON──▶ seu serviço
         ◀─cifrado──                (gateway)                       ◀─JSON──
```

### Passo a passo

```bash
# 1) gerar o par de chaves e registrar a pública na Meta (a privada fica só no gateway)
curl -X PUT $API/instances/$ID/flows/encryption -H "apikey: $KEY" -H 'content-type: application/json' -d '{}'
#    → { "business_public_key": "-----BEGIN PUBLIC KEY-----…", "business_public_key_signature_status": "VALID", "hasPrivateKey": true }
#    (para usar a sua chave: { "privateKey": "-----BEGIN PRIVATE KEY-----…", "passphrase": "…" })

# 2) dizer ao gateway qual é o SEU serviço
curl -X PUT $API/instances/$ID/flows/endpoint -H "apikey: $KEY" -H 'content-type: application/json' \
  -d '{ "url": "https://meu-app.com/whatsapp/flow" }'
#    → { "url": "https://meu-app.com/whatsapp/flow", "endpointUri": "https://gateway.exemplo.com/api/webhooks/flows/<id>" }

# 3) registrar o endpointUri no Flow (na criação ou depois, em DRAFT)
curl -X PATCH $API/instances/$ID/flows/123456 -H "apikey: $KEY" -H 'content-type: application/json' \
  -d '{ "endpoint_uri": "https://gateway.exemplo.com/api/webhooks/flows/<id>" }'
```

`endpointUri` depende de `PUBLIC_BASE_URL` (HTTPS público). No painel da Meta o app conectado ao
endpoint precisa estar associado ao Flow (`application_id` no `PATCH`, quando necessário).

### O que o seu serviço recebe e responde

`POST` com `Content-Type: application/json` (e `X-WAMux-Signature`, se a instância tiver webhook
secret — mesmo esquema dos webhooks):

```json
{
  "instanceId": "…",
  "version": "3.0",
  "action": "data_exchange",
  "screen": "AGENDA",
  "data": { "dia": "2026-11-12" },
  "flowToken": "6f1c…"
}
```

Com Flow JSON ≥ 7.3 e Data API ≥ 4.0 a Meta envia também `flow_token_signature` (JWT HS256
assinado com o app secret), repassado como `flowTokenSignature` para você validar se quiser.

`action` é `INIT` (abertura com `flow_action: data_exchange`), `BACK` (voltar, quando a tela usa
`refresh_on_back`) ou `data_exchange` (envio de tela). Responda **HTTP 200** com o corpo da Data
API em JSON puro — o gateway cifra:

```json
{ "screen": "CONFIRMA", "data": { "resumo": "12/11 às 14:00" } }
```

Para encerrar o Flow com sucesso:

```json
{
  "screen": "SUCCESS",
  "data": {
    "extension_message_response": { "params": { "flow_token": "6f1c…", "protocolo": "A-991" } }
  }
}
```

Para invalidar a sessão (token expirado/já usado), responda **HTTP 427** com
`{ "error_msg": "Sessão expirada, peça um novo link." }`.

O gateway responde sozinho — sem chamar o seu serviço — ao `ping` (health check da Meta) e às
notificações de erro do app do usuário (que ficam em `session.error` e marcam a sessão `failed`).

### Códigos devolvidos à Meta

| Situação                                                                                    | HTTP                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Resposta normal (corpo cifrado, base64, `text/plain`)                                       | 200                                                   |
| Não foi possível decifrar / sem chave privada                                               | 421 (o app recarrega a chave pública e tenta de novo) |
| `flow_token` inválido (seu serviço respondeu 427)                                           | 427                                                   |
| `X-Hub-Signature-256` inválido (com `appSecret`)                                            | 432                                                   |
| Seu serviço fora do ar, lento (> `FLOWS_DATA_EXCHANGE_TIMEOUT_MS`) ou sem `url` configurada | 500                                                   |

Não há retry do gateway para o seu serviço: a Meta dá 10 s por chamada e ela mesma repete. Trate
`flowToken` + `screen` como chave de idempotência do seu lado.

### Segurança

- A chave privada fica na tabela de sessões do gateway, por instância, e **nunca** é devolvida por
  API. Trocar a chave (`PUT flows/encryption`) invalida a anterior.
- Configure `CLOUD_API_APP_SECRET` (ou `config.appSecret`) para que o endpoint e os webhooks
  validem a assinatura da Meta.
- `business_public_key_signature_status: "MISMATCH"` em `GET flows/encryption` indica que a chave
  registrada não confere — rode o `PUT` de novo.

## 5. Saúde do Flow

O webhook `flows` da Meta (mudança de status, taxa de erro, latência e disponibilidade do
endpoint) é repassado como evento `flow.status_update`, com o `value` da Meta sem alteração.
`value.event` é um de: `FLOW_STATUS_CHANGE`, `CLIENT_ERROR_RATE`, `ENDPOINT_ERROR_RATE`,
`ENDPOINT_LATENCY`, `ENDPOINT_AVAILABILITY`, `FLOW_VERSION_EXPIRY_WARNING`. Assine o campo `flows`
na configuração de webhooks do app (é também pré-requisito da Meta para publicar Flows com
endpoint). `GET /:flowId` traz `health_status` (o Flow pode ser enviado? o que o impede?).

Erros de envio ligados ao estado: `132068` (Flow `BLOCKED`) e `132069` (`THROTTLED`, 10 envios/h).

## 6. Engines não oficiais

`baileys` e `whatsmeow` **não** criam nem enviam Flows oficiais (501 nas rotas acima). Quando uma
conta dessas engines recebe a resposta de um Flow/native flow, ela chega com o mesmo
`flowResponse` e o mesmo evento `flow.response`.

## O que foi validado

Validado localmente por testes automatizados (`apps/api/test/flows.test.ts`,
`flow-endpoint-crypto.test.ts`): criptografia nos dois sentidos simulando o lado da Meta, `ping`,
troca de dados, notificação de erro, 421/427/432 e normalização da resposta nas três engines.
**Não validado contra a Meta real** (exige WABA, número e app): chamadas de gestão, registro da
chave pública, envio e o percurso completo no aparelho.

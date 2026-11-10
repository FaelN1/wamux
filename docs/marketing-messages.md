# Marketing Messages API (Cloud)

A Meta está movendo o envio de **templates de marketing** de `/messages` (Cloud API) para um
endpoint próprio, a Marketing Messages API (MM API). No WAMux isso é uma opção do envio de
template — nada muda na forma de montar o template.

Consultado em 2026-11-10
([visão geral](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview),
[envio](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/send-marketing-messages),
[primeiros passos](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started)).

## Prazos da Meta

| Data           | O que acontece                                                               |
| -------------- | ---------------------------------------------------------------------------- |
| 2025-11-19     | MM API em disponibilidade geral                                              |
| **2027-04-13** | contas criadas a partir desta data não enviam mais marketing por `/messages` |
| **2027-10-13** | marketing por `/messages` passa a dar erro para todos                        |

Templates de utilidade, autenticação e mensagens de serviço **continuam** em `/messages`.

## Como enviar

`POST /api/v1/instances/:id/templates/send` (engine `cloud`, escopo `send`):

```json
{
  "to": "5511999999999",
  "name": "promo_novembro",
  "language": "pt_BR",
  "components": [{ "type": "body", "parameters": [{ "type": "text", "text": "Maria" }] }],
  "route": "marketing",
  "productPolicy": "STRICT",
  "messageActivitySharing": true
}
```

Resposta:

```json
{
  "id": "wamid.HBg…",
  "to": "5511999999999",
  "timestamp": 1762790000,
  "status": "sent",
  "route": "marketing"
}
```

| Campo                    | Valores                         | Efeito                                                                                                                                                                                          |
| ------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `route`                  | `cloud` (default) · `marketing` | `marketing` envia por `/{phone-number-id}/marketing_messages`                                                                                                                                   |
| `productPolicy`          | `CLOUD_API_FALLBACK` · `STRICT` | Só com `route: marketing`. Sem ele vale o default da Meta (`CLOUD_API_FALLBACK`): se o onboarding da MM API não estiver completo, a Meta entrega pela Cloud API. `STRICT` falha em vez de cair. |
| `messageActivitySharing` | `true` · `false`                | Só com `route: marketing`. Omitido = configuração da conta.                                                                                                                                     |

Regras aplicadas pelo gateway:

- `productPolicy` / `messageActivitySharing` sem `route: marketing` → **400** (não são ignorados em
  silêncio).
- `route: marketing` com `quotedMessageId` → **400**: a MM API não aceita reply.
- `to` pode ser um BSUID (`BR.1349…`); vai como `recipient`. A Meta não otimiza a entrega para
  BSUID e recusa templates com preço dinâmico (`bid_spec`) — erro `131062`.

## Requisitos (lado da Meta)

- Aceitar os termos da MM API: **App Dashboard → WhatsApp → Quickstart → "Improve ROI with
  marketing messages with optimizations" → Get started**.
- Token com `whatsapp_business_messaging`; ao menos um template **MARKETING** aprovado.
- Template novo (ou reativado após 7 dias parado) leva até 10 min para sincronizar.
- Para medir conversão: Pixel da Meta ou Conversions API.
- Só categoria MARKETING. Utilidade, autenticação e texto livre dão erro.

Limites regionais: sem entrega de marketing para usuários nos **EUA** (erro `131049`); sem
otimização nem relatório de clique/conversão em EEE, Reino Unido, Japão, Coreia do Sul, Nigéria,
África do Sul e Tailândia.

## Como saber por onde a mensagem saiu

O `route` da resposta é o endpoint **chamado**. Com fallback permitido, a Meta ainda pode entregar
pela Cloud API. A confirmação vem no evento `message.status`, campo `pricing.category`:

- `marketing_lite` → saiu pela MM API;
- `marketing` → saiu pela Cloud API.

## Erros

Chegam com o código da Meta (não como 500):

| Código   | Significado                                                                   |
| -------- | ----------------------------------------------------------------------------- |
| `131063` | marketing desabilitado na Cloud API e a conta não aceitou os termos da MM API |
| `131062` | destinatário BSUID não suportado para este template                           |
| `131049` | a Meta optou por não entregar (limite de marketing por usuário / EUA)         |
| `100`    | destinatário ausente                                                          |

## Escopo

É um envio **unitário**, como qualquer outro do gateway — passa pelo mesmo limite de taxa e pelas
mesmas regras anti-ban. O WAMux não tem (e não deve ganhar) campanhas, listas de audiência ou
filas de disparo; a "otimização de entrega" é feita pela Meta, do lado dela.

## Validação

Testado localmente (`apps/api/test/cloud-api.test.ts`, `templates-service.test.ts`): endpoint,
corpo, validações e correlação. **Não validado contra a Meta real** — exige conta com os termos da
MM API aceitos. O tipo de `message_activity_sharing` não está explícito na referência (a página o
descreve como liga/desliga); o gateway envia booleano.

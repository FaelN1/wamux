# Atualização das integrações com WhatsApp — novembro/2026

Data das consultas às fontes: **2026-11-10**. Branch de trabalho:
`feat/atualizacao-integracoes-whatsapp` (sem commits — alterações na árvore de trabalho).

Legenda de validação usada neste documento:

- **Testado** — coberto por teste automatizado local (mocks; simula o lado da Meta/sidecar).
- **Compilado** — passa em build/type-check/vet, sem teste de comportamento.
- **Não validado ao vivo** — depende de conta/aparelho real. Nada aqui foi executado contra o
  WhatsApp ou a Meta de verdade: não havia credenciais, e envios reais não foram autorizados.

## 1. Diagnóstico do estado inicial

Projeto: monorepo pnpm/Turborepo — `apps/api` (NestJS 10, Node ≥ 20), `apps/web` (React/Vite),
`packages/shared` (tipos), `services/whatsmeow` (sidecar Go, fora do turbo). Três engines por
instância atrás de um contrato único (`WhatsAppProvider`).

| Achado no estado inicial (commit `de74359`)                                                                                                                                                                                             | Gravidade                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `POST /api/webhooks/cloud/:id` e `/whatsmeow/:id` processavam qualquer POST: sem `X-Hub-Signature-256`, sem token do sidecar (o comentário dizia que havia). Bastava conhecer o UUID da instância para injetar mensagens/status falsos. | P0 segurança                           |
| Graph API fixada em `v21.0`, que expira em **2027-01-21**.                                                                                                                                                                              | P0 compatibilidade                     |
| BSUID (rollout da Meta desde abr/2026): `from` / `recipient_id` passaram a ser opcionais; o adapter os usava sem fallback e `toNumber()` destruía um BSUID.                                                                             | P0 perda de mensagens                  |
| Status `played` caía no `default` e virava `pending` (rebaixava o ack).                                                                                                                                                                 | P0 regressão                           |
| Mensagens `contacts`, `reaction`, `order`, `system`, `unsupported`, `edit`, `revoke`, `context` (reply), `referral` e o `payload` de botão saíam como `unknown` sem conteúdo.                                                           | P0 perda de informação                 |
| Todo erro da Graph API virava HTTP 500 "Erro interno" (código/subcódigo da Meta perdidos); a fila de saída repetia 5× erros definitivos.                                                                                                | P0                                     |
| `conversation_analytics` (desligado em 2026-11-01) e Flows Metrics API (descontinuada em 2026-04-30) ainda expostos.                                                                                                                    | P0 compatibilidade                     |
| Baileys `7.0.0-rc14` não dá ack no stanza `<status>` de topo → a instância segue "conectada" mas o servidor derruba o stream e retém mensagens.                                                                                         | P0 perda de mensagens                  |
| Socket Baileys sem `getMessage`, cache de retry e cache de metadados de grupo ("Aguardando mensagem"). `normalize()` não desembrulhava efêmeras/view-once.                                                                              | P0                                     |
| `upsertLabel` do Baileys chamava `addOrEditLabel`, que não existe na rc14 — criar etiqueta sempre falhava.                                                                                                                              | Bug                                    |
| `POST chats/:jid/read` na Cloud era no-op: a Cloud confirma leitura por mensagem e a rota não aceitava ids.                                                                                                                             | Bug (rota existia, caminho incompleto) |
| Flows: havia CRUD + envio. Faltavam endpoint de troca de dados, chave de criptografia, metadados, assets, parsing de `response_json`, webhook `flows`, persistência/correlação. `flowToken` obrigatório sem necessidade.                | P1                                     |
| Caminhos da Groups API divergiam da referência da Meta; `allow_category_change` (sem suporte desde 2025-04) ainda era enviado; listagens sem paginação.                                                                                 | P1                                     |
| whatsmeow 99 commits atrás do upstream.                                                                                                                                                                                                 | P1                                     |

O que **já era sólido** e foi preservado: reconexão com backoff/jitter e classificação terminal,
entrega de webhook com BullMQ/DLQ/circuit breaker/HMAC, dedup de entrada, idempotência de envio,
resolução LID↔PN, chaves com escopo, capability gating (501/422).

## 2. Versões — antes e depois

| Componente                            | Antes                                    | Estável mais recente                                                                             | Pré-release / ref. mais recente                                                              | Destino                                                                      | Justificativa                                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Baileys** (npm `baileys`)           | `7.0.0-rc14` + patch local               | **Não existe 7.0.0 estável.** dist-tag `latest` = `7.0.0-rc14` (2026-07-29); `legacy` = `6.7.24` | `master` @ `81345beb67` (2026-10-26): 3 commits após a rc14, 1 funcional (#2741, WIN_HYBRID) | **`7.0.0-rc14` (mantida)**                                                   | Já é a versão mais nova publicada. Voltar para 6.x seria regressão (LID, ESM). Não adotei `master` por git: sem release, e o único commit funcional não é comprovadamente necessário. |
| Patch local do Baileys                | back-port do PR #2434 (mídia em canais)  | PR #2434 segue **aberto**                                                                        | —                                                                                            | **mantido + ampliado**                                                       | O tarball puro da rc14 não tem o caminho de upload de newsletter; o patch ainda aplica limpo. Ampliado com o ack de `<status>` (PR #2883) — ver §4.                                   |
| **whatsmeow** (`go.mau.fi/whatsmeow`) | `v0.0.0-20260722203353-e9a033b24933`     | Não há tags/releases (por projeto; manutenção ativa)                                             | `main` = `@latest` do proxy Go                                                               | **`v0.0.0-20261110152934-c88388f983b4`** (commit `c88388f983b4`, 2026-11-10) | Pseudo-version reproduzível do `@latest`. 99 commits de correções de reconexão/keepalive/app-state.                                                                                   |
| Go (sidecar)                          | `go 1.25.0`, imagem `golang:1.25-alpine` | —                                                                                                | —                                                                                            | `go 1.26.0`, `golang:1.26-alpine`                                            | Exigência do novo `go.mod` do whatsmeow; a imagem usa `GOTOOLCHAIN=local`.                                                                                                            |
| `go.mau.fi/util`                      | `v0.9.12-0.2026…`                        | —                                                                                                | —                                                                                            | `v0.11.0`                                                                    | Transitiva.                                                                                                                                                                           |
| `google.golang.org/protobuf`          | `v1.36.11`                               | —                                                                                                | —                                                                                            | `v1.36.12`                                                                   | Transitiva.                                                                                                                                                                           |
| **Graph API**                         | `v21.0` (expira 2027-01-21)              | **`v26.0`** (2026-07-29)                                                                         | `v27.0` aparece em exemplos da doc, mas **não** está na tabela de versões — não verificado   | **`v26.0`**                                                                  | Decisão confirmada pelo responsável. Mais recente oficialmente listada.                                                                                                               |
| Flow JSON                             | exemplos com `5.0` (congelada)           | **7.3** recomendada (7.2–7.0, 6.3–6.1, 5.1 publicáveis)                                          | —                                                                                            | exemplos em `7.3`                                                            | É versão do **seu** `flow.json`, não do gateway.                                                                                                                                      |
| Data API (Flows)                      | —                                        | **4.0** recomendada; 3.0 suportada                                                               | —                                                                                            | suporta ambas                                                                | O gateway é agnóstico; repassa `flow_token_signature` (4.0).                                                                                                                          |
| `flow_message_version`                | `"3"`                                    | `"3"`                                                                                            | —                                                                                            | `"3"`                                                                        | Sem mudança.                                                                                                                                                                          |

### Breaking changes e adaptações

**whatsmeow** (verificado compilando contra o destino):

- `SetStatusMessage(ctx, string)` → `SetStatusMessage(ctx, types.SetStatusInput)` — único erro de
  compilação; corrigido em `internal/whatsapp/client.go`.
- Envio para número sem LID agora retorna `ErrRecipientNotOnWhatsApp` — mapeado para **422**
  `recipient_not_on_whatsapp` no sidecar e `recipientNotOnWhatsApp` no gateway (antes: 500).
- `GetBlocklist`/`UpdateBlocklist`, `ReqCreateGroup.CreateKey`: mudaram, mas o sidecar não usa.
- **Armazenamento:** migrações `15-companion-meta-nonce` e `16-wasa-root-secret` do `sqlstore` —
  `ALTER TABLE … ADD COLUMN` aditivos, aplicados automaticamente quando o SQLite de cada instância
  é aberto. Marcadas upstream como compatíveis com binários v8+ (rollback possível). **Sessões
  não são apagadas nem exigem novo pareamento.**

**Baileys:** sem mudança de versão → sem migração de credenciais. As chaves `lid-mapping`,
`device-list`, `tctoken`, `identity-key` já eram persistidas (o store grava `categoria-id`
genericamente).

**Graph v21 → v26** (o que afetou o código):

| Mudança da plataforma                                               | Adaptação                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| BSUID / usernames (abr–nov/2026)                                    | fallback `from_user_id` / `recipient_user_id`; envio por `recipient`; bloqueio por `user_id`; `identity.userId` / `identity.username` |
| v24+: `conversation` sai dos status; preço por mensagem (`pricing`) | o código não dependia de `conversation`; `pricing` agora é repassado                                                                  |
| Status `played` (nov/2025)                                          | mapeado; status desconhecido é ignorado em vez de virar `pending`                                                                     |
| Edit/revoke, `unsupported.type`, ecos de coexistência               | normalizados                                                                                                                          |
| `allow_category_change` sem suporte (abr/2025)                      | removido do envio à Meta (campo aceito e ignorado)                                                                                    |
| `conversation_analytics` desligado (2026-11-01)                     | rota responde 410; nova `pricing-analytics`                                                                                           |
| Flows Metrics API descontinuada (2026-04-30)                        | rota responde 410                                                                                                                     |
| Indicador de digitação                                              | opção `typing` no mark-read                                                                                                           |

**Não basta trocar a URL:** as linhas acima são o que precisou mudar além de `v21.0` → `v26.0`.

## 3. Comparação com Evolution API e Evolution Go

|                | Evolution API                                                             | Evolution Go                                          |
| -------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Repositório    | `evolution-foundation/evolution-api`                                      | `evolution-foundation/evolution-go`                   |
| Ref. analisada | `develop` @ `e273b90` (2026-07-14, v2.4.0); `main` @ `fa09d37` (v2.3.7)   | `main` @ `9337afc` (2026-07-03, tag `0.7.2`)          |
| Biblioteca     | Baileys `7.0.0-rc13` (develop) / `rc.9` (main)                            | whatsmeow oficial `…20260630…b572e5bcb92b`            |
| Licença        | Apache-2.0 **+ condições extras** (manter logo/aviso de uso visível)      | idem                                                  |
| Observação     | 2.4.0 exige ativação em servidor de licença; telemetria ligada por padrão | `main` traz código ofuscado de verificação de licença |

**Conclusão de licença:** usados só como **referência**. Nenhum código foi copiado; nada deles foi
adicionado como dependência. As ideias abaixo foram reimplementadas no nosso desenho.

Onde o WAMux já estava à frente dos dois: reconexão com backoff e limite, webhook durável com DLQ
e assinatura, chaves com escopo, capability gating, comunidades, resolução LID↔PN.

| #     | Oportunidade (origem)                                                                               | Problema resolvido                                              | Esforço | Risco                                                | Prioridade | Status                                             |
| ----- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------- | ---------------------------------------------------- | ---------- | -------------------------------------------------- |
| 1     | Ack do stanza `<status>` (issues EvoAPI #2778, EvoGo #185/#211)                                     | instância conectada que para de receber                         | P       | baixo                                                | P0         | **Feito** (patch)                                  |
| 2     | Autenticar webhooks de entrada (nenhum dos dois faz na rota Meta)                                   | injeção de mensagens falsas                                     | P–M     | médio                                                | P0         | **Feito**                                          |
| 3     | `getMessage` + caches de retry/sinal/grupo (EvoAPI `BS:770-806`)                                    | "Aguardando mensagem"                                           | M       | médio                                                | P0         | **Feito** (memória + Redis)                        |
| 4     | Desembrulhar efêmera/view-once/doc-com-legenda                                                      | mensagens `unknown` sem texto                                   | P       | baixo                                                | P0         | **Feito**                                          |
| 9     | Contexto de reply e menções na ENTRADA                                                              | integrações não sabiam a que mensagem a resposta se referia     | P       | baixo                                                | P1         | **Feito** (3 engines p/ reply; menções no Baileys) |
| 10    | Ecos de coexistência + referral de anúncio (EvoAPI)                                                 | mensagens do app Business invisíveis; origem de anúncio perdida | P       | baixo                                                | P1         | **Feito** na Cloud e Baileys                       |
| 5     | Botões/lista/PIX que renderizam (nó `<biz>`)                                                        | interativos chegam como texto                                   | M       | **alto** (receitas divergentes, relatos de bloqueio) | P1         | Pendente — exige matriz de teste em aparelho       |
| 6     | Pareamento com passkey no sidecar (EvoGo)                                                           | contas com passkey não conectam                                 | G       | médio                                                | P1         | Pendente                                           |
| 7     | Fixar versão do WA Web no sidecar (`SetWAVersion`)                                                  | "Client outdated (405)"                                         | P       | baixo                                                | P1         | Pendente                                           |
| 8     | Ajustes por instância (rejeitar chamada, sempre online, auto-leitura, ignorar grupos)               | paridade operacional                                            | M       | baixo                                                | P1         | Pendente                                           |
| 9b    | Menções e "mencionar todos" no ENVIO                                                                | —                                                               | P–M     | baixo                                                | P1         | Pendente (precisa de rota no sidecar)              |
| 11    | Mais eventos do sidecar (`TemporaryBan`, `ConnectFailure`, `StreamReplaced`, `CallOffer`, presença) | cegueira operacional no whatsmeow                               | M       | baixo                                                | P1         | Pendente                                           |
| 12    | Variantes de número BR/MX/AR na checagem                                                            | 9º dígito                                                       | P       | baixo                                                | P1         | Pendente                                           |
| 13    | Arquivar/silenciar/fixar chat, privacidade, foto de grupo, pedidos de entrada                       | paridade                                                        | M       | baixo                                                | P2         | Pendente                                           |
| 14    | `/metrics` Prometheus                                                                               | observabilidade                                                 | P       | baixo                                                | P2         | Pendente                                           |
| 15    | Headers customizados e mídia base64 no webhook                                                      | conveniência                                                    | P–M     | baixo                                                | P2         | Pendente                                           |
| 16–17 | Carrossel; transportes NATS/SQS/Kafka                                                               | —                                                               | —       | —                                                    | P2         | Pendente (sob demanda)                             |

**Fora de escopo (por regra do projeto):** integrações de chatbot/helpdesk (Typebot, Chatwoot,
Dify, OpenAI, n8n…), status para "todos os contatos", rotação de proxy, rotas que expõem o socket
cru do Baileys, chamadas via terceiros, e qualquer recurso de disparo em massa.

## 4. O que foi implementado

### P0 — segurança e perda de mensagens

- **Webhooks de entrada autenticados.** Corpo cru capturado só em `/api/webhooks/*`; o adapter
  valida a origem (`verifyInboundWebhook`), 401 se inválida; a rota só atende a engine certa (404).
  - Cloud: `X-Hub-Signature-256` com `CLOUD_API_APP_SECRET` ou `config.appSecret`. `verify_token`
    por instância (`config.verifyToken`) com fallback no global.
  - whatsmeow: o sidecar assina com `X-Wamux-Signature: sha256=HMAC(MASTER_API_KEY, corpo)`.
  - Arquivos: `apps/api/src/main.ts`, `instance/inbound-webhook.controller.ts`,
    `providers/webhook-signature.util.ts`, `services/whatsmeow/internal/webhook/dispatcher.go`.
- **Erros da fonte viram erro canônico** (`ProviderRequestError`): status + `code` + detalhes da
  Meta na resposta; erro definitivo (4xx ≠ 429) não é mais repetido pela fila de saída.
- **Cloud em Graph v26** — BSUID, `played`, tipos de entrada, lote tolerante a item malformado
  (`providers/cloud/cloud-api.provider.ts`).
- **Baileys** — ack de `<status>` no patch; `getMessage` (store em memória + Redis, sobrevive a
  restart e a migração de worker — `BAILEYS_RETRY_CACHE_TTL_SEC`), cache de retry, cache de chaves de sinal
  e de metadados de grupo; `normalize` desembrulha envelopes e mapeia contato, enquete, cliques,
  reply, menções, encaminhada e referral; etiquetas corrigidas (`addLabel`) e `deleteLabel` novo.

### P1 — Flows de ponta a ponta

Guia completo com payloads: [`docs/whatsapp-flows.md`](whatsapp-flows.md).

| Item pedido                                             | Situação                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Criar, listar (paginado), consultar, apagar             | Feito                                                                                                                                                                           |
| Upload/atualização do Flow JSON + `validation_errors`   | Feito (já existia; erros agora também saem em falhas da Graph)                                                                                                                  |
| Estados e publicar/depreciar                            | Feito; `health_status`, `json_version`, `data_api_version` expostos                                                                                                             |
| Atualizar metadados / `endpoint_uri` / `application_id` | **Novo** — `PATCH flows/:flowId`                                                                                                                                                |
| Baixar o Flow JSON vigente                              | **Novo** — `GET flows/:flowId/assets`                                                                                                                                           |
| Chaves e criptografia                                   | **Novo** — `GET/PUT flows/encryption` (gera RSA-2048 ou importa; registra a pública na Meta; privada só no gateway)                                                             |
| Endpoint de troca de dados                              | **Novo** — `POST /api/webhooks/flows/:id`: assinatura, RSA-OAEP/AES-GCM, `ping`, notificação de erro, 421/427/432; repassa JSON ao serviço do integrador (`PUT flows/endpoint`) |
| Envio (parâmetros, token)                               | Feito; `flowToken` opcional (gerado e devolvido); validações de `flowId` xor `flowName`, `screen`, `data`                                                                       |
| Recebimento/interpretação                               | **Novo** — `response_json` parseado em `flowResponse` (Cloud, Baileys, whatsmeow)                                                                                               |
| Persistência e correlação                               | **Novo** — tabela `flow_sessions` (instância, contato, mensagem, Flow, telas, resposta), `GET flows/sessions[/:flowToken]`, evento `flow.response`                              |
| Saúde                                                   | **Novo** — webhook `flows` → evento `flow.status_update`                                                                                                                        |
| Edição após publicar                                    | Documentado: imutável; clonar com `clone_flow_id`                                                                                                                               |
| Métricas                                                | 410 — API descontinuada pela Meta                                                                                                                                               |

### P1 — demais itens da API oficial

`pricing-analytics`; override de webhook por número (`PUT/DELETE account/webhook-override`);
`health_status` em número e WABA; paginação de templates/números; `typing` e `messageIds` no
mark-read; caminhos da Groups API; evento `account.update` (qualidade/nome do número, alertas,
revisão, segurança, opt-out de marketing, username); `pricing` e `callbackData` nos status.

### whatsmeow

Biblioteca e toolchain atualizados; 422 para destinatário sem WhatsApp; assinatura dos webhooks;
`flow_response` no payload de `MESSAGE` (tipo `interactive`, antes `other`).

## 5. Matriz de cobertura

✅ suportado · ◐ parcial · ❌ não suportado · — não aplicável · ? não verificado · ∅ não encontrado.
"WAMux" = estado **depois** desta atualização.

| Funcionalidade                                                                                                                                                                                                                                                                           | WAMux antes          | WAMux agora                                         | Evolution API         | Evolution Go        | Baileys       | whatsmeow                           | API oficial                                                      | Requisitos / limites                                   | Prioridade                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------- | --------------------- | ------------------- | ------------- | ----------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| Webhook de entrada autenticado                                                                                                                                                                                                                                                           | ❌                   | ✅                                                  | ❌ na rota Meta       | —                   | —             | —                                   | ✅ `X-Hub-Signature-256`                                         | app secret                                             | P0                           |
| Ack de `<status>`                                                                                                                                                                                                                                                                        | ❌                   | ✅ (patch)                                          | ❌ (PR aberto)        | ❌ (PR aberto)      | ❌ na rc14    | ✅ upstream                         | —                                                                | —                                                      | P0                           |
| Retry de mensagem (`getMessage`)                                                                                                                                                                                                                                                         | ❌                   | ✅ memória + Redis                                  | ✅                    | —                   | ✅ (opção)    | ✅ nativo                           | —                                                                | conteúdo fica no Redis pelo TTL (`0` desliga)          | P0                           |
| Efêmera / view-once na entrada                                                                                                                                                                                                                                                           | ❌                   | ✅                                                  | ✅                    | ✅                  | ✅            | ? sidecar não revisado              | —                                                                | —                                                      | P0                           |
| BSUID / username                                                                                                                                                                                                                                                                         | ❌                   | ✅                                                  | ∅                     | —                   | —             | —                                   | ✅ desde 2026                                                    | número só vem com contato recente                      | P0                           |
| Status `played`                                                                                                                                                                                                                                                                          | ❌ (rebaixava)       | ✅                                                  | ✅                    | ✅                  | ✅            | ✅                                  | ✅                                                               | —                                                      | P0                           |
| Erros da fonte expostos                                                                                                                                                                                                                                                                  | ❌ (500)             | ✅                                                  | ◐                     | ◐                   | —             | —                                   | ✅ códigos                                                       | —                                                      | P0                           |
| Reply/encaminhada na entrada                                                                                                                                                                                                                                                             | ❌                   | ✅ Cloud, Baileys · ❌ whatsmeow                    | cru                   | ◐                   | ✅            | ✅                                  | ✅ `context`                                                     | sidecar não expõe                                      | P1                           |
| Referral de anúncio                                                                                                                                                                                                                                                                      | ❌                   | ✅ Cloud, Baileys                                   | ◐                     | ✅                  | ✅            | ✅                                  | ✅                                                               | —                                                      | P1                           |
| Clique em botão/lista normalizado                                                                                                                                                                                                                                                        | ❌                   | ✅ Cloud, Baileys                                   | cru                   | ✅                  | ✅            | ✅                                  | ✅                                                               | —                                                      | P1                           |
| Reação / edição / exclusão (Cloud)                                                                                                                                                                                                                                                       | ❌                   | ✅ (edição/exclusão ?)                              | ◐                     | —                   | —             | —                                   | ✅ (edit/revoke: coexistência)                                   | formato de edit/revoke não validado                    | P1                           |
| Flows — gestão                                                                                                                                                                                                                                                                           | ◐                    | ✅                                                  | ∅                     | —                   | ❌            | ❌                                  | ✅                                                               | WABA verificada p/ publicar                            | P1                           |
| Flows — endpoint criptografado                                                                                                                                                                                                                                                           | ❌                   | ✅                                                  | ∅                     | —                   | ❌            | ❌                                  | ✅                                                               | HTTPS público, chave, app conectado                    | P1                           |
| Flows — resposta normalizada                                                                                                                                                                                                                                                             | ❌                   | ✅ 3 engines                                        | cru                   | ◐                   | ✅ recebe     | ✅ recebe                           | ✅ `nfm_reply`                                                   | conteúdo idêntico entre engines: ?                     | P1                           |
| Flows — sessões/correlação                                                                                                                                                                                                                                                               | ❌                   | ✅                                                  | ∅                     | —                   | —             | —                                   | via `flow_token`                                                 | —                                                      | P1                           |
| Flows — métricas                                                                                                                                                                                                                                                                         | ✅ (API viva)        | 410                                                 | ∅                     | —                   | —             | —                                   | ❌ descontinuada                                                 | —                                                      | P0                           |
| Templates CRUD + envio                                                                                                                                                                                                                                                                   | ✅                   | ✅ + paginação                                      | ✅                    | —                   | —             | —                                   | ✅                                                               | 250/6.000 templates; 100 criações/h                    | —                            |
| Botão FLOW em template                                                                                                                                                                                                                                                                   | ◐ passa `components` | ◐ (sem tipagem dedicada, sem sessão automática)     | ∅                     | —                   | —             | —                                   | ✅                                                               | —                                                      | P2                           |
| Analytics de preço                                                                                                                                                                                                                                                                       | ❌                   | ✅                                                  | ∅                     | —                   | —             | —                                   | ✅ `pricing_analytics`                                           | indisponível p/ contas UE/Japão                        | P1                           |
| Override de webhook por número                                                                                                                                                                                                                                                           | ❌                   | ✅                                                  | ∅                     | —                   | —             | —                                   | ✅                                                               | URL ≤ 200 chars                                        | P1                           |
| Mark-read + digitando (Cloud)                                                                                                                                                                                                                                                            | ❌ (no-op)           | ✅                                                  | ?                     | —                   | —             | —                                   | ✅                                                               | 25 s                                                   | P1                           |
| Grupos da Cloud API                                                                                                                                                                                                                                                                      | ◐ caminhos errados   | ◐ caminhos corrigidos, **não validado**             | ∅                     | —                   | —             | —                                   | ✅ restrito (OBA, 8 membros)                                     | conta OBA                                              | P1                           |
| Calling API                                                                                                                                                                                                                                                                              | ◐ sinalização        | ◐ (eventos não-terminate ainda rotulados `connect`) | ∅                     | —                   | —             | —                                   | ✅ (restrições por país)                                         | limite ≥ 2.000                                         | P2                           |
| Coexistência (ecos)                                                                                                                                                                                                                                                                      | ❌                   | ◐ ecos → `message.sent` (formato ?)                 | ✅                    | —                   | —             | —                                   | ✅ só parceiros                                                  | Embedded Signup                                        | P1                           |
| Eventos de conta (qualidade, alertas…)                                                                                                                                                                                                                                                   | ❌ descartados       | ✅ `account.update`                                 | ∅                     | —                   | —             | —                                   | ✅                                                               | assinar os campos                                      | P2                           |
| Mensagem de voz (flag), endereço (só Índia), produto/catálogo/carrossel, pagamentos BR (PIX/`order_details`), `request_contact_info`, usernames API, componentes conversacionais, QR codes, grupos de template, apagar mídia, upload resumável, pin, `biz_opaque_callback_data` no envio | ❌                   | ❌                                                  | ◐ catálogo só Baileys | ∅                   | —             | —                                   | ✅ (disponibilidade varia)                                       | JSON exato **não verificado** nesta sessão para vários | P2                           |
| Marketing Messages API                                                                                                                                                                                                                                                                   | ❌                   | ✅ `route: marketing` no envio de template          | ∅                     | —                   | —             | —                                   | ✅ GA; templates de marketing saem de `/messages` até 2027-10-13 | aceite de termos                                       | feito (não validado ao vivo) |
| Embedded Signup                                                                                                                                                                                                                                                                          | ❌                   | ❌                                                  | ∅                     | —                   | —             | —                                   | ✅ só parceiros                                                  | —                                                      | fora de escopo               |
| Etiquetas (criar/apagar) Baileys                                                                                                                                                                                                                                                         | ❌ (bug)             | ✅                                                  | ✅                    | ✅                  | ✅ `addLabel` | ✅                                  | —                                                                | conta Business                                         | —                            |
| Interativos em engines não oficiais                                                                                                                                                                                                                                                      | ◐ fallback texto     | ◐ (sem mudança)                                     | ✅ c/ `<biz>`         | ✅ (relatos mistos) | ◐             | ◐                                   | —                                                                | risco de bloqueio                                      | P1 pendente                  |
| Pareamento com passkey                                                                                                                                                                                                                                                                   | ◐ status mapeado     | ◐                                                   | ❌                    | ✅                  | ?             | ✅ eventos                          | —                                                                | sem caminho headless                                   | P1 pendente                  |
| Canais: enquete (whatsmeow)                                                                                                                                                                                                                                                              | ❌                   | ❌                                                  | ❌                    | ?                   | ✅            | ❌ (erro 479; sem mudança upstream) | —                                                                | —                                                      | —                            |

## 6. Verificações executadas

| Verificação                                                              | Resultado                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Baseline antes de qualquer mudança                                       | type-check ok, 12 testes, lint 0 erros                                 |
| `pnpm type-check` (api, web, shared)                                     | ok — 5/5 tarefas                                                       |
| `pnpm --filter @wamux/api test`                                          | **78 testes, 78 passam** (eram 12)                                     |
| `pnpm lint`                                                              | 0 erros (108 avisos na api, 103 já existiam; nenhum bloqueante)        |
| `pnpm build`                                                             | ok (api, web, shared)                                                  |
| Sidecar: `CGO_ENABLED=1 go build ./...`, `go vet ./...`, `go test ./...` | ok (Go 1.26.5)                                                         |
| Sidecar: build da imagem Docker (`golang:1.26-alpine`)                   | ok                                                                     |
| `pnpm install --frozen-lockfile` após ampliar o patch do Baileys         | consistente                                                            |
| Prettier nos arquivos alterados                                          | ok (o `format:check` global já falhava antes, em arquivos não tocados) |

Testes novos (`apps/api/test/`): `inbound-webhook-auth`, `flow-endpoint-crypto`, `flows`,
`cloud-api`, `baileys-*`; no sidecar: `dispatcher_test.go`, `send_error_test.go`,
`events_test.go`.

**Limitações de validação (tudo abaixo é "não validado ao vivo"):** chamadas reais à Graph API
(gestão de Flows, registro de chave, envio, analytics, override, Groups); percurso de um Flow no
aparelho; BSUID com payload real; formato real de `edit`/`revoke`/ecos de coexistência; efeito do
ack de `<status>` e dos caches de retry numa sessão Baileys real; pareamento/envio com o whatsmeow
novo; migrações 15/16 sobre um SQLite de sessão existente (lidas no código-fonte, não executadas).

## 7. Configuração, migração e rollback

### Variáveis novas

| Variável                              | Default               | Para quê                                                                                                                                             |
| ------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUD_API_VERSION`                   | `v26.0` (era `v21.0`) | versão da Graph API                                                                                                                                  |
| `CLOUD_API_APP_SECRET`                | vazio                 | valida `X-Hub-Signature-256` (webhooks e endpoint de Flow). **Configure em produção.**                                                               |
| `WHATSMEOW_WEBHOOK_REQUIRE_SIGNATURE` | `true`                | exige assinatura nos callbacks do sidecar                                                                                                            |
| `BAILEYS_RETRY_CACHE_TTL_SEC`         | `86400`               | segundos em que o conteúdo das mensagens enviadas (Baileys) fica no Redis para responder a retries após restart/migração de worker; `0` = só memória |
| `FLOWS_SAVE_RESPONSE_DATA`            | `true`                | grava o conteúdo da resposta em `flow_sessions`                                                                                                      |
| `FLOWS_SESSION_RETENTION_DAYS`        | `0`                   | expurgo de sessões de Flow                                                                                                                           |
| `FLOWS_DATA_EXCHANGE_TIMEOUT_MS`      | `8000`                | timeout do serviço do integrador                                                                                                                     |

Por instância (`config`): `appSecret`, `verifyToken`, `flowDataExchangeUrl` (via `PUT flows/endpoint`).

### Passos de atualização

1. **Backup** dos SQLite do sidecar (volume `sessions/`) e do Postgres.
2. Se o seu `.env` fixa `CLOUD_API_VERSION=v21.0`, troque para `v26.0` (o default só vale se a
   variável não estiver definida). Defina `CLOUD_API_APP_SECRET`.
3. Suba **gateway e sidecar juntos** (`docker compose up --build`). Ordem importa: um sidecar
   antigo não assina, e o gateway novo responderia 401 — e o sidecar **descarta** webhooks que
   recebem 4xx. Se não puder atualizar os dois ao mesmo tempo, suba o gateway com
   `WHATSMEOW_WEBHOOK_REQUIRE_SIGNATURE=false`, atualize o sidecar e então volte para `true`.
4. Banco: uma tabela nova, `flow_sessions`. Com `DB_SYNCHRONIZE=true` ela é criada sozinha; com
   `false`, crie-a antes (o projeto ainda não tem migrations):

   ```sql
   CREATE TABLE flow_sessions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "instanceId" varchar NOT NULL,
     "flowToken" varchar NOT NULL,
     "flowId" varchar, "flowName" varchar, contact varchar, "messageId" varchar, mode varchar,
     status varchar NOT NULL DEFAULT 'sent',
     "lastScreen" varchar, "lastAction" varchar,
     exchanges integer NOT NULL DEFAULT 0,
     response jsonb, "responseMessageId" varchar, error jsonb,
     "createdAt" timestamptz NOT NULL DEFAULT now(),
     "updatedAt" timestamptz NOT NULL DEFAULT now(),
     "completedAt" timestamptz
   );
   CREATE UNIQUE INDEX ON flow_sessions ("instanceId", "flowToken");
   CREATE INDEX ON flow_sessions ("instanceId", "createdAt");
   ```

5. Na Meta: assine os campos de webhook que quiser receber (`flows`, `account_update`,
   `phone_number_quality_update`, `user_preferences`…).

Nenhuma sessão é apagada e nenhum repareamento é necessário (Baileys: mesma versão; whatsmeow:
migrações aditivas).

### Mudanças visíveis para quem integra

| Mudança                                                                                                                                             | Compatibilidade                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET account/conversation-analytics` → **410**                                                                                                      | incompatível (a API da Meta deixou de existir) → use `pricing-analytics` |
| `GET flows/:flowId/metrics` → **410**                                                                                                               | incompatível (idem)                                                      |
| Erros da Cloud: de 500 genérico para 400/404/422/429/502 com `error.code`                                                                           | muda o status; corpo mantém `statusCode`/`error.message`                 |
| whatsmeow: destinatário sem WhatsApp → 422 (era 500)                                                                                                | muda o status                                                            |
| Cloud: reação/edição/exclusão recebidas saem como `message.reaction`/`message.edited`/`message.deleted`, não mais `message.received` tipo `unknown` | muda o evento                                                            |
| `POST cloud-groups`: `participants` não é mais aceito (a Meta não aceita na criação); novo `description`                                            | incompatível                                                             |
| Novos campos em `message.received` e `message.status`; novos eventos `flow.response`, `flow.status_update`, `account.update`                        | aditivo                                                                  |
| `flowToken` opcional em `flows/send`; `flowToken` na resposta                                                                                       | aditivo                                                                  |
| `chatId`/`from` da Cloud podem ser um BSUID (`BR.1349…`)                                                                                            | comportamento novo da Meta                                               |

### Rollback

- **Código:** voltar ao commit `de74359` (nada foi commitado; `git stash`/descartar a branch).
- **Graph API:** `CLOUD_API_VERSION=v21.0` volta a versão (válida até 2027-01-21) sem reverter código.
- **Sidecar:** imagem anterior. As colunas adicionadas pelas migrações 15/16 são ignoradas pelo
  binário antigo (compatibilidade declarada upstream — não testada aqui; por isso o backup do
  passo 1).
- **Assinatura do sidecar:** `WHATSMEOW_WEBHOOK_REQUIRE_SIGNATURE=false`.
- **Flows:** a tabela `flow_sessions` pode permanecer; a chave pública registrada na Meta pode ser
  substituída a qualquer momento por outro `PUT flows/encryption`.

## 8. Pendências

| Pendência                                                                                                                                    | Motivo                                                                                   | Prioridade | Próximo passo                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Validação ao vivo de tudo que é Cloud/Flows                                                                                                  | sem WABA/número/app de teste                                                             | P0         | rodar o roteiro de `docs/whatsapp-flows.md` com `mode: draft` numa conta de teste                            |
| Validar o ack de `<status>` e os caches numa sessão Baileys real                                                                             | exige conta pareada por ≥ 1 h                                                            | P0         | observar se o stream deixa de cair a cada ~50 min                                                            |
| `CLOUD_API_APP_SECRET` ausente = webhooks aceitos sem validação                                                                              | compatibilidade com instalações existentes                                               | P0         | configurar o segredo; avaliar tornar obrigatório em `NODE_ENV=production`                                    |
| ~~Store de `getMessage` em memória~~ — **feito**: persistido no Redis (`ProviderCache`, `BAILEYS_RETRY_CACHE_TTL_SEC`)                       | falta só validar com uma sessão real                                                     | P1         | forçar um retry após restart do gateway e conferir que a mensagem é reentregue                               |
| Reply/menções/referral no whatsmeow                                                                                                          | o sidecar não expõe `ContextInfo`                                                        | P1         | campos aditivos em `events.go` + mapeamento no adapter                                                       |
| Interativos com nó `<biz>`; passkey; `SetWAVersion`; ajustes por instância; menções no envio; eventos extras do sidecar; variantes de número | ver §3 (itens 5–8, 9b, 11, 12)                                                           | P1         | cada um é uma fatia vertical independente                                                                    |
| Groups API da Cloud                                                                                                                          | exige conta OBA; corpos conferidos só contra o resumo da referência                      | P1         | validar e completar (pedidos de entrada, configurações, envio com `recipient_type: group`)                   |
| Tipagem do botão FLOW em template + sessão automática ao enviar por template                                                                 | não bloqueia (os `components` passam direto)                                             | P2         | estender `packages/shared/src/templates.ts`                                                                  |
| Eventos de Calling (`call_created`, gravação, transcrição)                                                                                   | rótulo impreciso hoje                                                                    | P2         | mapear por `event`                                                                                           |
| Marketing Messages API — validar ao vivo                                                                                                     | implementada (`docs/marketing-messages.md`); exige conta com os termos da MM API aceitos | P1         | enviar um template MARKETING com `route: marketing` e conferir `pricing.category = marketing_lite` no status |
| Demais recursos da Cloud listados na matriz (comércio, pagamentos BR, endereço, voz, usernames, QR codes…)                                   | JSON exato não verificado nesta sessão                                                   | P2         | buscar a referência de cada um antes de implementar                                                          |
| Painel web: página de Flows                                                                                                                  | não existia interface de Flows; fora do necessário para a API                            | P2         | fatia vertical em `apps/web` (lista, editor de JSON, sessões)                                                |
| OpenAPI do sidecar (`cmd/server/openapi.yaml`) sem o 422 e `flow_response`                                                                   | documentação interna                                                                     | P2         | atualizar o YAML                                                                                             |
| Migrations TypeORM                                                                                                                           | o projeto ainda usa `synchronize`                                                        | P2         | adotar migrations (o SQL de `flow_sessions` está no §7)                                                      |
| Baileys: commit #2741 (WIN_HYBRID) não incluído                                                                                              | não publicado; necessidade não comprovada                                                | P2         | se surgirem falhas de pareamento, é o primeiro candidato                                                     |

## 9. Fontes consultadas (2026-11-10)

- Baileys: registro npm (`dist-tags`, `time`), <https://github.com/WhiskeySockets/Baileys/releases>,
  PRs [#2434](https://github.com/WhiskeySockets/Baileys/pull/2434) e
  [#2883](https://github.com/WhiskeySockets/Baileys/pull/2883), tarball `baileys@7.0.0-rc14`.
- whatsmeow: <https://proxy.golang.org/go.mau.fi/whatsmeow/@latest>,
  <https://github.com/tulir/whatsmeow/compare/e9a033b24933...main>, código no cache de módulos.
- Evolution API / Evolution Go: clones nas refs da §3; issues e PRs via API pública do GitHub.
- Meta: [versões da Graph API](https://developers.facebook.com/docs/graph-api/changelog/versions),
  [changelog do WhatsApp](https://developers.facebook.com/docs/whatsapp/business-platform/changelog),
  [BSUID](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids),
  [webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview),
  [status](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status),
  [analytics](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics),
  [override de webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override),
  [Groups](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference),
  [códigos de erro](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes);
  Flows: [API](https://developers.facebook.com/docs/whatsapp/flows/reference/flowsapi),
  [endpoint](https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint),
  [criptografia](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/whatsapp-business-encryption),
  [envio](https://developers.facebook.com/docs/whatsapp/flows/guides/sendingaflow),
  [resposta](https://developers.facebook.com/docs/whatsapp/flows/guides/receiveflowresponse),
  [webhooks](https://developers.facebook.com/docs/whatsapp/flows/reference/flowswebhooks),
  [versões](https://developers.facebook.com/docs/whatsapp/flows/reference/versioning),
  [métricas](https://developers.facebook.com/docs/whatsapp/flows/reference/metrics_api).

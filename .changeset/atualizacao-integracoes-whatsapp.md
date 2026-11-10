---
'@wamux/api': minor
'@wamux/shared': minor
---

Atualização das integrações com WhatsApp (ver `docs/atualizacao-integracoes-2026-11.md`).

- **Segurança:** webhooks de entrada autenticados — `X-Hub-Signature-256` da Meta
  (`CLOUD_API_APP_SECRET`) e callbacks do sidecar whatsmeow assinados por HMAC
  (`X-Wamux-Signature`). **Atualize gateway e sidecar juntos.**
- **Cloud API:** Graph `v26.0`; suporte a BSUID (entrada e envio); status `played`; novos tipos de
  entrada (contatos, pedido, sistema, reação, edição, exclusão, referral, reply); erros da Meta
  repassados com código; `pricing-analytics` no lugar de `conversation-analytics` (410);
  override de webhook por número; paginação de templates/números/flows; caminhos da Groups API.
- **Flows:** endpoint de troca de dados criptografado, gestão de chave, metadados, assets,
  sessões persistidas (`flow_sessions`), eventos `flow.response` / `flow.status_update`; métricas
  respondem 410 (API descontinuada pela Meta).
- **whatsmeow:** biblioteca atualizada para `v0.0.0-20261110152934-c88388f983b4` (Go 1.26);
  destinatário sem WhatsApp vira 422.
- **Baileys:** permanece em `7.0.0-rc14` (versão mais recente publicada); ack do stanza
  `<status>`, cache de retry/sessão, desembrulho de mensagens efêmeras/view-once e correção de
  criar/apagar etiquetas.

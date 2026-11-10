# Changelog

Histórico de releases do WAMux. Versões anteriores à `2.0.0` não são
documentadas aqui.

## 2.0.0

Salto de geração em relação à `1.x`: a superfície do produto mais que
dobrou — a Cloud API saiu de "texto e mídia" para paridade ampla, entraram Inbox,
painel de Logs e API keys com escopo.

Nada foi removido da superfície REST: em compatibilidade estrita isto seria um
`minor`. O `major` é sinalização — a release cria **novas entidades de
persistência** (inbox, logs de atividade, API keys) e
**novas variáveis de ambiente**, então uma atualização em produção não é um
`docker compose pull` indiferente.

### Primeira suíte de testes automatizada

- Runner nativo do Node + `tsx`, sem framework extra. `pnpm test`.
- Afirma o contrato de capabilities: toda capability que uma engine declara
  precisa ter o método que o feature module chama no gate.

### Cloud API (Meta) — paridade ampla

- Webhook de entrada roteado por `change.field`, status de entrega e download
  de mídia.
- Botões, listas, CTA, `mark-read`, typing, block/unblock.
- **Templates HSM**: CRUD, envio com parâmetros, analytics e webhooks de
  status/qualidade/categoria — com tela dedicada no painel, builder completo e
  preview ao vivo num mock de telefone.
- **Flows**: CRUD com `validation_errors`, publicar/depreciar, envio e métricas.
- **Perfil de negócio e conta/WABA**: números, registro, verificação, 2FA,
  subscrição de webhooks e analytics.
- **Groups API** (OBA, máx 8) e **Calling API** (sinalização).

### Operação e produto

- **Inbox**: conversas, contatos e mensagens persistidos, com tempo real e mídia
  na thread.
- **Painel de Logs/Atividade** cross-instância, com histograma, filtros e export.
- **API keys com escopo** (`read`/`send`/`control`/`setting`/`app`/`delete`), para
  terceiros operarem uma instância sem a key mestra.
- **Storage de mídia em S3** (AWS, MinIO, Spaces) com fallback para disco local.
- Comunidades, paridade de canais (baileys + whatsmeow), reagir/editar/apagar,
  localização, contato/vCard e Status/Stories.
- Documentação **OpenAPI** dos controllers e DTOs.

### Notas de atualização

- A imagem da API traz **ffmpeg**, usado para converter áudio em nota de voz
  (ogg/opus).

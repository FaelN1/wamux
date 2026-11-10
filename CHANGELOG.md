# Changelog

Histórico de releases do WAMux. Versões anteriores à `2.0.0` estão apenas no
histórico do git (`git log v1.1.0`).

## 2.0.2

Corrige a **troca de engine para `zapo`**, que falhava ao importar as
credenciais e revertia para a engine anterior:

```
Falha ao importar credenciais em zapo (revertido para whatsmeow, sessão
preservada): duplicate key value violates unique constraint
"pg_type_typname_nsp_index"
```

### Causa

O backend Postgres do zapo cria as tabelas com `CREATE TABLE IF NOT EXISTS`,
que **não é seguro sob concorrência**: o Postgres consulta o catálogo e cria em
seguida, então duas transações passam pela verificação e a segunda estoura no
índice de `pg_type`. Duas coisas tornavam a corrida fácil de disparar:

- os domínios de migração **se sobrepõem** — `signal` atende 4 stores
  (identity/preKey/signal/session) e `mailbox` atende 3 (contacts/messages/
  threads) — e cada `BasePgStore` memoiza a migração no **próprio objeto**.
  A limpeza de sessão, primeira operação do import e num banco ainda sem
  schema, migrava 15 domínios em paralelo;
- o gateway é **multi-worker**, então dois processos subindo juntos migrariam
  ao mesmo tempo.

### Correção

O schema passa a ser criado **uma vez**, na construção do store, sob
`pg_advisory_lock` — que é do banco, não da conexão, e por isso fecha as duas
janelas (dentro do processo e entre processos). A limpeza de sessão virou
sequencial como segunda linha de defesa; o custo é irrelevante numa operação
que só roda em logout, repareamento ou migração.

### Também nesta versão

- **whatsmeow:** a migration que troca `%40` por `@` em `contacts` colidia com
  a `UNIQUE(instance_id, jid)` quando a instância já tinha o contato na forma
  decodificada — o boot abortava em `log.Fatal` e o container entrava em loop
  de restart. Um `DELETE` anterior remove a linha codificada nesse caso.

### Testes

Regressão que afirma os **dois lados**: sem o lock a corrida acontece, com ele
não. Exige Postgres real e é pulada sem `ZAPO_TEST_PG_URL`, para o `pnpm test`
continuar rodando sem serviço externo (29 testes hermético, 31 com banco).

## 2.0.1

Correção de uma **capability desonesta** introduzida na `2.0.0`.

### Corrigido

- **`zapo` anunciava suporte a comunidades sem implementá-lo.** A engine
  declarava `capabilities.communities: true` mas não trazia nenhum método de
  comunidade, então `GET /instances/:id/capabilities` prometia o recurso e
  todas as rotas de `instances/:id/communities` respondiam `501`. Não chegava a
  ser um `500` — o guard do `CommunitiesService` tem uma checagem redundante
  (`|| !provider.listCommunities`) que segurava —, mas o contrato mentia, que é
  exatamente o que o desenho de capabilities existe para evitar.

### Comunidades na `zapo`

O contrato passou a ser implementado por inteiro (18 métodos), sobre o
coordenador de grupos da lib — ali uma comunidade é um grupo com
`isParentGroup`. Dois pontos em que a engine é **melhor** que as atuais:

- **Apagar de verdade.** `deactivateCommunity` desativa a comunidade. Nas
  demais engines `deleteCommunity` apenas _sai_ — o protocolo multi-device não
  expõe "apagar para todos" para elas. A `zapo` é a única que apaga.
- **Grupo de anúncios sem espera.** `fetchSubGroups` devolve `announcementGroup`
  direto, dispensando o descobrimento assíncrono com retentativas que o Baileys
  precisa. O webhook `communities.announcement.discovered` continua sendo
  emitido, para o contrato ficar idêntico entre engines.

`fetchSubGroups` é **MEX-gated**: sem transporte MEX ativo ele lança, e nesse
caso a comunidade é devolvida sem os jids de subgrupo em vez de falhar a
chamada inteira.

### Testes

- Nova checagem de regressão para a classe de bug acima: para **cada engine**,
  se uma capability é declarada `true`, o método que o `requireCapable` do
  módulo usa no gate **precisa existir**. Mais uma verificação de que a `zapo`
  implementa os 18 métodos de comunidade, e não só o do gate.
- Suíte passou de 8 para 29 testes.

## 2.0.0

Salto de geração: 47 commits desde a `1.1.0`. A superfície do produto mais que
dobrou — a Cloud API saiu de "texto e mídia" para paridade ampla, entraram Inbox,
painel de Logs e API keys com escopo, e a quinta engine chegou trazendo **chamada de voz de verdade**.

Nada foi removido da superfície REST: em compatibilidade estrita isto seria um
`minor`. O `major` é sinalização — a release cria **novas entidades de
persistência** (inbox, logs de atividade, API keys) e
**novas variáveis de ambiente**, então uma atualização em produção não é um
`docker compose pull` indiferente.

### Nova engine: `zapo`

- Quinta engine (`provider: "zapo"`), sobre a [`zapo-js`](https://zapo.to) —
  implementação independente do protocolo do WhatsApp Web, com API por
  coordenadores. Cobre mensagens, ações sobre mensagens, grupos, comunidades,
  canais, perfil, presença e bloqueio.
- **Troca de engine sem reparear agora cobre `baileys ⇄ whatsmeow ⇄ zapo`** nos
  dois sentidos, via o `PortableCredentials` que já existia — o caminho de
  migração sempre foi dirigido por capability, não por par fixo de engines.
- Persistência **própria** (a `zapo` não usa o `SessionStore` do gateway),
  apontada para o mesmo Postgres com prefixo `zapo_`.
- Botões, listas e PIX não têm builder na lib: respondem `422` uniforme em vez
  de fingir suporte.

### Chamadas de voz (VoIP)

- `instances/:id/calls`: ligar, atender, rejeitar, desligar, mutar, listar e
  **tocar um áudio** na chamada ativa.
- A mídia é terminada **dentro do gateway** (Opus do WhatsApp ↔ PCM 16 kHz
  mono) — diferente de `capabilities.calling` (Cloud), que só troca sinalização
  e delega a mídia a um WebRTC externo.
- Eventos `call.received`, `call.state`, `call.ended` e `call.audio_finished`.
- Gated por `capabilities.voiceCalls`; `voiceCallAudio` é gated à parte porque
  depende do **ffmpeg no PATH** (já incluso na imagem).
- Só áudio trafega: `isVideo` apenas marca a sinalização.

### Primeira suíte de testes automatizada

- Runner nativo do Node + `tsx`, sem framework extra. `pnpm test`.
- Sobe um **servidor WhatsApp falso em processo** (`@zapo-js/fake-server`) —
  roda sem conta, sem telefone e sem rede.
- A migração sem reparear é afirmada **no fio**: device novo manda
  `ClientPayload` de _registration_, device linkado manda de _login_. O teste
  exige login, `username`/`device` corretos e nenhum QR pedido.

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
- Comunidades, paridade de canais (whatsmeow + webjs), reagir/editar/apagar,
  localização, contato/vCard e Status/Stories.
- Documentação **OpenAPI** dos controllers e DTOs.

### Novas variáveis de ambiente

| Variável           | Padrão  | O que faz                                                                           |
| ------------------ | ------- | ----------------------------------------------------------------------------------- |
| `ZAPO_STORE_REDIS` | `false` | Move o estado Signal quente da `zapo` para o Redis (`auth`/`appState` ficam no PG). |
| `ZAPO_WAM_ENABLED` | `true`  | Telemetria de paridade com o WhatsApp Web (anti-fingerprint).                       |

### Notas de atualização

- `ZAPO_STORE_REDIS` fica **desligado** por padrão de propósito: o Redis do
  WAMux atende cargas descartáveis e pode rodar sem persistência ou com política
  de despejo. Só ligue num Redis com AOF/RDB e sem `maxmemory-policy` que
  despeje chaves.
- Chamadas de voz exigem o binário nativo do `@roamhq/wrtc`. Em host sem binário
  publicado para a plataforma a engine sobe com `voiceCalls: false` em vez de
  derrubar a API — confira `GET /instances/:id/capabilities`.
- A imagem da API cresceu: além do Chromium (webjs) agora traz **ffmpeg** e o
  **libvips** (via `sharp`).

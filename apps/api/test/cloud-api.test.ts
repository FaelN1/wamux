import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MessageAckStatus, MessageType, WebhookEvent } from '@wamux/shared';
import type { MessageStatusUpdate, NormalizedMessage } from '@wamux/shared';
import { CloudApiProvider } from '../src/providers/cloud/cloud-api.provider';
import { ProviderRequestError } from '../src/providers/provider.interface';
import type { WebhookPassthrough } from '../src/providers/provider.interface';
import { memoryCtx } from './helpers';

function setup() {
  const p = new CloudApiProvider(memoryCtx('cloud-1', { phoneNumberId: '111', wabaId: '222' }));
  const messages: NormalizedMessage[] = [];
  const statuses: MessageStatusUpdate[] = [];
  const hooks: WebhookPassthrough[] = [];
  p.on('message', (m) => messages.push(m));
  p.on('message.status', (s) => statuses.push(s));
  p.on('webhook', (w) => hooks.push(w));
  const deliver = (field: string, value: unknown) =>
    p.handleInboundWebhook({ entry: [{ changes: [{ field, value }] }] });
  return { p, messages, statuses, hooks, deliver };
}

/** Troca o client HTTP por um que só registra as chamadas. */
function capture(p: CloudApiProvider) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const ok = { data: { messages: [{ id: 'wamid.OUT' }] } };
  const client = {
    post: async (url: string, body?: unknown) => (calls.push({ method: 'POST', url, body }), ok),
    delete: async (url: string, cfg?: { data?: unknown }) => (
      calls.push({ method: 'DELETE', url, body: cfg?.data }),
      ok
    ),
  };
  (p as unknown as { http: unknown }).http = client;
  return calls;
}

describe('Cloud API — webhook de entrada (Graph v26)', () => {
  it('BSUID: sem `from`, usa from_user_id como chat e expõe identity/username', async () => {
    const t = setup();
    await t.deliver('messages', {
      contacts: [{ profile: { name: 'Ana', username: 'ana.silva' }, user_id: 'BR.1349120865530' }],
      messages: [
        {
          id: 'm1',
          from_user_id: 'BR.1349120865530',
          timestamp: '10',
          type: 'text',
          text: { body: 'oi' },
        },
      ],
    });
    const m = t.messages[0];
    assert.equal(m.chatId, 'BR.1349120865530');
    assert.equal(m.from, 'BR.1349120865530');
    assert.equal(m.pushName, 'Ana');
    assert.deepEqual(m.identity, {
      userId: 'BR.1349120865530',
      username: 'ana.silva',
      primary: 'pn',
    });
  });

  it('com telefone E BSUID: chat continua sendo o telefone (compatível)', async () => {
    const t = setup();
    await t.deliver('messages', {
      contacts: [{ profile: { name: 'Ana' }, wa_id: '5511999999999', user_id: 'BR.1349120865530' }],
      messages: [
        {
          id: 'm1',
          from: '5511999999999',
          from_user_id: 'BR.1349120865530',
          type: 'text',
          text: { body: 'oi' },
        },
      ],
    });
    assert.equal(t.messages[0].chatId, '5511999999999');
    assert.equal(t.messages[0].identity?.phone, '5511999999999');
    assert.equal(t.messages[0].identity?.userId, 'BR.1349120865530');
  });

  it('reply, encaminhada e referral de anúncio são normalizados', async () => {
    const t = setup();
    await t.deliver('messages', {
      messages: [
        {
          id: 'm2',
          from: '5511999999999',
          type: 'text',
          text: { body: 'quero' },
          context: { id: 'wamid.ORIG', from: '5511000000000', forwarded: true },
          referral: {
            source_url: 'https://fb.me/x',
            source_type: 'ad',
            headline: 'Promo',
            ctwa_clid: 'abc',
          },
        },
      ],
    });
    const m = t.messages[0];
    assert.equal(m.quotedMessageId, 'wamid.ORIG');
    assert.equal(m.forwarded, true);
    assert.deepEqual(m.referral, {
      sourceUrl: 'https://fb.me/x',
      sourceId: undefined,
      sourceType: 'ad',
      headline: 'Promo',
      body: undefined,
      mediaType: undefined,
      ctwaClid: 'abc',
    });
  });

  it('cliques: button_reply, list_reply e quick-reply de template carregam o id', async () => {
    const t = setup();
    await t.deliver('messages', {
      messages: [
        {
          id: 'a',
          from: '1',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'sim', title: 'Sim' } },
        },
        {
          id: 'b',
          from: '1',
          type: 'interactive',
          interactive: {
            type: 'list_reply',
            list_reply: { id: 'p1', title: 'Plano 1', description: 'd' },
          },
        },
        {
          id: 'c',
          from: '1',
          type: 'button',
          button: { text: 'Confirmar', payload: 'CONFIRMA_42' },
        },
      ],
    });
    assert.deepEqual(t.messages[0].interactiveReply, { type: 'button', id: 'sim', title: 'Sim' });
    assert.deepEqual(t.messages[1].interactiveReply, {
      type: 'list',
      id: 'p1',
      title: 'Plano 1',
      description: 'd',
    });
    assert.deepEqual(t.messages[2].interactiveReply, {
      type: 'template_button',
      id: 'CONFIRMA_42',
      title: 'Confirmar',
    });
    assert.equal(t.messages[2].text, 'Confirmar');
  });

  it('contatos, pedido, sistema, não suportado e legenda de vídeo/documento', async () => {
    const t = setup();
    await t.deliver('messages', {
      messages: [
        {
          id: '1',
          from: '1',
          type: 'contacts',
          contacts: [
            { name: { formatted_name: 'João' }, phones: [{ phone: '+55 11 9', wa_id: '55119' }] },
          ],
        },
        { id: '2', from: '1', type: 'order', order: { catalog_id: 'c', product_items: [] } },
        {
          id: '3',
          from: '1',
          type: 'system',
          system: { body: 'User changed number', type: 'user_changed_number' },
        },
        { id: '4', from: '1', type: 'unsupported', unsupported: { type: 'poll' } },
        {
          id: '5',
          from: '1',
          type: 'video',
          video: { id: 'v', mime_type: 'video/mp4', caption: 'olha' },
        },
      ],
    });
    assert.equal(t.messages[0].type, MessageType.CONTACT);
    assert.deepEqual(t.messages[0].contacts, [{ name: 'João', phones: ['55119'] }]);
    assert.equal(t.messages[1].type, MessageType.ORDER);
    assert.equal(t.messages[2].type, MessageType.SYSTEM);
    assert.equal(t.messages[2].text, 'User changed number');
    assert.equal(t.messages[3].type, MessageType.UNKNOWN);
    assert.match(t.messages[3].text ?? '', /poll/);
    assert.equal(t.messages[4].text, 'olha');
  });

  it('reação, exclusão e edição viram eventos próprios (não message.received)', async () => {
    const t = setup();
    await t.deliver('messages', {
      messages: [
        {
          id: 'r',
          from: '55',
          timestamp: '5',
          type: 'reaction',
          reaction: { message_id: 'wamid.A', emoji: '👍' },
        },
        { id: 'd', from: '55', type: 'revoke', revoke: { original_message_id: 'wamid.B' } },
        {
          id: 'e',
          from: '55',
          type: 'edit',
          edit: { original_message_id: 'wamid.C', message: { text: { body: 'novo' } } },
        },
      ],
    });
    assert.equal(t.messages.length, 0);
    assert.deepEqual(
      t.hooks.map((h) => h.event),
      [WebhookEvent.MESSAGE_REACTION, WebhookEvent.MESSAGE_DELETED, WebhookEvent.MESSAGE_EDITED],
    );
    assert.equal((t.hooks[0].payload as { messageId: string }).messageId, 'wamid.A');
    assert.equal((t.hooks[1].payload as { messageId: string }).messageId, 'wamid.B');
    assert.equal((t.hooks[2].payload as { text: string }).text, 'novo');
  });

  it('status: played não é rebaixado; pricing, callback e detalhe do erro são repassados', async () => {
    const t = setup();
    await t.deliver('messages', {
      statuses: [
        { id: 's1', status: 'played', recipient_id: '55', timestamp: '9' },
        {
          id: 's2',
          status: 'sent',
          recipient_user_id: 'BR.1349120865530',
          pricing: { pricing_model: 'PMP', category: 'utility', type: 'regular' },
          biz_opaque_callback_data: 'pedido-9',
        },
        {
          id: 's3',
          status: 'failed',
          recipient_id: '55',
          errors: [
            {
              code: 131047,
              title: 'Re-engagement',
              error_data: { details: 'fora da janela de 24h' },
            },
          ],
        },
        { id: 's4', status: 'algo_novo', recipient_id: '55' },
      ],
    });
    assert.equal(t.statuses.length, 3); // desconhecido é ignorado, não vira pending
    assert.equal(t.statuses[0].status, MessageAckStatus.PLAYED);
    assert.equal(t.statuses[1].chatId, 'BR.1349120865530');
    assert.deepEqual(t.statuses[1].pricing, {
      pricing_model: 'PMP',
      category: 'utility',
      type: 'regular',
    });
    assert.equal(t.statuses[1].callbackData, 'pedido-9');
    assert.equal(t.statuses[2].error?.code, 131047);
    assert.equal(t.statuses[2].error?.details, 'fora da janela de 24h');
  });

  it('uma mensagem malformada não derruba o resto do lote', async () => {
    const t = setup();
    await t.deliver('messages', {
      messages: [null, { id: 'ok', from: '1', type: 'text', text: { body: 'x' } }],
    });
    assert.equal(t.messages.length, 1);
  });

  it('campos de conta viram account.update com o nome do campo; eco de coexistência vira message.sent', async () => {
    const t = setup();
    await t.deliver('phone_number_quality_update', { event: 'FLAGGED', current_limit: 'TIER_1K' });
    await t.deliver('smb_message_echoes', {
      message_echoes: [
        {
          id: 'e1',
          from: '5511000000000',
          to: '5511999999999',
          type: 'text',
          text: { body: 'do app' },
        },
      ],
    });
    assert.equal(t.hooks[0].event, WebhookEvent.ACCOUNT_UPDATE);
    assert.deepEqual(t.hooks[0].payload, {
      field: 'phone_number_quality_update',
      value: { event: 'FLAGGED', current_limit: 'TIER_1K' },
    });
    assert.equal(t.hooks[1].event, WebhookEvent.MESSAGE_SENT);
    const echo = t.hooks[1].payload as NormalizedMessage;
    assert.equal(echo.fromMe, true);
    assert.equal(echo.chatId, '5511999999999');
  });
});

describe('Cloud API — envio', () => {
  it('telefone vai em `to` (só dígitos); BSUID vai intacto em `recipient`', async () => {
    const { p } = setup();
    const calls = capture(p);
    await p.sendText({ to: '+55 (11) 99999-9999', text: 'oi' });
    const r = await p.sendText({ to: 'BR.1349120865530', text: 'oi' });
    const [a, b] = calls.map((c) => c.body as Record<string, unknown>);
    assert.equal(a.to, '5511999999999');
    assert.equal('recipient' in a, false);
    assert.equal(b.recipient, 'BR.1349120865530');
    assert.equal('to' in b, false);
    assert.equal(r.to, 'BR.1349120865530');
    assert.equal(r.id, 'wamid.OUT');
  });

  it('bloqueio usa `user` (telefone) ou `user_id` (BSUID)', async () => {
    const { p } = setup();
    const calls = capture(p);
    await p.blockContact('5511999999999@s.whatsapp.net');
    await p.unblockContact('BR.1349120865530');
    assert.deepEqual((calls[0].body as { block_users: unknown }).block_users, [
      { user: '5511999999999' },
    ]);
    assert.deepEqual((calls[1].body as { block_users: unknown }).block_users, [
      { user_id: 'BR.1349120865530' },
    ]);
  });

  it('markRead: confirma cada id e põe o "digitando" só na última', async () => {
    const { p } = setup();
    const calls = capture(p);
    await p.markRead('55', ['m1', 'm2'], { typing: true });
    const bodies = calls.map((c) => c.body as Record<string, unknown>);
    assert.equal(bodies.length, 2);
    assert.equal('typing_indicator' in bodies[0], false);
    assert.deepEqual(bodies[1].typing_indicator, { type: 'text' });
  });
});

describe('Cloud API — erros da Graph viram erro canônico', () => {
  const graphError = (p: CloudApiProvider, e: unknown) =>
    (p as unknown as { graphError(e: unknown): Error }).graphError(e);
  const axiosErr = (status: number, error: unknown) => ({
    isAxiosError: true,
    message: 'Request failed',
    response: { status, data: { error } },
  });

  it('400 da Meta → 400 com code/subcode/detalhes preservados', () => {
    const { p } = setup();
    const e = graphError(
      p,
      axiosErr(400, {
        message: '(#131047) Re-engagement message',
        code: 131047,
        error_subcode: 2494010,
        error_data: { details: 'More than 24 hours' },
        fbtrace_id: 'T1',
      }),
    ) as ProviderRequestError;
    assert.ok(e instanceof ProviderRequestError);
    assert.equal(e.status, 400);
    assert.equal(e.code, 131047);
    assert.equal(e.details?.error_subcode, 2494010);
    assert.equal(e.details?.fbtrace_id, 'T1');
  });

  it('401/403 (token da instância) → 502; 429 → 429; 5xx e rede → 502', () => {
    const { p } = setup();
    const status = (e: unknown) => (graphError(p, e) as ProviderRequestError).status;
    assert.equal(status(axiosErr(401, { code: 190, message: 'token' })), 502);
    assert.equal(status(axiosErr(403, { code: 10 })), 502);
    assert.equal(status(axiosErr(429, { code: 130429 })), 429);
    assert.equal(status(axiosErr(500, { code: 1 })), 502);
    assert.equal(status({ isAxiosError: true, message: 'ECONNRESET' }), 502);
  });
});

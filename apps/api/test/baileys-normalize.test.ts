import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import type { WAMessage, proto } from 'baileys';
import { MessageType, WebhookEvent, type NormalizedMessage } from '@wamux/shared';
import { BaileysProvider } from '../src/providers/baileys/baileys.provider';
import { loadBaileys, type BaileysModule } from '../src/providers/baileys/baileys-runtime';
import {
  MapCacheStore,
  SentMessageStore,
  TtlLruCache,
} from '../src/providers/baileys/baileys-caches';
import { mapBaileysContent, vcardPhones } from '../src/providers/baileys/baileys-normalize';
import { memoryCtx } from './helpers';

/**
 * Normalização de mensagens RECEBIDAS pelo adapter Baileys e os caches de
 * retry. Nada aqui abre socket: o módulo ESM da lib é carregado só para usar o
 * `normalizeMessageContent`/`makeCacheableSignalKeyStore` de verdade, e as
 * mensagens são objetos `WAMessage` montados à mão.
 */

const CHAT = '5511999990000@s.whatsapp.net';

/** Acesso estreito aos membros privados exercitados aqui. */
interface Internals {
  B: BaileysModule;
  normalize(msg: WAMessage): NormalizedMessage | null;
}

let B: BaileysModule;
let provider: BaileysProvider;
let internals: Internals;

function wa(message: proto.IMessage, key: Partial<WAMessage['key']> = {}): WAMessage {
  return {
    key: { remoteJid: CHAT, id: 'MSG1', fromMe: false, ...key },
    messageTimestamp: 1_700_000_000,
    pushName: 'Fulano',
    message,
  } as WAMessage;
}

function normalize(message: proto.IMessage, key?: Partial<WAMessage['key']>): NormalizedMessage {
  const out = internals.normalize(wa(message, key));
  assert.ok(out, 'normalize devolveu null');
  return out;
}

before(async () => {
  B = await loadBaileys();
  provider = new BaileysProvider(memoryCtx('t-baileys-normalize'));
  internals = provider as unknown as Internals;
  internals.B = B; // o que `initialize()` faria, sem abrir socket
});

describe('baileys: normalize() de mensagens recebidas', () => {
  it('texto simples mantém o formato de antes', () => {
    const n = normalize({ conversation: 'oi' });
    assert.equal(n.type, MessageType.TEXT);
    assert.equal(n.text, 'oi');
    assert.equal(n.id, 'MSG1');
    assert.equal(n.chatId, CHAT);
    assert.equal(n.from, CHAT);
    assert.equal(n.isGroup, false);
    assert.equal(n.timestamp, 1_700_000_000);
    assert.equal(n.quotedMessageId, undefined);
    assert.equal(n.mentions, undefined);
    assert.equal(n.forwarded, undefined);
  });

  it('desembrulha ephemeralMessage (chat com mensagens temporárias)', () => {
    const message = {
      ephemeralMessage: { message: { extendedTextMessage: { text: 'some em 7 dias' } } },
    };
    const n = normalize(message);
    assert.equal(n.type, MessageType.TEXT);
    assert.equal(n.text, 'some em 7 dias');
    // o payload cru continua sendo o original, com o envelope
    assert.deepEqual((n.raw as WAMessage).message, message);
  });

  it('desembrulha viewOnce (V1 e V2) e mantém a legenda da imagem', () => {
    for (const wrapper of ['viewOnceMessage', 'viewOnceMessageV2'] as const) {
      const n = normalize({
        [wrapper]: {
          message: { imageMessage: { mimetype: 'image/jpeg', caption: 'só uma vez' } },
        },
      });
      assert.equal(n.type, MessageType.IMAGE, wrapper);
      assert.equal(n.text, 'só uma vez', wrapper);
      assert.deepEqual(n.media, { mimetype: 'image/jpeg', caption: 'só uma vez' }, wrapper);
    }
  });

  it('desembrulha documentWithCaptionMessage e expõe a legenda', () => {
    const n = normalize({
      documentWithCaptionMessage: {
        message: {
          documentMessage: {
            mimetype: 'application/pdf',
            fileName: 'boleto.pdf',
            caption: 'segue o boleto',
          },
        },
      },
    });
    assert.equal(n.type, MessageType.DOCUMENT);
    assert.equal(n.text, 'segue o boleto');
    assert.deepEqual(n.media, {
      mimetype: 'application/pdf',
      filename: 'boleto.pdf',
      caption: 'segue o boleto',
    });
  });

  it('envelopes aninhados (ephemeral → viewOnceV2) também saem', () => {
    const n = normalize({
      ephemeralMessage: {
        message: {
          viewOnceMessageV2: { message: { videoMessage: { mimetype: 'video/mp4' } } },
        },
      },
    });
    assert.equal(n.type, MessageType.VIDEO);
  });

  it('contato único → CONTACT + contacts (nome, telefone do waid, vCard)', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Maria Silva',
      'TEL;type=CELL;type=VOICE;waid=5511988887777:+55 11 98888-7777',
      'END:VCARD',
    ].join('\n');
    const n = normalize({ contactMessage: { displayName: 'Maria Silva', vcard } });
    assert.equal(n.type, MessageType.CONTACT);
    assert.deepEqual(n.contacts, [{ name: 'Maria Silva', phones: ['5511988887777'], vcard }]);
  });

  it('vários contatos → um item por contato', () => {
    const n = normalize({
      contactsArrayMessage: {
        displayName: '2 contatos',
        contacts: [
          { displayName: 'A', vcard: 'BEGIN:VCARD\r\nTEL:+55 11 1111-1111\r\nEND:VCARD' },
          { displayName: 'B' },
        ],
      },
    });
    assert.equal(n.type, MessageType.CONTACT);
    assert.equal(n.contacts?.length, 2);
    assert.deepEqual(n.contacts?.[0].phones, ['+55 11 1111-1111']);
    assert.deepEqual(n.contacts?.[1], { name: 'B' });
  });

  it('enquete (V1/V2/V3) → POLL com a pergunta como texto', () => {
    for (const k of [
      'pollCreationMessage',
      'pollCreationMessageV2',
      'pollCreationMessageV3',
    ] as const) {
      const n = normalize({
        [k]: { name: 'Pizza ou hambúrguer?', options: [{ optionName: 'Pizza' }] },
      });
      assert.equal(n.type, MessageType.POLL, k);
      assert.equal(n.text, 'Pizza ou hambúrguer?', k);
    }
  });

  it('resposta de lista → INTERACTIVE + interactiveReply', () => {
    const n = normalize({
      listResponseMessage: {
        title: 'Plano Pro',
        description: 'R$ 99/mês',
        singleSelectReply: { selectedRowId: 'plan_pro' },
        contextInfo: { stanzaId: 'LISTA1', participant: '5511000000000@s.whatsapp.net' },
      },
    });
    assert.equal(n.type, MessageType.INTERACTIVE);
    assert.equal(n.text, 'Plano Pro');
    assert.deepEqual(n.interactiveReply, {
      type: 'list',
      id: 'plan_pro',
      title: 'Plano Pro',
      description: 'R$ 99/mês',
    });
    assert.equal(n.quotedMessageId, 'LISTA1');
  });

  it('clique em botão e em quick-reply de template', () => {
    const btn = normalize({
      buttonsResponseMessage: { selectedButtonId: 'yes', selectedDisplayText: 'Sim' },
    });
    assert.equal(btn.type, MessageType.INTERACTIVE);
    assert.equal(btn.text, 'Sim');
    assert.deepEqual(btn.interactiveReply, { type: 'button', id: 'yes', title: 'Sim' });

    const tpl = normalize({
      templateButtonReplyMessage: { selectedId: 'stop', selectedDisplayText: 'Parar' },
    });
    assert.equal(tpl.type, MessageType.INTERACTIVE);
    assert.deepEqual(tpl.interactiveReply, { type: 'template_button', id: 'stop', title: 'Parar' });
  });

  it('reply com menções e encaminhada, vindos do contextInfo', () => {
    const n = normalize(
      {
        extendedTextMessage: {
          text: 'olha isso @5511777776666',
          contextInfo: {
            stanzaId: 'ORIG42',
            participant: '5511222223333@s.whatsapp.net',
            mentionedJid: ['5511777776666@s.whatsapp.net'],
            isForwarded: true,
            quotedMessage: { conversation: 'mensagem original' },
          },
        },
      },
      { remoteJid: '120363000000000000@g.us', participant: '5511444445555@s.whatsapp.net' },
    );
    assert.equal(n.type, MessageType.TEXT);
    assert.equal(n.text, 'olha isso @5511777776666');
    assert.equal(n.isGroup, true);
    assert.equal(n.from, '5511444445555@s.whatsapp.net');
    assert.equal(n.quotedMessageId, 'ORIG42');
    assert.equal(n.quotedParticipant, '5511222223333@s.whatsapp.net');
    assert.deepEqual(n.mentions, ['5511777776666@s.whatsapp.net']);
    assert.equal(n.forwarded, true);
  });

  it('contextInfo é lido mesmo dentro de envelope (imagem temporária citando outra)', () => {
    const n = normalize({
      ephemeralMessage: {
        message: {
          imageMessage: { mimetype: 'image/png', contextInfo: { stanzaId: 'Q1' } },
        },
      },
    });
    assert.equal(n.type, MessageType.IMAGE);
    assert.equal(n.quotedMessageId, 'Q1');
    assert.equal(n.quotedParticipant, undefined);
  });

  it('anúncio Click-to-WhatsApp → referral', () => {
    const n = normalize({
      extendedTextMessage: {
        text: 'Olá! Tenho interesse.',
        contextInfo: {
          externalAdReply: {
            title: 'Promoção de inverno',
            body: '50% off',
            mediaType: 2, // VIDEO
            sourceType: 'ad',
            sourceId: '120210000000000',
            sourceUrl: 'https://fb.me/abc',
            ctwaClid: 'CLID123',
          },
        },
      },
    });
    assert.deepEqual(n.referral, {
      sourceUrl: 'https://fb.me/abc',
      sourceId: '120210000000000',
      sourceType: 'ad',
      headline: 'Promoção de inverno',
      body: '50% off',
      mediaType: 'video',
      ctwaClid: 'CLID123',
    });
  });

  it('externalAdReply sem dado de origem (preview de link) não vira referral', () => {
    const n = normalize({
      extendedTextMessage: {
        text: 'veja',
        contextInfo: { externalAdReply: { title: 'Só um card', body: 'sem origem' } },
      },
    });
    assert.equal(n.referral, undefined);
  });

  it('metadados de transporte não são confundidos com o conteúdo', () => {
    const n = normalize({
      senderKeyDistributionMessage: { groupId: 'x' },
      messageContextInfo: { messageSecret: Buffer.from('s') },
      conversation: 'texto de grupo',
    });
    assert.equal(n.type, MessageType.TEXT);
    assert.equal(n.text, 'texto de grupo');
  });

  it('resposta de Flow continua com flowResponse', () => {
    const n = normalize({
      interactiveResponseMessage: {
        body: { text: 'Enviado' },
        nativeFlowResponseMessage: {
          name: 'flow',
          paramsJson: JSON.stringify({ flow_token: 'tok-1', nome: 'Ana' }),
        },
      },
    });
    assert.equal(n.type, MessageType.INTERACTIVE);
    assert.ok(n.flowResponse, 'flowResponse ausente');
  });

  it('conteúdo desconhecido segue como UNKNOWN; sem message → null', () => {
    assert.equal(normalize({ reactionMessage: { text: '👍' } }).type, MessageType.UNKNOWN);
    assert.equal(internals.normalize({ key: { remoteJid: CHAT, id: 'X' } } as WAMessage), null);
  });

  it('mapBaileysContent é puro: funciona sem a lib para conteúdo já desembrulhado', () => {
    const mapped = mapBaileysContent({
      locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: 'SP' },
    });
    assert.equal(mapped.type, MessageType.LOCATION);
    assert.deepEqual(mapped.location, { latitude: -23.5, longitude: -46.6, name: 'SP' });
  });

  it('vcardPhones: sem TEL → lista vazia; não duplica', () => {
    assert.deepEqual(vcardPhones(undefined), []);
    assert.deepEqual(vcardPhones('BEGIN:VCARD\nFN:X\nEND:VCARD'), []);
    assert.deepEqual(
      vcardPhones('item1.TEL;waid=5511900000000:+55 11 90000-0000\nTEL;waid=5511900000000:x'),
      ['5511900000000'],
    );
  });
});

describe('baileys: detecção de edição no messages.upsert', () => {
  /** Dispara o handler real de `messages.upsert` contra um socket falso. */
  function upsert(message: proto.IMessage): Array<{ event: string; payload: unknown }> {
    const p = new BaileysProvider(memoryCtx('t-baileys-edit'));
    const handlers = new Map<string, (arg: unknown) => void>();
    const priv = p as unknown as {
      B: BaileysModule;
      sock: unknown;
      registerHandlers(): void;
    };
    priv.B = B;
    priv.sock = {
      ev: { on: (name: string, fn: (arg: unknown) => void) => handlers.set(name, fn) },
    };
    priv.registerHandlers();

    const seen: Array<{ event: string; payload: unknown }> = [];
    p.on('webhook', (e: { event: string; payload: unknown }) =>
      seen.push({ event: e.event, payload: e.payload }),
    );
    p.on('message', (payload: unknown) => seen.push({ event: 'message', payload }));
    handlers.get('messages.upsert')?.({ type: 'notify', messages: [wa(message, { id: 'ENV1' })] });
    return seen;
  }

  const editOf = (text: string): proto.IMessage => ({
    protocolMessage: {
      key: { remoteJid: CHAT, id: 'ORIGINAL', fromMe: false },
      type: 14, // MESSAGE_EDIT
      editedMessage: { conversation: text },
    },
  });

  it('edição pura, embrulhada em editedMessage e em ephemeralMessage', () => {
    const shapes: proto.IMessage[] = [
      editOf('corrigido'),
      { editedMessage: { message: editOf('corrigido') } },
      { ephemeralMessage: { message: editOf('corrigido') } },
    ];
    for (const shape of shapes) {
      const seen = upsert(shape);
      assert.equal(seen.length, 1, JSON.stringify(seen));
      assert.equal(seen[0].event, WebhookEvent.MESSAGE_EDITED);
      const edit = seen[0].payload as { messageId: string; text: string };
      assert.equal(edit.messageId, 'ORIGINAL');
      assert.equal(edit.text, 'corrigido');
    }
  });

  it('mensagem normal embrulhada NÃO é tratada como edição', () => {
    const seen = upsert({ ephemeralMessage: { message: { conversation: 'oi' } } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].event, 'message');
    assert.equal((seen[0].payload as NormalizedMessage).text, 'oi');
  });
});

describe('baileys: SentMessageStore (getMessage do retry)', () => {
  it('hit devolve o conteúdo; miss devolve undefined (nunca mensagem vazia)', () => {
    const store = new SentMessageStore();
    const content = { conversation: 'oi' };
    store.remember('A1', content);
    assert.equal(store.get('A1'), content);
    assert.equal(store.get('NAO-EXISTE'), undefined);
    assert.equal(store.get(undefined), undefined);
    assert.equal(store.get(null), undefined);
  });

  it('ignora envio sem id ou sem conteúdo', () => {
    const store = new SentMessageStore();
    store.remember(undefined, { conversation: 'x' });
    store.remember('A1', undefined);
    assert.equal(store.size, 0);
  });

  it('forget remove (mensagem apagada para todos)', () => {
    const store = new SentMessageStore();
    store.remember('A1', { conversation: 'oi' });
    store.forget('A1');
    assert.equal(store.get('A1'), undefined);
  });

  it('expira pelo TTL', () => {
    let now = 1_000;
    const store = new SentMessageStore({ ttlMs: 100, now: () => now });
    store.remember('A1', { conversation: 'oi' });
    now += 99;
    assert.ok(store.get('A1'));
    now += 1; // ler não renova o TTL
    assert.equal(store.get('A1'), undefined);
    assert.equal(store.size, 0);
  });

  it('respeita o teto despejando a menos recentemente usada', () => {
    const store = new SentMessageStore({ maxEntries: 3 });
    store.remember('A', { conversation: 'a' });
    store.remember('B', { conversation: 'b' });
    store.remember('C', { conversation: 'c' });
    assert.ok(store.get('A')); // "toca" A → B vira a mais antiga
    store.remember('D', { conversation: 'd' });
    assert.equal(store.size, 3);
    assert.equal(store.get('B'), undefined);
    assert.ok(store.get('A'));
    assert.ok(store.get('C'));
    assert.ok(store.get('D'));
  });

  it('ao estourar o teto, tira primeiro o que já venceu', () => {
    let now = 0;
    const cache = new TtlLruCache<number>({ ttlMs: 10, maxEntries: 2, now: () => now });
    cache.set('velha', 1);
    now = 5;
    cache.set('nova', 2);
    now = 11; // "velha" venceu, "nova" não
    cache.set('novissima', 3);
    assert.equal(cache.size, 2);
    assert.equal(cache.get('nova'), 2);
    assert.equal(cache.get('novissima'), 3);
  });

  it('o provider guarda o que envia, serve via getMessage e esquece ao apagar', async () => {
    const p = new BaileysProvider(memoryCtx('t-baileys-sent'));
    const sentContent = { conversation: 'enviada' };
    const priv = p as unknown as {
      sock: unknown;
      sentMessages: SentMessageStore;
    };
    priv.sock = {
      sendMessage: async (_jid: string, content: { delete?: unknown }) =>
        content.delete
          ? { key: { id: 'REVOKE1' }, message: { protocolMessage: { type: 0 } } }
          : { key: { id: 'SENT1' }, message: sentContent },
    };

    const res = await p.sendText({ to: '5511999990000', text: 'enviada' });
    assert.equal(res.id, 'SENT1');
    assert.equal(priv.sentMessages.get('SENT1'), sentContent);

    await p.deleteMessage({ chatId: CHAT, messageId: 'SENT1' });
    assert.equal(priv.sentMessages.get('SENT1'), undefined);
  });
});

describe('baileys: caches do socket', () => {
  it('MapCacheStore atende a interface CacheStore (contador de retry)', () => {
    let now = 0;
    const cache = new MapCacheStore({ ttlMs: 50, maxEntries: 10, now: () => now });
    assert.equal(cache.get('k'), undefined);
    cache.set('k', 2);
    assert.equal(cache.get<number>('k'), 2);
    cache.del('k');
    assert.equal(cache.get('k'), undefined);
    cache.set('a', 1);
    cache.set('b', 1);
    cache.flushAll();
    assert.equal(cache.get('a'), undefined);
    cache.set('ttl', 1);
    now = 50;
    assert.equal(cache.get('ttl'), undefined);
  });

  it('makeCacheableSignalKeyStore: escritas e remoções continuam chegando ao store', async () => {
    const ctx = memoryCtx('t-baileys-keys');
    const { usePostgresAuthState } = await import('../src/providers/baileys/baileys-auth-state');
    const { state } = await usePostgresAuthState(ctx.instanceId, ctx.sessionStore);
    const keys = B.makeCacheableSignalKeyStore(
      state.keys,
      undefined,
      new MapCacheStore({ ttlMs: 60_000, maxEntries: 100 }),
    );

    await keys.set({
      'lid-mapping': { '5511999990000': '123456@lid' },
      'device-list': { '5511999990000': ['0', '12'] },
      tctoken: { [CHAT]: { token: Buffer.from('tok'), timestamp: '1700000000' } },
      'identity-key': { [`${CHAT}.0`]: Buffer.from('identity') },
    });
    for (const k of [
      'lid-mapping-5511999990000',
      'device-list-5511999990000',
      `tctoken-${CHAT}`,
      `identity-key-${CHAT}.0`,
    ]) {
      assert.ok(ctx.store.has(k), `${k} não chegou ao store`);
    }

    // leitura pelo wrapper (cache) e direto do store devolvem o mesmo valor
    const viaCache = await keys.get('lid-mapping', ['5511999990000']);
    const viaStore = await state.keys.get('lid-mapping', ['5511999990000']);
    assert.equal(viaCache['5511999990000'], '123456@lid');
    assert.deepEqual(viaCache, viaStore);

    // um wrapper NOVO (o que `initialize()` cria a cada reconexão) lê do store
    const fresh = B.makeCacheableSignalKeyStore(
      state.keys,
      undefined,
      new MapCacheStore({ ttlMs: 60_000, maxEntries: 100 }),
    );
    const identity = await fresh.get('identity-key', [`${CHAT}.0`]);
    assert.equal(Buffer.from(identity[`${CHAT}.0`]).toString(), 'identity');

    // remoção (valor null) apaga do store e some da leitura em cache
    await keys.set({ 'lid-mapping': { '5511999990000': null } });
    assert.equal(ctx.store.has('lid-mapping-5511999990000'), false);
    const afterDelete = await keys.get('lid-mapping', ['5511999990000']);
    assert.ok(!afterDelete['5511999990000']);
  });

  it('cachedGroupMetadata: busca 1x, serve do cache e invalida por evento de grupo', async () => {
    const p = new BaileysProvider(memoryCtx('t-baileys-groups'));
    const GROUP = '120363000000000000@g.us';
    let fetches = 0;
    const handlers = new Map<string, (arg: unknown) => void>();
    const priv = p as unknown as {
      B: BaileysModule;
      sock: unknown;
      registerHandlers(): void;
      cachedGroupMetadata(jid: string): Promise<{ id: string; rev: number } | undefined>;
    };
    priv.B = B;
    priv.sock = {
      ev: { on: (name: string, fn: (arg: unknown) => void) => handlers.set(name, fn) },
      groupMetadata: async (jid: string) => ({ id: jid, rev: ++fetches, participants: [] }),
    };
    priv.registerHandlers();

    // duas consultas concorrentes → uma busca só
    const [a, b] = await Promise.all([
      priv.cachedGroupMetadata(GROUP),
      priv.cachedGroupMetadata(GROUP),
    ]);
    assert.equal(fetches, 1);
    assert.equal(a?.rev, 1);
    assert.equal(b?.rev, 1);
    assert.equal((await priv.cachedGroupMetadata(GROUP))?.rev, 1);
    assert.equal(fetches, 1);

    handlers.get('group-participants.update')?.({ id: GROUP, participants: [], action: 'add' });
    assert.equal((await priv.cachedGroupMetadata(GROUP))?.rev, 2);

    handlers.get('groups.update')?.([{ id: GROUP, subject: 'novo nome' }]);
    assert.equal((await priv.cachedGroupMetadata(GROUP))?.rev, 3);

    // falha na busca → undefined (o Baileys segue o caminho normal dele), sem cachear
    priv.sock = {
      groupMetadata: async () => {
        throw new Error('forbidden');
      },
    };
    assert.equal(await priv.cachedGroupMetadata('120363999999999999@g.us'), undefined);
  });
});

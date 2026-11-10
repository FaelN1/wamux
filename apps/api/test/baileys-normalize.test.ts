import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import type { WAMessage, proto } from 'baileys';
import { MessageType, WebhookEvent, type NormalizedMessage } from '@wamux/shared';
import { BaileysProvider } from '../src/providers/baileys/baileys.provider';
import { loadBaileys, type BaileysModule } from '../src/providers/baileys/baileys-runtime';
import {
  MapCacheStore,
  RetryCounterStore,
  SentMessageStore,
  TtlLruCache,
} from '../src/providers/baileys/baileys-caches';
import { mapBaileysContent, vcardPhones } from '../src/providers/baileys/baileys-normalize';
import { memoryCache, memoryCtx } from './helpers';

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

describe('baileys: SentMessageStore com L2 (ProviderCache)', () => {
  /** Deixa as escritas disparadas sem await (write-through) assentarem. */
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  const codec = () => B.proto.Message;

  /** Mensagem com campos binários e Long — o que um JSON não preservaria. */
  const imageMessage = (): proto.IMessage => ({
    imageMessage: {
      url: 'https://mmg.whatsapp.net/v/t62/abc.enc',
      mimetype: 'image/jpeg',
      caption: 'foto',
      mediaKey: Buffer.from(
        '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
        'hex',
      ),
      fileSha256: Buffer.alloc(32, 0xab),
      fileEncSha256: Buffer.alloc(32, 0xcd),
      fileLength: 123_456,
      jpegThumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
    },
  });

  it('sobrevive a um "restart": outro store, mesmo cache, Buffers intactos', async () => {
    const cache = memoryCache();
    const original = imageMessage();
    const before = new SentMessageStore({ cache, ttlSec: 3600, codec });
    before.remember('IMG1', original);
    await settle();

    assert.equal(cache.ttls.get('sent:IMG1'), 3600);
    const raw = cache.data.get('sent:IMG1');
    assert.ok(raw);
    // protobuf em base64 — não JSON.
    assert.match(raw, /^[A-Za-z0-9+/]+=*$/);

    const after = new SentMessageStore({ cache, ttlSec: 3600, codec }); // processo novo
    assert.equal(after.get('IMG1'), undefined); // L1 vazio
    const restored = await after.fetch('IMG1');
    assert.ok(restored?.imageMessage);
    const img = restored.imageMessage;
    const src = original.imageMessage!;
    assert.ok(img.mediaKey instanceof Uint8Array);
    assert.deepEqual(Buffer.from(img.mediaKey), src.mediaKey);
    assert.deepEqual(Buffer.from(img.fileSha256!), src.fileSha256);
    assert.deepEqual(Buffer.from(img.fileEncSha256!), src.fileEncSha256);
    assert.deepEqual(Buffer.from(img.jpegThumbnail!), src.jpegThumbnail);
    assert.equal(Number(img.fileLength), 123_456);
    assert.equal(img.caption, 'foto');
    assert.equal(img.url, src.url);
    // Reencodar o que voltou dá os mesmos bytes do original.
    assert.deepEqual(
      Buffer.from(B.proto.Message.encode(restored).finish()),
      Buffer.from(B.proto.Message.encode(original).finish()),
    );
    // O hit de L2 aquece o L1.
    assert.equal(after.get('IMG1'), restored);
  });

  it('miss nos dois níveis devolve undefined', async () => {
    const store = new SentMessageStore({ cache: memoryCache(), ttlSec: 60, codec });
    assert.equal(await store.fetch('NAO-EXISTE'), undefined);
    assert.equal(await store.fetch(undefined), undefined);
    assert.equal(await store.fetch(null), undefined);
  });

  it('forget apaga também do L2 (mesmo sem estar no L1)', async () => {
    const cache = memoryCache();
    const a = new SentMessageStore({ cache, ttlSec: 60, codec });
    a.remember('A1', { conversation: 'oi' });
    a.remember('A2', { conversation: 'fica' });
    await settle();
    assert.ok(cache.data.has('sent:A1'));

    const b = new SentMessageStore({ cache, ttlSec: 60, codec }); // após restart
    b.forget('A1');
    await settle();
    assert.equal(cache.data.has('sent:A1'), false);
    assert.equal(await b.fetch('A1'), undefined);
    assert.equal(await a.fetch('A1'), a.get('A1')); // `a` ainda tem no L1 dele…
    a.forget('A1');
    assert.equal(await a.fetch('A1'), undefined); // …até esquecer também
    assert.equal((await b.fetch('A2'))?.conversation, 'fica');
  });

  it('remember seguido de forget não deixa resíduo no L2', async () => {
    const cache = memoryCache();
    const store = new SentMessageStore({ cache, ttlSec: 60, codec });
    store.remember('A1', { conversation: 'oi' });
    store.forget('A1'); // sem esperar a escrita assentar
    await settle();
    assert.equal(cache.data.has('sent:A1'), false);
    assert.equal(await store.fetch('A1'), undefined);
  });

  it('clear esvazia só o prefixo do store no L2', async () => {
    const cache = memoryCache();
    cache.data.set('retry:X', '2');
    const store = new SentMessageStore({ cache, ttlSec: 60, codec });
    store.remember('A1', { conversation: 'oi' });
    await settle();
    store.clear();
    await settle();
    assert.deepEqual([...cache.data.keys()], ['retry:X']);
    assert.equal(await store.fetch('A1'), undefined);
  });

  it('cache.get rejeitando → undefined, sem exceção, e o erro é reportado', async () => {
    const cache = memoryCache();
    const errors: string[] = [];
    const store = new SentMessageStore({
      cache,
      ttlSec: 60,
      codec,
      onError: (op) => errors.push(op),
    });
    cache.failing = true;
    assert.equal(await store.fetch('A1'), undefined);
    assert.deepEqual(errors, ['get']);
  });

  it('cache.set/del rejeitando (ou lançando) não quebra o envio; L1 continua servindo', async () => {
    const cache = memoryCache();
    cache.failing = true;
    const errors: string[] = [];
    const store = new SentMessageStore({
      cache,
      ttlSec: 60,
      codec,
      onError: (op) => errors.push(op),
    });
    const content = { conversation: 'oi' };
    assert.doesNotThrow(() => store.remember('A1', content));
    assert.equal(await store.fetch('A1'), content);
    assert.doesNotThrow(() => store.forget('A1'));
    await settle();
    assert.deepEqual(errors, ['set', 'del']);

    const sync = new SentMessageStore({
      cache: {
        get: () => {
          throw new Error('síncrono');
        },
        set: () => {
          throw new Error('síncrono');
        },
        del: () => {
          throw new Error('síncrono');
        },
        clear: () => {
          throw new Error('síncrono');
        },
      },
      ttlSec: 60,
      codec,
    });
    assert.doesNotThrow(() => sync.remember('B1', content));
    assert.doesNotThrow(() => sync.forget('B1'));
    assert.doesNotThrow(() => sync.clear());
    assert.equal(await sync.fetch('B1'), undefined);
  });

  it('leitura de L2 que não responde estoura o timeout e vira miss', async () => {
    const cache = memoryCache();
    cache.get = () => new Promise<string | null>(() => undefined); // nunca resolve
    const store = new SentMessageStore({ cache, ttlSec: 60, codec, readTimeoutMs: 10 });
    assert.equal(await store.fetch('A1'), undefined);
  });

  it('payload ilegível ou vazio no L2 → undefined (nunca mensagem vazia)', async () => {
    const cache = memoryCache();
    cache.data.set('sent:LIXO', Buffer.from([0xff, 0xff, 0xff, 0xff, 0x01]).toString('base64'));
    cache.data.set('sent:VAZIO', '');
    cache.data.set(
      'sent:NADA',
      Buffer.from(B.proto.Message.encode({}).finish()).toString('base64'),
    );
    const store = new SentMessageStore({ cache, ttlSec: 60, codec });
    assert.equal(await store.fetch('LIXO'), undefined);
    assert.equal(await store.fetch('VAZIO'), undefined);
    assert.equal(await store.fetch('NADA'), undefined);
  });

  it('TTL 0 → nada é escrito nem lido do L2 (só memória)', async () => {
    const cache = memoryCache();
    cache.data.set(
      'sent:PRE',
      Buffer.from(B.proto.Message.encode({ conversation: 'x' }).finish()).toString('base64'),
    );
    const store = new SentMessageStore({ cache, ttlSec: 0, codec });
    const content = { conversation: 'oi' };
    store.remember('A1', content);
    await settle();
    assert.equal(cache.data.has('sent:A1'), false);
    assert.equal(await store.fetch('A1'), content);
    assert.equal(await store.fetch('PRE'), undefined);
    store.forget('A1');
    store.clear();
    await settle();
    assert.equal(cache.data.has('sent:PRE'), true);
  });

  it('sem codec (lib ainda não carregada) fica só em memória', async () => {
    const cache = memoryCache();
    const store = new SentMessageStore({ cache, ttlSec: 60, codec: () => undefined });
    const content = { conversation: 'oi' };
    store.remember('A1', content);
    await settle();
    assert.equal(cache.data.size, 0);
    assert.equal(await store.fetch('A1'), content);
    assert.equal(await store.fetch('OUTRA'), undefined);
  });

  it('o provider persiste via ctx.cache e um provider novo responde ao getMessage', async () => {
    const cache = memoryCache();
    const ctx = () => ({
      ...memoryCtx('t-baileys-l2', { baileysRetryCacheTtlSec: 120 }),
      cache,
    });
    type Priv = { sock: unknown; B: BaileysModule; sentMessages: SentMessageStore };
    const first = new BaileysProvider(ctx());
    const p1 = first as unknown as Priv;
    p1.B = B;
    const content = imageMessage();
    p1.sock = {
      sendMessage: async (_jid: string, c: { delete?: unknown }) =>
        c.delete
          ? { key: { id: 'REVOKE2' }, message: { protocolMessage: { type: 0 } } }
          : { key: { id: 'SENT2' }, message: content },
    };
    await first.sendText({ to: '5511999990000', text: 'x' });
    await settle();
    assert.equal(cache.ttls.get('sent:SENT2'), 120);

    const second = new BaileysProvider(ctx()); // "outro worker"
    const p2 = second as unknown as Priv;
    p2.B = B;
    p2.sock = p1.sock;
    const restored = await p2.sentMessages.fetch('SENT2');
    assert.deepEqual(
      Buffer.from(restored!.imageMessage!.mediaKey!),
      content.imageMessage!.mediaKey,
    );

    await second.deleteMessage({ chatId: CHAT, messageId: 'SENT2' });
    await settle();
    assert.equal(cache.data.has('sent:SENT2'), false);
  });

  it('o provider com TTL 0 (ou sem config) não escreve no cache', async () => {
    for (const config of [{ baileysRetryCacheTtlSec: 0 }, {}]) {
      const cache = memoryCache();
      const p = new BaileysProvider({ ...memoryCtx('t-baileys-l2-off', config), cache });
      const priv = p as unknown as { sock: unknown; B: BaileysModule };
      priv.B = B;
      priv.sock = {
        sendMessage: async () => ({ key: { id: 'SENT3' }, message: { conversation: 'x' } }),
      };
      await p.sendText({ to: '5511999990000', text: 'x' });
      await settle();
      assert.equal(cache.data.size, 0);
    }
  });
});

describe('baileys: RetryCounterStore (contador de retry com L2)', () => {
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  const opts = { ttlMs: 60_000, maxEntries: 10 };

  it('o contador atravessa um "restart" e o del/flushAll limpam o L2', async () => {
    const cache = memoryCache();
    const a = new RetryCounterStore({ ...opts, cache, ttlSec: 3600 });
    a.set('MSG:5511@s.whatsapp.net', 3);
    a.set('OUTRA:x', 1);
    await settle();
    assert.equal(cache.data.get('retry:MSG:5511@s.whatsapp.net'), '3');
    assert.equal(cache.ttls.get('retry:MSG:5511@s.whatsapp.net'), 3600);

    const b = new RetryCounterStore({ ...opts, cache, ttlSec: 3600 });
    assert.equal(await b.get<number>('MSG:5511@s.whatsapp.net'), 3);
    assert.equal(await b.get<number>('NAO-EXISTE'), undefined);
    b.del('MSG:5511@s.whatsapp.net');
    await settle();
    assert.equal(cache.data.has('retry:MSG:5511@s.whatsapp.net'), false);

    cache.data.set('sent:FICA', 'x');
    b.flushAll();
    await settle();
    assert.deepEqual([...cache.data.keys()], ['sent:FICA']);
  });

  it('Redis fora → conta só em memória, sem exceção', async () => {
    const cache = memoryCache();
    cache.failing = true;
    const store = new RetryCounterStore({ ...opts, cache, ttlSec: 3600 });
    assert.equal(await store.get<number>('K'), undefined);
    assert.doesNotThrow(() => store.set('K', 2));
    assert.equal(await store.get<number>('K'), 2);
    assert.doesNotThrow(() => store.del('K'));
    assert.doesNotThrow(() => store.flushAll());
    await settle();
  });

  it('sem cache ou com TTL 0 não toca no L2', async () => {
    const cache = memoryCache();
    const store = new RetryCounterStore({ ...opts, cache, ttlSec: 0 });
    store.set('K', 1);
    await settle();
    assert.equal(cache.data.size, 0);
    assert.equal(await store.get<number>('K'), 1);
    const bare = new RetryCounterStore(opts);
    bare.set('K', 4);
    assert.equal(await bare.get<number>('K'), 4);
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

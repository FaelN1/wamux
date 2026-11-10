import { strict as assert } from 'node:assert';
import {
  constants,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { describe, it } from 'node:test';
import { MessageType, WebhookEvent } from '@wamux/shared';
import type { NormalizedMessage } from '@wamux/shared';
import { CloudApiProvider } from '../src/providers/cloud/cloud-api.provider';
import { WhatsmeowProvider } from '../src/providers/whatsmeow/whatsmeow.provider';
import { generateFlowKeyPair } from '../src/providers/cloud/flow-endpoint-crypto';
import { parseNfmReply } from '../src/providers/flow-response.util';
import { FlowTokenInvalidError } from '../src/providers/provider.interface';
import type { WebhookPassthrough } from '../src/providers/provider.interface';
import { signSha256 } from '../src/providers/webhook-signature.util';
import { memoryCtx } from './helpers';

const keys = generateFlowKeyPair();

/** Lado da Meta: cifra a requisição e sabe ler a resposta. */
function meta(body: unknown) {
  const aesKey = randomBytes(16);
  const iv = randomBytes(16);
  const c = createCipheriv('aes-128-gcm', aesKey, iv);
  const data = Buffer.concat([c.update(JSON.stringify(body)), c.final(), c.getAuthTag()]);
  const request = {
    encrypted_flow_data: data.toString('base64'),
    encrypted_aes_key: publicEncrypt(
      { key: keys.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      aesKey,
    ).toString('base64'),
    initial_vector: iv.toString('base64'),
  };
  const read = (b64: string): unknown => {
    const buf = Buffer.from(b64, 'base64');
    const d = createDecipheriv('aes-128-gcm', aesKey, Buffer.from(iv.map((b) => ~b & 0xff)));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return JSON.parse(
      Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString(),
    );
  };
  return { request, read };
}

function cloud(config: Record<string, unknown> = {}, withKey = true) {
  const ctx = memoryCtx('cloud-1', config);
  if (withKey) ctx.store.set('flow_private_key', keys.privateKey);
  return new CloudApiProvider(ctx);
}

const noExchange = {
  onExchange: async () => {
    throw new Error('não deveria chamar o integrador');
  },
};

describe('Flows — endpoint de troca de dados (Data API)', () => {
  it('ping: responde status active sem consultar o integrador', async () => {
    const m = meta({ version: '3.0', action: 'ping' });
    const out = await cloud().handleFlowEndpoint({ body: m.request, headers: {} }, noExchange);
    assert.equal(out.status, 200);
    assert.deepEqual(m.read(out.body), { data: { status: 'active' } });
  });

  it('data_exchange: entrega o payload decifrado e cifra a resposta do integrador', async () => {
    const m = meta({
      version: '3.0',
      action: 'data_exchange',
      screen: 'AGENDA',
      data: { dia: '12' },
      flow_token: 'tok-9',
    });
    let seen: unknown;
    const out = await cloud().handleFlowEndpoint(
      { body: m.request, headers: {} },
      {
        onExchange: async (r) => {
          seen = r;
          return { screen: 'CONFIRMA', data: { ok: true } };
        },
      },
    );
    assert.deepEqual(seen, {
      version: '3.0',
      action: 'data_exchange',
      screen: 'AGENDA',
      data: { dia: '12' },
      flowToken: 'tok-9',
    });
    assert.equal(out.status, 200);
    assert.deepEqual(m.read(out.body), { screen: 'CONFIRMA', data: { ok: true } });
  });

  it('notificação de erro do cliente: registra e responde acknowledged', async () => {
    const m = meta({
      version: '3.0',
      action: 'data_exchange',
      flow_token: 'tok-9',
      data: { error: 'INVALID_SCREEN_TRANSITION', error_message: 'x' },
    });
    let reported: unknown;
    const out = await cloud().handleFlowEndpoint(
      { body: m.request, headers: {} },
      { ...noExchange, onClientError: async (t, e) => void (reported = { t, e }) },
    );
    assert.deepEqual(m.read(out.body), { data: { acknowledged: true } });
    assert.deepEqual(reported, {
      t: 'tok-9',
      e: { error: 'INVALID_SCREEN_TRANSITION', error_message: 'x' },
    });
  });

  it('flow_token inválido → 427', async () => {
    const m = meta({ action: 'INIT', flow_token: 'velho' });
    const out = await cloud().handleFlowEndpoint(
      { body: m.request, headers: {} },
      {
        onExchange: async () => {
          throw new FlowTokenInvalidError('Sessão expirada');
        },
      },
    );
    assert.equal(out.status, 427);
  });

  it('não decifrável (chave trocada) → 421; sem chave privada → 421', async () => {
    const m = meta({ action: 'ping' });
    const ctx = memoryCtx('cloud-2');
    ctx.store.set('flow_private_key', generateFlowKeyPair().privateKey);
    const other = new CloudApiProvider(ctx);
    assert.equal(
      (await other.handleFlowEndpoint({ body: m.request, headers: {} }, noExchange)).status,
      421,
    );
    assert.equal(
      (await cloud({}, false).handleFlowEndpoint({ body: m.request, headers: {} }, noExchange))
        .status,
      421,
    );
  });

  it('com appSecret: assinatura ausente/errada → 432; correta → 200', async () => {
    const m = meta({ action: 'ping' });
    const raw = Buffer.from(JSON.stringify(m.request));
    const p = cloud({ appSecret: 'sec' });
    assert.equal(
      (await p.handleFlowEndpoint({ body: m.request, headers: {}, rawBody: raw }, noExchange))
        .status,
      432,
    );
    const ok = await p.handleFlowEndpoint(
      { body: m.request, headers: { 'x-hub-signature-256': signSha256('sec', raw) }, rawBody: raw },
      noExchange,
    );
    assert.equal(ok.status, 200);
  });

  it('corpo fora do envelope cifrado → 400', async () => {
    const out = await cloud().handleFlowEndpoint({ body: { foo: 1 }, headers: {} }, noExchange);
    assert.equal(out.status, 400);
  });
});

describe('Flows — resposta (nfm_reply) normalizada', () => {
  it('parse: extrai flow_token e dados; JSON inválido não quebra', () => {
    assert.deepEqual(
      parseNfmReply({
        name: 'flow',
        body: 'Sent',
        response_json: '{"flow_token":"t1","idade":"30"}',
      }),
      { name: 'flow', body: 'Sent', data: { flow_token: 't1', idade: '30' }, flowToken: 't1' },
    );
    assert.deepEqual(parseNfmReply({ response_json: '{oops' }).data, {});
    assert.deepEqual(parseNfmReply({ response_json: '[1,2]' }).data, {});
  });

  it('cloud: webhook messages com interactive.nfm_reply vira flowResponse', async () => {
    const p = cloud();
    const got: NormalizedMessage[] = [];
    p.on('message', (m) => got.push(m));
    await p.handleInboundWebhook({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                contacts: [{ profile: { name: 'Maria' } }],
                messages: [
                  {
                    id: 'wamid.X',
                    from: '5511999999999',
                    timestamp: '1700000000',
                    type: 'interactive',
                    interactive: {
                      type: 'nfm_reply',
                      nfm_reply: {
                        name: 'flow',
                        body: 'Sent',
                        response_json: '{"flow_token":"tok-1","nome":"Maria"}',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(got.length, 1);
    assert.equal(got[0].type, MessageType.INTERACTIVE);
    assert.equal(got[0].flowResponse?.flowToken, 'tok-1');
    assert.deepEqual(got[0].flowResponse?.data, { flow_token: 'tok-1', nome: 'Maria' });
  });

  it('cloud: webhook field `flows` vira flow.status_update', async () => {
    const p = cloud();
    const got: WebhookPassthrough[] = [];
    p.on('webhook', (w) => got.push(w));
    const value = {
      event: 'FLOW_STATUS_CHANGE',
      flow_id: '1',
      old_status: 'DRAFT',
      new_status: 'PUBLISHED',
    };
    await p.handleInboundWebhook({ entry: [{ changes: [{ field: 'flows', value }] }] });
    assert.equal(got[0].event, WebhookEvent.FLOW_STATUS_UPDATE);
    assert.deepEqual(got[0].payload, value);
  });

  it('whatsmeow: MESSAGE com flow_response do sidecar vira flowResponse', async () => {
    const p = new WhatsmeowProvider(memoryCtx('w1'));
    const got: NormalizedMessage[] = [];
    p.on('message', (m) => got.push(m));
    await p.handleInboundWebhook({
      event: 'MESSAGE',
      data: {
        message_id: 'ABC',
        from: '5511999999999@s.whatsapp.net',
        chat: '5511999999999@s.whatsapp.net',
        type: 'interactive',
        flow_response: {
          name: 'flow',
          params_json: '{"flow_token":"tok-2","ok":true}',
          body: 'Enviado',
        },
      },
    });
    assert.equal(got[0].type, MessageType.INTERACTIVE);
    assert.equal(got[0].text, 'Enviado');
    assert.equal(got[0].flowResponse?.flowToken, 'tok-2');
  });
});

describe('Flows — conteúdo do Flow JSON', () => {
  it('sem asset de Flow JSON devolve null (não tenta baixar)', async () => {
    const p = cloud({ wabaId: '222' });
    (p as unknown as { mgmt: unknown }).mgmt = { get: async () => ({ data: { data: [] } }) };
    assert.equal(await p.getFlowJson('123'), null);
  });
});

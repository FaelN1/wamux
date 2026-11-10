import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CloudApiProvider } from '../src/providers/cloud/cloud-api.provider';
import { WhatsmeowProvider } from '../src/providers/whatsmeow/whatsmeow.provider';
import { signSha256, verifySha256Signature } from '../src/providers/webhook-signature.util';
import { memoryCtx } from './helpers';

const body = Buffer.from(JSON.stringify({ entry: [{ changes: [] }] }));

describe('assinatura HMAC dos webhooks de entrada', () => {
  it('util: aceita a assinatura correta e rejeita corpo/segredo/formato diferentes', () => {
    const sig = signSha256('s3cr3t', body);
    assert.match(sig, /^sha256=[0-9a-f]{64}$/);
    assert.equal(verifySha256Signature('s3cr3t', body, sig), true);
    assert.equal(verifySha256Signature('outro', body, sig), false);
    assert.equal(verifySha256Signature('s3cr3t', Buffer.from('{}'), sig), false);
    assert.equal(verifySha256Signature('s3cr3t', body, undefined), false);
    assert.equal(verifySha256Signature('s3cr3t', undefined, sig), false);
    assert.equal(verifySha256Signature('s3cr3t', body, 'sha256=00'), false);
  });

  it('cloud: com appSecret exige X-Hub-Signature-256 válido', () => {
    const p = new CloudApiProvider(memoryCtx('c1', { appSecret: 'app-secret' }));
    const good = { 'x-hub-signature-256': signSha256('app-secret', body) };
    assert.equal(p.verifyInboundWebhook({ headers: good, rawBody: body }), true);
    assert.equal(p.verifyInboundWebhook({ headers: {}, rawBody: body }), false);
    assert.equal(
      p.verifyInboundWebhook({
        headers: { 'x-hub-signature-256': signSha256('errado', body) },
        rawBody: body,
      }),
      false,
    );
    // corpo adulterado depois de assinado
    assert.equal(p.verifyInboundWebhook({ headers: good, rawBody: Buffer.from('{"x":1}') }), false);
  });

  it('cloud: sem appSecret não há como validar — aceita (compatibilidade), só avisa', () => {
    const p = new CloudApiProvider(memoryCtx('c2'));
    assert.equal(p.verifyInboundWebhook({ headers: {}, rawBody: body }), true);
  });

  it('whatsmeow: exige X-Wamux-Signature assinado com a master key do sidecar', () => {
    const p = new WhatsmeowProvider(memoryCtx('w1', { whatsmeowMasterKey: 'master' }));
    const good = { 'x-wamux-signature': signSha256('master', body) };
    assert.equal(p.verifyInboundWebhook({ headers: good, rawBody: body }), true);
    assert.equal(p.verifyInboundWebhook({ headers: {}, rawBody: body }), false);
    assert.equal(
      p.verifyInboundWebhook({
        headers: { 'x-wamux-signature': signSha256('x', body) },
        rawBody: body,
      }),
      false,
    );
  });

  it('whatsmeow: requireSignature=false tolera AUSÊNCIA do header, nunca assinatura errada', () => {
    const p = new WhatsmeowProvider(
      memoryCtx('w2', { whatsmeowMasterKey: 'master', whatsmeowRequireSignature: false }),
    );
    assert.equal(p.verifyInboundWebhook({ headers: {}, rawBody: body }), true);
    assert.equal(
      p.verifyInboundWebhook({
        headers: { 'x-wamux-signature': signSha256('x', body) },
        rawBody: body,
      }),
      false,
    );
  });
});

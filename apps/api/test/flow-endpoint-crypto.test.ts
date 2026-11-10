import { strict as assert } from 'node:assert';
import {
  constants,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { describe, it } from 'node:test';
import {
  FlowDecryptionError,
  decryptFlowRequest,
  encryptFlowResponse,
  generateFlowKeyPair,
  isEncryptedFlowRequest,
  publicKeyFromPrivate,
} from '../src/providers/cloud/flow-endpoint-crypto';

/** Simula o lado da Meta: cifra com a chave PÚBLICA do negócio, como o cliente WhatsApp faz. */
function metaEncrypt(publicKey: string, body: unknown) {
  const aesKey = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(body), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    aesKey,
    iv,
    request: {
      encrypted_flow_data: data.toString('base64'),
      encrypted_aes_key: publicEncrypt(
        { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        aesKey,
      ).toString('base64'),
      initial_vector: iv.toString('base64'),
    },
  };
}

/** Simula o lado da Meta lendo a resposta: mesma chave, IV invertido, tag no final. */
function metaDecrypt(b64: string, aesKey: Buffer, iv: Buffer): unknown {
  const buf = Buffer.from(b64, 'base64');
  const decipher = createDecipheriv('aes-128-gcm', aesKey, Buffer.from(iv.map((b) => ~b & 0xff)));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(
    Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString(),
  );
}

describe('criptografia do endpoint de Flows (Data API)', () => {
  const keys = generateFlowKeyPair();

  it('decifra a requisição e cifra a resposta de forma legível pela Meta', () => {
    const payload = {
      version: '3.0',
      action: 'data_exchange',
      screen: 'AGENDA',
      data: { dia: '2026-11-12', obs: 'ação com acento' },
      flow_token: 'tok-1',
    };
    const { request, aesKey, iv } = metaEncrypt(keys.publicKey, payload);
    assert.equal(isEncryptedFlowRequest(request), true);

    const dec = decryptFlowRequest(request, keys.privateKey);
    assert.deepEqual(dec.body, payload);

    const response = { screen: 'CONFIRMA', data: { ok: true } };
    assert.deepEqual(
      metaDecrypt(encryptFlowResponse(response, dec.aesKey, dec.iv), aesKey, iv),
      response,
    );
  });

  it('chave privada errada → FlowDecryptionError (endpoint responde 421)', () => {
    const { request } = metaEncrypt(keys.publicKey, { action: 'ping' });
    assert.throws(
      () => decryptFlowRequest(request, generateFlowKeyPair().privateKey),
      FlowDecryptionError,
    );
  });

  it('payload adulterado (tag GCM inválida) → FlowDecryptionError', () => {
    const { request } = metaEncrypt(keys.publicKey, { action: 'ping' });
    const data = Buffer.from(request.encrypted_flow_data, 'base64');
    data[0] ^= 0xff;
    assert.throws(
      () =>
        decryptFlowRequest(
          { ...request, encrypted_flow_data: data.toString('base64') },
          keys.privateKey,
        ),
      FlowDecryptionError,
    );
  });

  it('deriva a chave pública a partir da privada', () => {
    assert.equal(publicKeyFromPrivate(keys.privateKey).trim(), keys.publicKey.trim());
    assert.throws(() => publicKeyFromPrivate('não é uma chave'));
  });

  it('corpo fora do envelope cifrado não é reconhecido', () => {
    assert.equal(isEncryptedFlowRequest({ encrypted_flow_data: 'x' }), false);
    assert.equal(isEncryptedFlowRequest(null), false);
  });
});

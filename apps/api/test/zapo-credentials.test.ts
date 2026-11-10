import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import type { WaAuthCredentials } from 'zapo-js';
import { fromPortable, toPortable } from '../src/providers/zapo/zapo-credentials';
import type { PortableCredentials } from '../src/providers/provider.types';

/**
 * Ponte de credenciais do zapo ⇄ formato canônico do WAMux.
 *
 * É o que sustenta a troca de engine sem reparear (baileys ⇄ whatsmeow ⇄
 * zapo). Os tamanhos abaixo não são arbitrários: são o que Baileys e whatsmeow
 * gravam — chave pública Curve25519 de 32 bytes CRUS (sem o byte de tipo
 * `0x05`, que só entra na serialização do protocolo) e assinatura de 64.
 */

const b64 = (n: number) => randomBytes(n).toString('base64');

function makePortable(): PortableCredentials {
  return {
    version: 1,
    registrationId: 12345,
    noiseKey: { public: b64(32), private: b64(32) },
    identityKey: { public: b64(32), private: b64(32) },
    signedPreKey: {
      keyId: 7,
      keyPair: { public: b64(32), private: b64(32) },
      signature: b64(64),
    },
    advSecretKey: b64(32),
    account: {
      details: b64(20),
      accountSignatureKey: b64(32),
      accountSignature: b64(64),
      deviceSignature: b64(64),
    },
    me: { id: '5511999999999:12@s.whatsapp.net', lid: '99887766554433:12@lid', name: 'QA WAMux' },
    platform: 'android',
  };
}

describe('credenciais portáveis do zapo', () => {
  it('faz round-trip canônico → zapo → canônico sem perder nada', () => {
    const original = makePortable();
    const volta = toPortable(fromPortable(original));
    assert.deepEqual(volta, original);
  });

  it('produz chaves com os tamanhos que as outras engines esperam', () => {
    const wa = fromPortable(makePortable());
    assert.equal(wa.noiseKeyPair.pubKey.length, 32);
    assert.equal(wa.noiseKeyPair.privKey.length, 32);
    assert.equal(wa.registrationInfo.identityKeyPair.pubKey.length, 32);
    assert.equal(wa.signedPreKey.keyPair.pubKey.length, 32);
    assert.equal(wa.signedPreKey.signature.length, 64);
    assert.equal(wa.advSecretKey.length, 32);
  });

  it('marca a signedPreKey importada como já publicada', () => {
    // Ela JÁ foi registrada no servidor pelo device linkado — re-subir uma
    // chave que o servidor conhece é o caminho para um erro difícil de achar.
    assert.equal(fromPortable(makePortable()).signedPreKey.uploaded, true);
  });

  it('normaliza chave pública de 33 bytes (com prefixo 0x05) para 32', () => {
    const p = makePortable();
    const cru = Buffer.from(p.identityKey.public, 'base64');
    p.identityKey.public = Buffer.concat([Buffer.from([0x05]), cru]).toString('base64');

    const pub = fromPortable(p).registrationInfo.identityKeyPair.pubKey;
    assert.equal(pub.length, 32, 'o prefixo de tipo precisa ser removido');
    assert.deepEqual(Buffer.from(pub), cru, 'os 32 bytes de chave precisam sobreviver');
  });

  it('preserva a identidade da conta (jid, lid, nome, plataforma)', () => {
    const wa = fromPortable(makePortable());
    assert.equal(wa.meJid, '5511999999999:12@s.whatsapp.net');
    assert.equal(wa.meLid, '99887766554433:12@lid');
    assert.equal(wa.meDisplayName, 'QA WAMux');
    assert.equal(wa.platform, 'android');
  });

  it('recusa exportar sessão sem ADVSignedDeviceIdentity', () => {
    // Sem a prova assinada pelo servidor não há device linkado para migrar —
    // falhar aqui é melhor do que exportar credencial que não conecta.
    const semProva = { ...fromPortable(makePortable()), signedIdentity: undefined };
    assert.throws(
      () => toPortable(semProva as WaAuthCredentials),
      /não pareada|ADVSignedDeviceIdentity/,
    );
  });
});

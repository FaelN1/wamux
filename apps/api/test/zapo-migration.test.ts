import { strict as assert } from 'node:assert';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { FakeWaServer } from '@zapo-js/fake-server';
import { createNoopLogger, createStore, WaClient, type WaStore } from 'zapo-js';
import { importZapoCreds } from '../src/providers/zapo/zapo-credentials';
import type { PortableCredentials } from '../src/providers/provider.types';

/**
 * Migração de engine SEM reparear, verificada contra o `@zapo-js/fake-server` —
 * um servidor WhatsApp de verdade em processo (Noise, Signal, app-state), sem
 * conta nem telefone envolvidos.
 *
 * O que garante a migração é o cliente entrar como um device JÁ LINKADO em vez
 * de pedir QR. Isso é observável no fio: um device novo manda um `ClientPayload`
 * de **registration** (com `devicePairingData`), um device linkado manda um de
 * **login** (com `username`/`device`). É exatamente essa diferença que o teste
 * afirma — não um proxy indireto dela.
 */

const JID_CONTA = '5511999999999:3@s.whatsapp.net';
const TELEFONE = '5511999999999';
const DEVICE_ID = 3;

/**
 * Par X25519 gerado pelo `crypto` do Node (via JWK, que já entrega os 32 bytes
 * crus em base64url). Usar o gerador do próprio Node em vez do `zapo-js/crypto`
 * mantém o teste fora dos internals da lib — e o subpath `zapo-js/crypto` não
 * resolve sob o `moduleResolution: "node"` do tsconfig do Nest.
 */
function parDeChaves(): { public: string; private: string } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const pub = publicKey.export({ format: 'jwk' }) as { x: string };
  const priv = privateKey.export({ format: 'jwk' }) as { d: string };
  const deBase64Url = (s: string) => Buffer.from(s, 'base64url').toString('base64');
  return { public: deBase64Url(pub.x), private: deBase64Url(priv.d) };
}

/**
 * Credenciais canônicas com chaves X25519 REAIS — o handshake Noise deriva um
 * segredo compartilhado da chave de ruído, então bytes aleatórios não passam
 * do handshake e o teste não provaria nada.
 */
function credenciaisPortaveis(): PortableCredentials {
  return {
    version: 1,
    registrationId: 4242,
    noiseKey: parDeChaves(),
    identityKey: parDeChaves(),
    signedPreKey: {
      keyId: 1,
      keyPair: parDeChaves(),
      signature: randomBytes(64).toString('base64'),
    },
    advSecretKey: randomBytes(32).toString('base64'),
    account: {
      details: randomBytes(20).toString('base64'),
      accountSignatureKey: randomBytes(32).toString('base64'),
      accountSignature: randomBytes(64).toString('base64'),
      deviceSignature: randomBytes(64).toString('base64'),
    },
    me: { id: JID_CONTA, lid: '11223344556677:3@lid', name: 'QA WAMux' },
    platform: 'android',
  };
}

describe('migração de engine sem reparear (contra o fake-server)', () => {
  let server: FakeWaServer;
  let store: WaStore;
  let payloadVisto: { kind: string; username?: string; device?: number } | null = null;

  before(async () => {
    server = await FakeWaServer.start({
      // Roda logo após a autenticação, com o ClientPayload em mãos — é onde
      // dá para observar se o cliente entrou como login ou como registro.
      sessionKey: (info: { clientPayload: typeof payloadVisto }) => {
        payloadVisto = info.clientPayload;
        return 'unica';
      },
    });
    store = createStore({});
  });

  after(async () => {
    await server.stop();
  });

  it('entra como device já linkado, sem pedir QR', async () => {
    const portable = credenciaisPortaveis();

    // É o mesmo caminho que `ZapoProvider.importCredentials` usa quando o
    // manager migra a instância de outra engine.
    await importZapoCreds(store, 'migrada', portable);

    let pediuQr = false;
    const client = new WaClient(
      {
        store,
        sessionId: 'migrada',
        chatSocketUrls: [server.url],
        testHooks: { noiseRootCa: server.noiseRootCa },
      } as never,
      createNoopLogger(),
    );
    client.on('auth_qr', () => {
      pediuQr = true;
    });

    await client.connect();
    await server.waitForAuthenticatedPipeline(15_000);

    assert.equal(payloadVisto?.kind, 'login', 'device linkado precisa logar, não se registrar');
    assert.equal(payloadVisto?.username, TELEFONE, 'o telefone vem do jid importado');
    assert.equal(payloadVisto?.device, DEVICE_ID, 'o id do device precisa sobreviver à migração');
    assert.equal(pediuQr, false, 'migrar sem reparear significa NENHUM QR');

    // A identidade que o cliente assume é a que importamos.
    assert.equal(client.getCredentials()?.meJid, JID_CONTA);

    await client.disconnect();
  });

  it('não vaza credencial entre sessões diferentes do mesmo store', async () => {
    // Isolamento por `sessionId` (= instanceId) é o que permite um único
    // WaStore para todas as instâncias do processo.
    const outra = await store.session('nunca-pareada').auth.load();
    assert.equal(outra, null);
  });
});

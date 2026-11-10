import type { WaAuthCredentials, WaStore } from 'zapo-js';
import { PortableCredentials } from '../provider.types';

/**
 * Ponte entre o formato canônico do WAMux (`PortableCredentials`, em base64) e
 * o `WaAuthCredentials` do zapo (Uint8Array) — é o que permite trocar de
 * engine (baileys ↔ whatsmeow ↔ zapo) SEM reparear o aparelho.
 *
 * Só a IDENTIDADE do device viaja (mesma semântica do Baileys e do whatsmeow):
 * chave Noise, par de identidade Signal, signedPreKey, advSecretKey e o
 * `ADVSignedDeviceIdentity` — a prova, assinada pelo servidor, de que este
 * device está linkado. As sessões Signal com cada contato NÃO viajam; elas se
 * re-handshakeiam sozinhas na primeira mensagem trocada com cada peer.
 *
 * Convenção de chave pública: tanto o Baileys quanto o zapo guardam os 32
 * bytes CRUS e só prefixam o byte de tipo `0x05` na hora de serializar para o
 * protocolo. Como o `PortableCredentials` transporta o que a engine de origem
 * gravou, uma chave de 33 bytes pode aparecer — `toRaw32` normaliza os dois
 * casos para evitar um par de chaves inválido (que quebraria o handshake com
 * um erro de assinatura difícil de diagnosticar).
 */

const b64 = (x: Uint8Array): string => Buffer.from(x).toString('base64');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64');

/** Remove o prefixo `0x05` quando presente — chaves públicas Curve25519 têm 32 bytes. */
function toRaw32(key: Uint8Array): Uint8Array {
  return key.length === 33 && key[0] === 0x05 ? key.subarray(1) : key;
}

/** Converte as credenciais do zapo para o formato canônico portável. */
export function toPortable(c: WaAuthCredentials): PortableCredentials {
  const account = c.signedIdentity;
  if (!account?.details || !account.accountSignatureKey || !account.accountSignature) {
    throw new Error('zapo: sessão sem ADVSignedDeviceIdentity (instância não pareada?)');
  }

  return {
    version: 1,
    registrationId: c.registrationInfo.registrationId,
    noiseKey: {
      public: b64(toRaw32(c.noiseKeyPair.pubKey)),
      private: b64(c.noiseKeyPair.privKey),
    },
    identityKey: {
      public: b64(toRaw32(c.registrationInfo.identityKeyPair.pubKey)),
      private: b64(c.registrationInfo.identityKeyPair.privKey),
    },
    signedPreKey: {
      keyId: c.signedPreKey.keyId,
      keyPair: {
        public: b64(toRaw32(c.signedPreKey.keyPair.pubKey)),
        private: b64(c.signedPreKey.keyPair.privKey),
      },
      signature: b64(c.signedPreKey.signature),
    },
    advSecretKey: b64(c.advSecretKey),
    account: {
      details: b64(account.details),
      accountSignatureKey: b64(account.accountSignatureKey),
      accountSignature: b64(account.accountSignature),
      // O whatsmeow/Baileys sempre têm deviceSignature; o zapo pode omitir em
      // sessões hospedadas — cai para vazio em vez de quebrar o export.
      deviceSignature: account.deviceSignature ? b64(account.deviceSignature) : '',
    },
    me: {
      id: c.meJid ?? '',
      lid: c.meLid,
      name: c.meDisplayName ?? c.pushName,
    },
    platform: c.platform,
  };
}

/** Converte credenciais canônicas para o formato do zapo. */
export function fromPortable(p: PortableCredentials): WaAuthCredentials {
  return {
    noiseKeyPair: {
      pubKey: toRaw32(unb64(p.noiseKey.public)),
      privKey: unb64(p.noiseKey.private),
    },
    registrationInfo: {
      registrationId: p.registrationId,
      identityKeyPair: {
        pubKey: toRaw32(unb64(p.identityKey.public)),
        privKey: unb64(p.identityKey.private),
      },
    },
    signedPreKey: {
      keyId: p.signedPreKey.keyId,
      keyPair: {
        pubKey: toRaw32(unb64(p.signedPreKey.keyPair.public)),
        privKey: unb64(p.signedPreKey.keyPair.private),
      },
      signature: unb64(p.signedPreKey.signature),
      // A signedPreKey importada JÁ está publicada no servidor (foi ela que o
      // device linkado registrou) — marcar como enviada evita que o zapo
      // tente re-subir uma chave que o servidor já conhece.
      uploaded: true,
    },
    advSecretKey: unb64(p.advSecretKey),
    signedIdentity: {
      details: unb64(p.account.details),
      accountSignatureKey: unb64(p.account.accountSignatureKey),
      accountSignature: unb64(p.account.accountSignature),
      ...(p.account.deviceSignature ? { deviceSignature: unb64(p.account.deviceSignature) } : {}),
    },
    meJid: p.me.id || undefined,
    meLid: p.me.lid,
    meDisplayName: p.me.name,
    platform: p.platform,
  };
}

/**
 * Zera todos os domínios persistidos de uma sessão. O `WaStoreSession` não tem
 * um `clear()` agregado (só `destroy()`, que inutiliza o bundle) — a limpeza é
 * por domínio.
 */
export async function clearZapoSession(store: WaStore, sessionId: string): Promise<void> {
  const s = store.session(sessionId);
  // SEQUENCIAL de propósito. Cada `BasePgStore` memoiza a migração no próprio
  // objeto e os domínios se sobrepõem (`signal` atende 4 stores, `mailbox` 3),
  // então limpar tudo em paralelo num banco ainda sem schema dispara
  // `CREATE TABLE IF NOT EXISTS` concorrentes para as mesmas tabelas — que o
  // Postgres rejeita com violação de `pg_type_typname_nsp_index`.
  // `ensureSchema` já fecha essa janela na criação do store; manter a limpeza
  // serializada é a segunda linha de defesa, e o custo é irrelevante numa
  // operação que só roda em logout/repareamento/migração.
  const domains = [
    s.auth,
    s.signal,
    s.preKey,
    s.session,
    s.identity,
    s.senderKey,
    s.appState,
    s.privacyToken,
    s.messages,
    s.threads,
    s.contacts,
    s.retry,
    s.groupMetadata,
    s.deviceList,
    s.messageSecret,
  ];
  for (const domain of domains) await domain.clear();
}

/**
 * Grava as credenciais canônicas no store do zapo, zerando o estado Signal
 * anterior — o device passa a ser o já linkado, sem QR.
 */
export async function importZapoCreds(
  store: WaStore,
  sessionId: string,
  p: PortableCredentials,
): Promise<void> {
  // Limpa o estado da sessão antiga antes de assumir outra identidade: manter
  // sessões Signal de OUTRO device produziria falhas de decriptação silenciosas.
  await clearZapoSession(store, sessionId);
  await store.session(sessionId).auth.save(fromPortable(p));
}

/** Lê as credenciais persistidas do zapo (null quando não há sessão pareada). */
export async function loadZapoCreds(
  store: WaStore,
  sessionId: string,
): Promise<WaAuthCredentials | null> {
  return (await store.session(sessionId).auth.load()) ?? null;
}

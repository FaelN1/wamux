import type { AuthenticationState, SignalDataTypeMap } from 'baileys';
import { loadBaileys } from './baileys-runtime';
import { PortableCredentials, SessionStore } from '../provider.types';

// O Baileys guarda ALGUNS campos como Buffer ({type:'Buffer'}) e outros já como
// string base64 (ex.: os campos do `account`/ADVSignedDeviceIdentity vêm do
// proto toJSON como base64 string). `toB64` normaliza os dois casos — passar
// b64() cru numa string re-codificava (double-encode) e quebrava o tamanho.
const toB64 = (x: unknown): string =>
  typeof x === 'string' ? x : Buffer.from(x as Uint8Array).toString('base64');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64');
const kpOut = (k: { public: unknown; private: unknown }) => ({
  public: toB64(k.public),
  private: toB64(k.private),
});
const kpIn = (k: { public: string; private: string }) => ({
  public: unb64(k.public),
  private: unb64(k.private),
});

/**
 * Auth state do Baileys persistido no nosso `SessionStore` (Postgres).
 * Equivale ao `useMultiFileAuthState`, gravando cada chave (creds + signal keys,
 * incluindo as novas da v7: lid-mapping, device-list, tctoken) por instância.
 */
export async function usePostgresAuthState(
  instanceId: string,
  store: SessionStore,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const { BufferJSON, initAuthCreds, proto } = await loadBaileys();

  const readData = async (key: string): Promise<unknown> => {
    const raw = await store.get(instanceId, key);
    return raw ? JSON.parse(raw, BufferJSON.reviver) : null;
  };
  const writeData = async (key: string, value: unknown): Promise<void> => {
    await store.set(instanceId, key, JSON.stringify(value, BufferJSON.replacer));
  };
  const removeData = async (key: string): Promise<void> => {
    await store.remove(instanceId, key);
  };

  const creds = ((await readData('creds')) as AuthenticationState['creds']) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result: Record<string, unknown> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.create(value as object);
              }
              result[id] = value;
            }),
          );
          return result as { [id: string]: SignalDataTypeMap[typeof type] };
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          const bag = data as Record<string, Record<string, unknown> | undefined>;
          for (const category of Object.keys(bag)) {
            const catData = bag[category];
            if (!catData) continue;
            for (const id of Object.keys(catData)) {
              const value = catData[id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData('creds', creds),
  };
}

/**
 * Exporta as credenciais do device (Multi-Device) do Baileys para o formato
 * canônico portável (`PortableCredentials`) — usado para migrar de engine.
 */
export async function exportBaileysCreds(
  store: SessionStore,
  instanceId: string,
): Promise<PortableCredentials> {
  const { BufferJSON } = await loadBaileys();
  const raw = await store.get(instanceId, 'creds');
  if (!raw) throw new Error('Baileys: sem credenciais para exportar (instância não pareada?)');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = JSON.parse(raw, BufferJSON.reviver);
  return {
    version: 1,
    registrationId: c.registrationId,
    noiseKey: kpOut(c.noiseKey),
    identityKey: kpOut(c.signedIdentityKey),
    signedPreKey: {
      keyId: c.signedPreKey.keyId,
      keyPair: kpOut(c.signedPreKey.keyPair),
      signature: toB64(c.signedPreKey.signature),
    },
    advSecretKey: c.advSecretKey,
    account: {
      details: toB64(c.account.details),
      accountSignatureKey: toB64(c.account.accountSignatureKey),
      accountSignature: toB64(c.account.accountSignature),
      deviceSignature: toB64(c.account.deviceSignature),
    },
    me: c.me,
    signalIdentities: (c.signalIdentities ?? []).map(
      (si: { identifier: { name: string; deviceId: number }; identifierKey: unknown }) => ({
        identifier: si.identifier,
        identifierKey: toB64(si.identifierKey),
      }),
    ),
    platform: c.platform,
  };
}

/**
 * Importa credenciais canônicas para o Baileys — o device passa a ser aquele
 * já linkado (sem QR). Mantém só a IDENTIDADE; as sessões Signal re-sincronizam.
 */
export async function importBaileysCreds(
  store: SessionStore,
  instanceId: string,
  p: PortableCredentials,
): Promise<void> {
  const { initAuthCreds, BufferJSON, proto } = await loadBaileys();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const creds: any = initAuthCreds();
  creds.registrationId = p.registrationId;
  creds.noiseKey = kpIn(p.noiseKey);
  creds.signedIdentityKey = kpIn(p.identityKey);
  creds.signedPreKey = {
    keyPair: kpIn(p.signedPreKey.keyPair),
    signature: unb64(p.signedPreKey.signature),
    keyId: p.signedPreKey.keyId,
  };
  creds.advSecretKey = p.advSecretKey;
  // account como proto (formato nativo do Baileys — serializa igual ao original).
  creds.account = proto.ADVSignedDeviceIdentity.create({
    details: unb64(p.account.details),
    accountSignatureKey: unb64(p.account.accountSignatureKey),
    accountSignature: unb64(p.account.accountSignature),
    deviceSignature: unb64(p.account.deviceSignature),
  });
  creds.me = p.me;
  creds.signalIdentities = (p.signalIdentities ?? []).map((si) => ({
    identifier: si.identifier,
    identifierKey: unb64(si.identifierKey),
  }));
  if (p.platform) creds.platform = p.platform;
  creds.registered = true;

  await store.clear(instanceId);
  await store.set(instanceId, 'creds', JSON.stringify(creds, BufferJSON.replacer));
}

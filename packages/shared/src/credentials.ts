/** Par de chaves (Curve25519), binários em base64. */
export interface B64KeyPair {
  public: string;
  private: string;
}

/**
 * Identidade de "aparelho companheiro" (WhatsApp Multi-Device), **portável
 * entre engines que implementam o protocolo** (Baileys ⇄ whatsmeow). Permite
 * trocar de engine mantendo o device linkado — sem reescanear o QR.
 *
 * NÃO se aplica ao `webjs` (sessão de navegador/IndexedDB, não extraível) nem à
 * `cloud` (API oficial, sem device/QR). Todos os binários são base64.
 *
 * ⚠️ Experimental: migra a IDENTIDADE do device (mantém linkado). As sessões
 * Signal por contato re-sincronizam depois. Migração é sempre SEQUENCIAL
 * (parar origem → exportar → importar → iniciar destino) — nunca as duas juntas.
 */
export interface PortableCredentials {
  version: 1;
  registrationId: number;
  noiseKey: B64KeyPair;
  /** Baileys: `signedIdentityKey`; whatsmeow: `IdentityKey`. */
  identityKey: B64KeyPair;
  signedPreKey: { keyId: number; keyPair: B64KeyPair; signature: string };
  /** Segredo de registro do companheiro (base64). */
  advSecretKey: string;
  /** ADVSignedDeviceIdentity — a prova, assinada pelo servidor, de que o device
   *  está linkado. Campos em base64. */
  account: {
    details: string;
    accountSignatureKey: string;
    accountSignature: string;
    deviceSignature: string;
  };
  me: { id: string; lid?: string; name?: string };
  signalIdentities?: {
    identifier: { name: string; deviceId: number };
    identifierKey: string;
  }[];
  platform?: string;
}

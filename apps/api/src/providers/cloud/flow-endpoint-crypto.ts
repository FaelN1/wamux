import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
} from 'node:crypto';

/**
 * Criptografia do endpoint de troca de dados dos WhatsApp Flows (Data API).
 *
 * Requisição da Meta: `{ encrypted_flow_data, encrypted_aes_key, initial_vector }`
 * (tudo base64).
 *  - a chave AES vem cifrada com a chave PÚBLICA do negócio: RSA-OAEP, MGF1 e
 *    hash SHA-256;
 *  - o payload é AES-GCM (128 bits) com a tag de 16 bytes ANEXADA ao final.
 * Resposta: mesmo AES-GCM, mesma chave, IV com todos os bits INVERTIDOS,
 * devolvida como base64 em texto puro.
 */

const TAG_LENGTH = 16;

export interface EncryptedFlowRequest {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

export interface DecryptedFlowRequest {
  /** payload JSON já decifrado (version, action, screen, data, flow_token…). */
  body: Record<string, unknown>;
  aesKey: Buffer;
  iv: Buffer;
}

/** Falha ao decifrar — o endpoint deve responder HTTP 421 (a Meta rebaixa a chave pública). */
export class FlowDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowDecryptionError';
  }
}

export function isEncryptedFlowRequest(v: unknown): v is EncryptedFlowRequest {
  const o = v as Partial<EncryptedFlowRequest> | null;
  return (
    !!o &&
    typeof o.encrypted_flow_data === 'string' &&
    typeof o.encrypted_aes_key === 'string' &&
    typeof o.initial_vector === 'string'
  );
}

export function decryptFlowRequest(
  req: EncryptedFlowRequest,
  privateKeyPem: string,
  passphrase?: string,
): DecryptedFlowRequest {
  let aesKey: Buffer;
  try {
    aesKey = privateDecrypt(
      {
        key: createPrivateKey({ key: privateKeyPem, passphrase }),
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(req.encrypted_aes_key, 'base64'),
    );
  } catch (e) {
    throw new FlowDecryptionError(`chave AES não decifrável: ${(e as Error).message}`);
  }

  const data = Buffer.from(req.encrypted_flow_data, 'base64');
  const iv = Buffer.from(req.initial_vector, 'base64');
  if (data.length <= TAG_LENGTH) throw new FlowDecryptionError('payload cifrado curto demais');

  try {
    const decipher = createDecipheriv(algorithmFor(aesKey), aesKey, iv);
    decipher.setAuthTag(data.subarray(data.length - TAG_LENGTH));
    const plain = Buffer.concat([
      decipher.update(data.subarray(0, data.length - TAG_LENGTH)),
      decipher.final(),
    ]).toString('utf8');
    return { body: JSON.parse(plain) as Record<string, unknown>, aesKey, iv };
  } catch (e) {
    throw new FlowDecryptionError(`payload não decifrável: ${(e as Error).message}`);
  }
}

/** Cifra a resposta com a MESMA chave AES e o IV invertido (bitwise NOT). */
export function encryptFlowResponse(response: unknown, aesKey: Buffer, iv: Buffer): string {
  const flipped = Buffer.from(iv.map((b) => ~b & 0xff));
  const cipher = createCipheriv(algorithmFor(aesKey), aesKey, flipped);
  return Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}

function algorithmFor(key: Buffer): 'aes-128-gcm' | 'aes-256-gcm' {
  if (key.length === 16) return 'aes-128-gcm';
  if (key.length === 32) return 'aes-256-gcm';
  throw new FlowDecryptionError(`tamanho de chave AES inesperado: ${key.length} bytes`);
}

/** Par RSA-2048 em PEM (privada PKCS#8, pública SPKI) — o formato que a Meta aceita. */
export function generateFlowKeyPair(): { privateKey: string; publicKey: string } {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

/** Deriva a pública (SPKI/PEM) de uma privada informada pelo cliente. Lança se a chave for inválida. */
export function publicKeyFromPrivate(privateKeyPem: string, passphrase?: string): string {
  const priv = createPrivateKey({ key: privateKeyPem, passphrase });
  if (priv.asymmetricKeyType !== 'rsa') throw new Error('a chave privada precisa ser RSA');
  return createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString();
}

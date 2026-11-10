import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura HMAC-SHA256 no formato `sha256=<hex>` — o mesmo que a Meta usa no
 * header `X-Hub-Signature-256` e que o sidecar whatsmeow usa em
 * `X-Wamux-Signature`. Sempre calculada sobre o corpo CRU (bytes recebidos),
 * nunca sobre o JSON re-serializado.
 */
export function signSha256(secret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** Comparação em tempo constante. `false` para header ausente/malformado. */
export function verifySha256Signature(
  secret: string,
  rawBody: Buffer | string | undefined,
  header: string | string[] | undefined,
): boolean {
  const received = Array.isArray(header) ? header[0] : header;
  if (!secret || rawBody == null || !received) return false;
  const expected = Buffer.from(signSha256(secret, rawBody));
  const got = Buffer.from(received.trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

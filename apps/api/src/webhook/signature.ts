import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-wamux-signature';

/** Assina o corpo cru: v1 = HMAC_SHA256(secret, `${t}.${rawBody}`). Estilo Stripe. */
export function signWebhook(secret: string, rawBody: string, tSeconds: number): string {
  const v1 = createHmac('sha256', secret).update(`${tSeconds}.${rawBody}`).digest('hex');
  return `t=${tSeconds},v1=${v1}`;
}

/** Verifica header + corpo cru contra o segredo (comparação em tempo constante). */
export function verifyWebhook(
  secret: string,
  rawBody: string,
  header: string,
  toleranceSec = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=').map((s) => s.trim()) as [string, string]),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false; // anti-replay
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type StripeSignatureResult =
  | { ok: true; event: { id: string; type: string; object: Record<string, unknown> | null } }
  | { ok: false; reason: 'missing' | 'format' | 'timestamp' | 'signature' };

/** Ereignisse, nach denen der Stripe-Abgleich sofort läuft. */
export const STRIPE_SYNC_EVENTS: ReadonlySet<string> = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
]);

/** Prüft den Stripe-Signature-Header (`t=…,v1=…[,v1=…]`): HMAC-SHA256 über `${t}.${rawBody}`, Zeitfenster, konstante Vergleichszeit. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec: number, toleranceSec = 300): StripeSignatureResult {
  if (!header) return { ok: false, reason: 'missing' };
  let t: string | undefined;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') sigs.push(v);
  }
  const ts = t !== undefined && /^\d+$/.test(t) ? Number(t) : NaN;
  if (!Number.isSafeInteger(ts) || sigs.length === 0) return { ok: false, reason: 'format' };
  if (Math.abs(nowSec - ts) > toleranceSec) return { ok: false, reason: 'timestamp' };
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const match = sigs.map((s) => (/^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : null)).some((b) => b !== null && b.length === expected.length && timingSafeEqual(b, expected));
  if (!match) return { ok: false, reason: 'signature' };
  let ev: unknown;
  try {
    ev = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'format' };
  }
  const { id, type, data } = (ev ?? {}) as { id?: unknown; type?: unknown; data?: { object?: unknown } };
  if (typeof id !== 'string' || !id || typeof type !== 'string' || !type) return { ok: false, reason: 'format' };
  const obj = data?.object;
  // `data.object` (z. B. die Checkout-Sitzung) – nur ein einfaches Objekt, sonst null.
  const object = typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  return { ok: true, event: { id, type, object } };
}

import { NextResponse, connection } from 'next/server';
import { realNow } from '@/domain/clock';
import { STRIPE_SYNC_EVENTS, verifyStripeSignature } from '@/server/connectors/stripe-signature';
import { readEnv } from '@/server/env';
import { getRepos, getSyncDeps } from '@/server/registry';
import { syncConnections } from '@/server/sync';

// Sekunden; das Sync-Budget (8 s) liegt weit darunter, Platz für Kaltstart und Datenbank.
export const maxDuration = 60;

const MAX_BODY = 1_000_000; // Stripe-Events sind klein; schützt den unauthentifizierten Endpunkt

// Keine Sitzung: Stripe ruft ohne Login auf. Die Echtheit sichert allein die Signaturprüfung.
export async function POST(req: Request) {
  await connection();
  const secret = readEnv().stripeWebhookSecret;
  if (!secret) return NextResponse.json({ error: 'Nicht eingerichtet' }, { status: 503 });
  const tooBig = () => NextResponse.json({ error: 'Zu groß' }, { status: 413 });
  if (Number(req.headers.get('content-length')) > MAX_BODY) return tooBig();
  const raw = await req.text(); // Rohtext: die Signatur gilt für die exakten Bytes
  if (raw.length > MAX_BODY) return tooBig();
  const at = realNow();
  const v = verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret, Math.floor(at.getTime() / 1000));
  if (!v.ok) return NextResponse.json({ error: 'Signatur ungültig' }, { status: 400 });
  const repos = getRepos();
  if (!(await repos.state.claimJobRun('stripe-event:' + v.event.id, at))) return NextResponse.json({ duplicate: true });
  if (STRIPE_SYNC_EVENTS.has(v.event.type)) {
    // Ein Fehler steht danach als syncFailed im Verbindungsstatus; der 15-Min-Abgleich holt nach.
    await syncConnections(repos, getSyncDeps({ only: ['stripe_nexus'], budgetMs: 8_000 })).catch((e) => {
      console.error('Stripe-Webhook: Sync fehlgeschlagen:', e instanceof Error ? e.name : typeof e);
    });
  }
  return NextResponse.json({ received: true });
}

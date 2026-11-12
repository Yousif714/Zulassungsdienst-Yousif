import { NextResponse, connection } from 'next/server';
import { realNow } from '@/domain/clock';
import { STRIPE_SYNC_EVENTS, verifyStripeSignature } from '@/server/connectors/stripe-signature';
import { readEnv } from '@/server/env';
import { getRepos, getSyncDeps } from '@/server/registry';
import { syncConnections } from '@/server/sync';

// Keine Sitzung: Stripe ruft ohne Login auf. Die Echtheit sichert allein die Signaturprüfung.
export async function POST(req: Request) {
  await connection();
  const secret = readEnv().stripeWebhookSecret;
  if (!secret) return NextResponse.json({ error: 'Nicht eingerichtet' }, { status: 503 });
  const raw = await req.text(); // Rohtext: die Signatur gilt für die exakten Bytes
  const at = realNow();
  const v = verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret, Math.floor(at.getTime() / 1000));
  if (!v.ok) return NextResponse.json({ error: 'Signatur ungültig' }, { status: 400 });
  const repos = getRepos();
  if (!(await repos.state.claimJobRun('stripe-event:' + v.event.id, at))) return NextResponse.json({ duplicate: true });
  if (STRIPE_SYNC_EVENTS.has(v.event.type)) {
    // Ein Fehler steht danach als syncFailed im Verbindungsstatus; der 15-Min-Abgleich holt nach.
    await syncConnections(repos, getSyncDeps({ only: ['stripe_nexus'], budgetMs: 8_000 })).catch(() => {});
  }
  return NextResponse.json({ received: true });
}

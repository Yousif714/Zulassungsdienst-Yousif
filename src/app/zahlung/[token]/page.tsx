import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { realNow, todayBerlin } from '@/domain/clock';
import { formatEuro } from '@/domain/money';
import { publicPlanView } from '@/domain/takeover/plan';
import { readEnv } from '@/server/env';
import { allowRequest, clientKey } from '@/server/rate-limit';
import { getRepos } from '@/server/registry';
import '../zahlung.css';

export const metadata: Metadata = { title: 'NEXUS – Ratenplan', robots: { index: false, follow: false } };

/** Öffentlich, ohne Login: zeigt nur den Plan (kein Name, keine E-Mail). GET legt nie eine Checkout-Sitzung an. */
export default async function PlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await connection();
  const env = readEnv();
  const repos = getRepos();
  const at = realNow();
  const key = clientKey({ headers: await headers() }, env.sessionSecret);
  if (!(await allowRequest(repos.state, `seite-ip:${key}`, 20, at))) {
    return <main className="pay-page"><p>Zu viele Aufrufe, bitte kurz warten.</p></main>;
  }
  const { state } = await repos.state.load();
  const t = state.takeovers.find((x) => x.token === token);
  if (!token || !t || t.status !== 'link_sent') notFound();
  const view = publicPlanView(t, todayBerlin(at));
  return (
    <main className="pay-page">
      <h1>NEXUS – Ratenplan{t.isDemo && <span className="pay-demo"> Demo</span>}</h1>
      <p>{view.count} Raten</p>
      <ul>
        {view.rates.map((r, i) => <li key={i}>{r.label}: {formatEuro(r.amountCents)}</li>)}
      </ul>
      <p>Erste Abbuchung: {view.first}</p>
      <p>Letzte Abbuchung: {view.last}</p>
      <form method="post" action={`/zahlung/${token}/weiter`}>
        <button type="submit" disabled={t.isDemo}>{t.isDemo ? 'Demo – hier öffnet später Stripe' : 'Weiter zu Stripe'}</button>
      </form>
    </main>
  );
}

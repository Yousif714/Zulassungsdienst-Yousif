import { realNow } from '@/domain/clock';
import { readEnv } from '@/server/env';
import { allowRequest, clientKey, hashKey } from '@/server/rate-limit';
import { getRepos, getStripeWriter } from '@/server/registry';
import { createCheckoutForToken } from '@/server/takeover';

const TOO_MANY = 'Zu viele Aufrufe, bitte kurz warten.';
const NO_STORE = { 'cache-control': 'no-store' };

/** Nur POST: Link-Vorschauen (GET) legen so nie eine Checkout-Sitzung an. */
export async function GET() {
  return new Response('Nicht erlaubt', { status: 405, headers: { allow: 'POST', ...NO_STORE } });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const env = readEnv();
  const repos = getRepos();
  const at = realNow();
  const ok = (await allowRequest(repos.state, `weiter-ip:${clientKey(req, env.sessionSecret)}`, 10, at))
    && (await allowRequest(repos.state, `weiter-tok:${hashKey(token, env.sessionSecret)}`, 5, at));
  if (!ok) return new Response(TOO_MANY, { status: 429, headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE } });
  const r = await createCheckoutForToken(repos, getStripeWriter(), token, env.paymentLinkBaseUrl);
  const location = r.kind === 'redirect' ? r.url : `/zahlung/${encodeURIComponent(token)}`;
  return new Response(null, { status: 303, headers: { location, ...NO_STORE } });
}

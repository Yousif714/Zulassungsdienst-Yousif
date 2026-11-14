import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

let ip = '203.0.113.9';
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': ip }) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

import PlanPage from '@/app/zahlung/[token]/page';
import ZahlungNotFound from '@/app/zahlung/not-found';
import type { AppState } from '@/domain/types';
import { fixtureFetch, type FixtureRequest } from '@/server/connectors/fixture-fetch';
import { createStripeWriter } from '@/server/connectors/stripe-write';
import { getRepos, resetTestRepos, setTestStripeWriter } from '@/server/registry';
import { stripeWriteRoutes } from '../fixtures/stripe-write';
import { linkSentState, seed } from './takeover/setup';

const render = async (token: string) => renderToStaticMarkup(await PlanPage({ params: Promise.resolve({ token }) }));
const withStatus = (s: AppState, status: 'set_up' | 'withdrawn'): AppState => ({ ...s, takeovers: s.takeovers.map((t) => ({ ...t, status })) });
const token = () => linkSentState().takeovers[0].token;

let requests: FixtureRequest[];

beforeEach(() => {
  vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
  vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
  vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
  vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
  ip = '203.0.113.9';
  resetTestRepos();
  requests = [];
  setTestStripeWriter(createStripeWriter({ key: 'sk_test_SECRET', fetch: fixtureFetch(stripeWriteRoutes, { requests }), sleep: async () => {}, now: () => 0 }));
});

describe('Seite /zahlung/[token]', () => {
  test('gültig: zeigt nur den Plan, GET erzeugt keinen Stripe-Request', async () => {
    await seed(getRepos(), linkSentState());
    const html = await render(token());
    expect(html).toContain('2 Raten');
    expect(html).not.toContain('Erika');
    expect(requests).toEqual([]);
  });
  test('21. Aufruf je Minute und IP → Text zu vielen Aufrufen, ohne Plandaten', async () => {
    await seed(getRepos(), linkSentState());
    for (let i = 0; i < 20; i++) expect(await render(token())).toContain('2 Raten');
    const html = await render(token());
    expect(html).toContain('Zu viele Aufrufe, bitte kurz warten.');
    expect(html).not.toContain('Raten');
    expect(requests).toEqual([]);
  });
  test.each(['set_up', 'withdrawn'] as const)('Status %s → wie ungültig (notFound, neutraler Text)', async (status) => {
    await seed(getRepos(), withStatus(linkSentState(), status));
    await expect(render(token())).rejects.toThrow('NEXT_NOT_FOUND');
    expect(requests).toEqual([]);
  });
  test('neutraler Text der not-found-Seite ohne Plandaten', () => {
    const html = renderToStaticMarkup(ZahlungNotFound());
    expect(html).toContain('Link nicht mehr gültig, bitte melde dich bei NEXUS.');
    expect(html).not.toContain('Raten');
  });
});

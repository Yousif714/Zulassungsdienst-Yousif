import { describe, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppState, StripeTakeover } from '@/domain/types';
import { base, stateWith } from './helpers';

const store: { state: AppState; mode: 'demo' | 'real' } = { state: stateWith(), mode: 'demo' };
vi.mock('@/data/store', () => ({ useAppStore: () => ({ state: store.state, dispatch: () => {}, mode: store.mode }) }));

const { TakeoverCard } = await import('@/components/TakeoverCard');

const demoTakeover: StripeTakeover = {
  id: 'stripe-takeover-c1-1', contractId: 'c1', contactId: 'm1', actionId: 'stripe-takeover-c1-1', actionVersion: 1, status: 'link_sent', token: 'demo-tok', link: '/zahlung/demo-tok',
  mode: 'first_rate', rates: [], openCents: 0, stripeCustomerId: null, paymentMethodId: null, scheduleId: null, subscriptionExternalId: null, isDemo: true, linkSentAt: '2026-11-10T08:00:00Z',
};
const render = (mode: 'demo' | 'real') => {
  store.state = stateWith({ contracts: [base], takeovers: [demoTakeover] });
  store.mode = mode;
  return renderToStaticMarkup(createElement(TakeoverCard, { contractId: 'c1', name: 'Erika Muster', mode: 'first_rate', blockReason: null }));
};

describe('TakeoverCard: Demo-Einrichtung (M8)', () => {
  test('Demo-App zeigt „Zahlungsmittel hinterlegt (Demo)“', () => expect(render('demo')).toContain('Zahlungsmittel hinterlegt (Demo)'));
  test('Echtbetrieb zeigt den Knopf auch bei Demo-Umstellung nicht', () => expect(render('real')).not.toContain('Zahlungsmittel hinterlegt (Demo)'));
});

describe('TakeoverCard: fehlgeschlagen mit veraltetem Plan (I2)', () => {
  const failed = (error: string): AppState['actions'][number] => ({
    id: 'stripe-takeover-c1-2', type: 'stripe_takeover', company: 'nexus', title: 'Umstellung auf Stripe: Erika Muster', version: 1, status: 'failed', error,
    createdAt: '2026-11-13T09:00:00Z', isDemo: false, payload: { contractId: 'c1', mode: 'first_rate', rates: [], openCents: 0 },
  });
  const renderWith = (error: string) => {
    store.state = stateWith({ contracts: [base], actions: [failed(error)] });
    store.mode = 'real';
    return renderToStaticMarkup(createElement(TakeoverCard, { contractId: 'c1', name: 'Erika Muster', mode: 'first_rate', blockReason: null }));
  };
  test('Plan geändert → „Neu vorbereiten“ statt „Erneut versuchen“', () => {
    const html = renderWith('Plan hat sich geändert – neu vorbereiten');
    expect(html).toContain('>Neu vorbereiten<');
    expect(html).not.toContain('Erneut versuchen');
  });
  test('anderer Fehler → „Erneut versuchen“', () => expect(renderWith('Stripe: HTTP 500')).toContain('Erneut versuchen'));
});

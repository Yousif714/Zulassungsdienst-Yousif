import { describe, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

import { ReadContractPanel } from '@/components/ReadContractPanel';
import type { MemberContract, StripeTakeover } from '@/domain/types';
import { base, stateWith } from './helpers';

const read = (confirmed: boolean): MemberContract => ({ ...base, readBy: { invoiceId: 'i-r', invoiceNumber: 'RE-1', quote: 'erfunden', confirmed } });
const tk = (status: StripeTakeover['status']): StripeTakeover => ({
  id: 'stripe-takeover-c1-1', contractId: 'c1', contactId: 'm1', actionId: 'stripe-takeover-c1-1', actionVersion: 1, status, token: 't', link: 'https://nexus.example.de/zahlung/t',
  mode: 'first_rate', rates: [], openCents: 0, stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1', scheduleId: 'sub_sched_test_1', subscriptionExternalId: null,
  isDemo: false, linkSentAt: '2026-11-01T08:00:00Z',
});
const render = (c: MemberContract, takeovers: StripeTakeover[] = []) =>
  renderToStaticMarkup(createElement(ReadContractPanel, { state: stateWith({ contracts: [c], takeovers }), contract: c, dispatch: () => {} }));

describe('ReadContractPanel (I3)', () => {
  test('ohne Umstellung: Korrigieren und Löschen sichtbar', () => {
    expect(render(read(false))).toContain('>Löschen<');
    expect(render(read(true))).toContain('Ratenplan korrigieren');
  });
  test('läuft über Stripe: kein Korrigieren/Löschen, sichtbarer Grund', () => {
    const html = render(read(true), [tk('set_up')]);
    expect(html).not.toContain('Ratenplan korrigieren');
    expect(html).toContain('data-testid="read-locked"');
    expect(html).toContain('Vertrag läuft über Stripe – erst Zeitplan in Stripe beenden.');
    const pending = render(read(false), [tk('link_sent')]);
    expect(pending).not.toContain('>Löschen<');
    expect(pending).not.toContain('>Korrigieren<');
    expect(pending).toContain('Umstellung auf Stripe läuft – erst zurückziehen.');
  });
});

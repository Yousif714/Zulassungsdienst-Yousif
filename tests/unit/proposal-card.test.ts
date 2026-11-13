import { expect, test } from 'vitest';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProposalCard, confirmBlocker, proposalSummary } from '@/components/ProposalCard';
import { portalProposal } from '@/domain/portal';

test('Zusammenfassung: Tag 31 heißt „zum Monatsende“', () => expect(proposalSummary({ totalCents: 119000, installments: 12, installmentCents: 9916, dueDay: 31, startDate: '2026-08-04' })).toBe('1.190,00 € · 12 × 99,16 € · zum Monatsende · ab 04.08.2026'));
test('Zusammenfassung', () => expect(proposalSummary({ totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01' })).toBe('1.200,00 € · 4 × 300,00 € · am 1. · ab 01.09.2026'));
test('fehlende Werte', () => expect(proposalSummary({ totalCents: 120000, installments: null, installmentCents: null, dueDay: null, startDate: '2026-09-10' })).toBe('1.200,00 € · ? × ? · am ? · ab 10.09.2026'));
test('alles fehlt', () => expect(proposalSummary({ totalCents: null, installments: null, installmentCents: null, dueDay: null, startDate: null })).toBe('? · ? × ? · am ? · ab ?'));


test('Namenstreffer: Übernehmen gesperrt bis beantwortet', () => {
  expect(confirmBlocker([], 'name', null, 'Max Muster')).toBe('Bitte zuerst beantworten: Ist das Max Muster?');
  expect(confirmBlocker([], 'name', true, 'Max Muster')).toBeNull();
  expect(confirmBlocker([], 'name', false, 'Max Muster')).toBeNull();
});
test('andere Treffer brauchen keine Antwort, Fehler sperren', () => {
  expect(confirmBlocker([], 'email', null, 'X')).toBeNull();
  expect(confirmBlocker([], 'none', null, null)).toBeNull();
  expect(confirmBlocker(['Fehler'], 'none', null, null)).not.toBeNull();
});


test('dismissLabel ersetzt „Verwerfen“', () => {
  const view = { member: { id: 'p', connectionId: 'portal_nexus' as const, externalId: 'a@b.de', email: 'a@b.de', name: 'A B', firstSeenAt: '', lastSeenInListAt: '' }, status: 'no_invoice' as const, inLatestList: true, contactIds: [], nameMatch: null, contractId: null, proposalId: null, invoices: [], sharedWith: [] };
  const props = { proposal: portalProposal(view), contacts: [], onConfirm: () => {}, onDismiss: () => {} };
  const custom = renderToStaticMarkup(createElement(ProposalCard, { ...props, dismissLabel: 'Kein zahlendes Mitglied' }));
  expect(custom).toContain('Kein zahlendes Mitglied');
  expect(custom).not.toContain('Verwerfen');
  expect(renderToStaticMarkup(createElement(ProposalCard, props))).toContain('Verwerfen');
});

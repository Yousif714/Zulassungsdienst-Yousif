import { expect, test } from 'vitest';

import { proposalSummary } from '@/components/ProposalCard';

test('Zusammenfassung', () => expect(proposalSummary({ totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01' })).toBe('1.200,00 € · 4 × 300,00 € · am 1. · ab 01.09.2026'));
test('fehlende Werte', () => expect(proposalSummary({ totalCents: 120000, installments: null, installmentCents: null, dueDay: null, startDate: '2026-09-10' })).toBe('1.200,00 € · ? × ? · am ? · ab 10.09.2026'));
test('alles fehlt', () => expect(proposalSummary({ totalCents: null, installments: null, installmentCents: null, dueDay: null, startDate: null })).toBe('? · ? × ? · am ? · ab ?'));

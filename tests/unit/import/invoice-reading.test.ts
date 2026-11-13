import { describe, expect, test } from 'vitest';
import {
  correctionProposal, costMicroCents, invoicesToRead, limitReached, monthCostMicroCents, planFromReading, readContractSteps, readerSummary, readingProposalId,
} from '@/domain/import/invoice-reading';
import { invoiceRef } from '@/domain/ledger/contracts';
import { base, stateWith } from '../helpers';
import { okResult, readInv, reading } from './reading-fixtures';

describe('planFromReading', () => {
  const s0 = stateWith({ invoices: [readInv()] });
  test('sicher und Summe passt → apply mit Werten', () => {
    const p = planFromReading(s0, readInv(), okResult());
    expect(p.decision).toBe('apply');
    expect(p.kind).toBe('ticket');
    expect(p.values).toEqual({ totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15' });
    expect(p.steps.join(' ')).toContain('6 Raten × 100,00 €');
  });
  test('Rundungsrest: 1.000 € in 6 Raten à 166,67 € → apply', () => {
    const i = readInv({ totalCents: 100000, openCents: 100000 });
    expect(planFromReading(s0, i, okResult({ installmentCents: 16667 })).decision).toBe('apply');
    expect(planFromReading(s0, i, okResult({ installmentCents: 16666 })).decision).toBe('apply');
  });
  test('Summe passt nicht → proposal mit Hinweis', () => {
    const p = planFromReading(s0, readInv({ totalCents: 100000, openCents: 100000 }), okResult({ installmentCents: 16000 }));
    expect(p.decision).toBe('proposal');
    expect(p.hints).toContain('Raten ergeben nicht die Rechnungssumme');
  });
  test('unsicher → proposal mit Grund', () => {
    const p = planFromReading(s0, readInv(), okResult({ certain: false, note: 'Anzahl unklar' }));
    expect(p.decision).toBe('proposal');
    expect(p.hints).toContain('Claude ist unsicher: Anzahl unklar');
  });
  test('hasPlan=false → none', () => expect(planFromReading(s0, readInv(), okResult({ hasPlan: false })).decision).toBe('none'));
  test('ohne Tag und ohne erste Fälligkeit: Monatsende, Start Rechnungsdatum', () => {
    expect(planFromReading(s0, readInv(), okResult({ dueDay: null, firstDueDate: null })).values).toMatchObject({ dueDay: 31, startDate: '2026-10-01' });
  });
  test('ohne Tag, mit erster Fälligkeit: Tag aus dem Datum', () => {
    expect(planFromReading(s0, readInv(), okResult({ dueDay: null, firstDueDate: '2026-10-20' })).values).toMatchObject({ dueDay: 20, startDate: '2026-10-20' });
  });
  test('Grenzen 2 und 36 gelten, 1 und 37 nicht', () => {
    expect(planFromReading(s0, readInv({ totalCents: 20000, openCents: 20000 }), okResult({ installments: 2 })).decision).toBe('apply');
    expect(planFromReading(s0, readInv({ totalCents: 360000, openCents: 360000 }), okResult({ installments: 36 })).decision).toBe('apply');
    expect(planFromReading(s0, readInv({ totalCents: 10000, openCents: 10000 }), okResult({ installments: 1 })).hints).toContain('Plan passt nicht ins Monatsraten-Schema');
    expect(planFromReading(s0, readInv({ totalCents: 370000, openCents: 370000 }), okResult({ installments: 37 })).decision).toBe('proposal');
  });
  test('erste Fälligkeit −60 / +365 Tage gilt, −61 / +366 nicht', () => {
    for (const [d, want] of [['2026-08-02', 'apply'], ['2026-08-01', 'proposal'], ['2027-10-01', 'apply'], ['2027-10-02', 'proposal']] as const)
      expect(planFromReading(s0, readInv(), okResult({ firstDueDate: d, dueDay: null })).decision).toBe(want);
  });
  test('ohne NEXUS-Kontakt → proposal', () => {
    expect(planFromReading(s0, readInv({ contactId: null }), okResult()).hints).toContain('Rechnung hat keinen NEXUS-Kontakt');
  });
  test('Mitgliedschaft bei vorhandenem Mitgliedsvertrag → proposal; Ticket daneben → apply', () => {
    const s = stateWith({ invoices: [readInv()], contracts: [{ ...base, id: 'k0', contactId: 'm-x' }] });
    expect(planFromReading(s, readInv(), okResult({ kind: 'membership' })).hints).toContain('Kontakt hat schon einen Mitgliedsvertrag');
    expect(planFromReading(s, readInv(), okResult({ kind: 'ticket' })).decision).toBe('apply');
  });
  test('9a: Teilzahlung nur in Lexware → proposal; in der App zugeordnet → apply', () => {
    const i = readInv({ openCents: 40000 });
    expect(planFromReading(stateWith({ invoices: [i] }), i, okResult()).hints).toContain('Teilzahlung nur in Lexware ausgeglichen – bitte prüfen');
    const s = stateWith({ invoices: [i], allocations: [{ paymentId: 'p1', invoiceId: 'i-r1', amountCents: 20000, method: 'confirmed' }] });
    expect(planFromReading(s, i, okResult()).decision).toBe('apply');
  });
  test('Review 5: Unsinn → proposal mit null-Werten, kein Wurf', () => {
    const p = planFromReading(s0, readInv(), okResult({ installments: 0, installmentCents: -5, dueDay: 40, firstDueDate: '2026-13-45' }));
    expect(p.decision).toBe('proposal');
    expect(p.values).toMatchObject({ installments: null, installmentCents: null, dueDay: null });
    expect(p.hints).toContain('Angaben unvollständig – bitte ergänzen');
  });
});

describe('invoicesToRead', () => {
  test('nur offene NEXUS-Rechnungen mit Text und offenem Betrag, älteste zuerst, höchstens 5', () => {
    const list = [
      readInv({ id: 'a', externalId: 'a', issuedOn: '2026-10-03' }), readInv({ id: 'b', externalId: 'b', issuedOn: '2026-10-02' }),
      readInv({ id: 'paid', externalId: 'p', status: 'paid' }), readInv({ id: 'void', externalId: 'v', status: 'void' }),
      readInv({ id: 'zero', externalId: 'z', openCents: 0 }), readInv({ id: 'notext', externalId: 'n', text: undefined }),
      readInv({ id: 'zul', externalId: 'zl', connectionId: 'lexware_zulassung', company: 'zulassung' }),
    ];
    expect(invoicesToRead(stateWith({ invoices: list })).map((i) => i.id)).toEqual(['b', 'a']);
    const many = Array.from({ length: 7 }, (_, k) => readInv({ id: `m${k}`, externalId: `m${k}`, issuedOn: `2026-10-0${k + 1}` }));
    expect(invoicesToRead(stateWith({ invoices: many }))).toHaveLength(5);
  });
  test('vom Vertrag abgedeckt, schon gelesen, verworfen → raus; neue Fassung → wieder rein', () => {
    const i = readInv();
    expect(invoicesToRead(stateWith({ invoices: [i], contracts: [{ ...base, origin: [invoiceRef(i)] }] }))).toEqual([]);
    expect(invoicesToRead(stateWith({ invoices: [i], invoiceReadings: [reading({ outcome: 'proposal' })] }))).toEqual([]);
    expect(invoicesToRead(stateWith({ invoices: [i], dismissedProposals: [readingProposalId(i)] }))).toEqual([]);
    expect(invoicesToRead(stateWith({ invoices: [{ ...i, sourceUpdatedAt: '2026-11-01T08:00:00Z' }], invoiceReadings: [reading({ outcome: 'proposal' })] }))).toHaveLength(1);
  });
  test('Fehlversuche: nach 2 Fehlern erneut, eine none-Lesung (3. Fehler) beendet', () => {
    const i = readInv();
    const err = (id: string) => reading({ id, outcome: 'error', result: null, error: 'Zeitüberschreitung' });
    expect(invoicesToRead(stateWith({ invoices: [i], invoiceReadings: [err('e1'), err('e2')] }))).toHaveLength(1);
    expect(invoicesToRead(stateWith({ invoices: [i], invoiceReadings: [err('e1'), err('e2'), reading({ id: 'e3', outcome: 'none', result: null, error: '3 Versuche fehlgeschlagen' })] }))).toEqual([]);
  });
});

describe('Kosten', () => {
  test('1.000 Eingabe- und 500 Ausgabe-Token = 1,4 Cent', () => expect(costMicroCents({ inputTokens: 1000, outputTokens: 500 })).toBe(1_400_000));
  test('Review 4: Monat Europe/Berlin', () => {
    const at = new Date('2026-11-12T10:00:00Z');
    const s = stateWith({ invoiceReadings: [reading({ id: 'a', readAt: '2026-10-31T23:30:00Z' }), reading({ id: 'b', readAt: '2026-10-31T22:30:00Z' })] });
    expect(monthCostMicroCents(s, at)).toBe(1_400_000);
  });
  test('Limit 100 €', () => {
    const at = new Date('2026-11-12T10:00:00Z');
    const s = stateWith({ invoiceReadings: [reading({ costMicroCents: 9_999_999_999 })] });
    expect(limitReached(s, at)).toBe(false);
    expect(limitReached(s, at, 1)).toBe(true);
  });
});

describe('readerSummary', () => {
  test('Kosten aufgerundet in Cent, letzter Fehler nur wenn jünger als letzte Lesung', () => {
    const at = new Date('2026-11-12T10:00:00Z');
    const s = stateWith({ invoiceReadings: [
      reading({ id: 'a', readAt: '2026-11-12T08:00:00Z', outcome: 'error', result: null, error: 'Zeitüberschreitung', costMicroCents: 0 }),
      reading({ id: 'b', readAt: '2026-11-12T09:00:00Z', costMicroCents: 1_400_001 }),
    ] });
    expect(readerSummary(s, at)).toEqual({ lastReadAt: '2026-11-12T09:00:00Z', monthCostMicroCents: 1_400_001, monthCostCents: 2, limitMicroCents: 10_000_000_000, limitReached: false, lastError: null });
    const s2 = stateWith({ invoiceReadings: [...s.invoiceReadings, reading({ id: 'c', readAt: '2026-11-12T09:30:00Z', outcome: 'error', result: null, error: 'Überlastet', costMicroCents: 0 })] });
    expect(readerSummary(s2, at).lastError).toBe('Überlastet');
  });
});

describe('Claude-Vertrag: Rechenweg und Korrektur-Vorschlag', () => {
  test('readContractSteps nutzt die angewandte Lesung; correctionProposal trägt die Vertragswerte', () => {
    const i = readInv();
    const k = { ...base, id: 'k1', contactId: 'm-x', kind: 'ticket' as const, totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15',
      readBy: { invoiceId: 'i-r1', invoiceNumber: 'RE-9001', quote: 'zahlbar in 6 Monatsraten à 100,00 €', confirmed: false }, origin: [invoiceRef(i)] };
    const s = stateWith({ invoices: [i], contracts: [k], invoiceReadings: [reading({ outcome: 'applied', contractId: 'k1' })] });
    expect(readContractSteps(s, k).join(' ')).toContain('6 Raten × 100,00 €');
    expect(readContractSteps(stateWith({ contracts: [k] }), k)).toEqual([]);
    expect(correctionProposal(s, k)).toMatchObject({ id: 'correct:k1', totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15',
      sourceLabel: 'Lexware (Claude)', references: ['Rechnung RE-9001'], complete: true, reading: { invoiceId: 'i-r1', kind: 'ticket' } });
  });
});

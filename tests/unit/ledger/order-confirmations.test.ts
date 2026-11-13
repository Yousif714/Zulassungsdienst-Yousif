import { expect, test } from 'vitest';
import { runDetectors } from '@/domain/detectors';
import { buildMatchContext } from '@/domain/detectors/payments';
import { emptyBatch } from '@/domain/import/batch';
import { mapLexwareOrderConfirmation } from '@/domain/import/lexware';
import { mergeBatch } from '@/domain/import/merge';
import { nexusReceivables } from '@/domain/ledger/receivables';
import { matchBankPayment } from '@/domain/matching/payments';
import type { AppState, Payment } from '@/domain/types';
import { lexOrderConfirmation } from '../../fixtures';
import { NOW_0930 } from '../helpers';
import { lexState, seq } from '../import/helpers';

// Auftragsbestätigungen sind nie Forderungen: keine offenen Beträge, keine Zahlungsziele, keine Überfällig-Hinweise.
const abs = ['AB-2001', 'AB-2002', 'AB-2003'].map((n) => mapLexwareOrderConfirmation(lexOrderConfirmation(n), 'lexware_nexus'));
const withAbs: AppState = mergeBatch(lexState, { ...emptyBatch(), orderConfirmations: abs }, seq()).state;
const TODAY = '2026-11-12';

test('ABs tauchen nicht in den Forderungen auf, Summen unverändert', () => {
  const before = nexusReceivables(lexState, TODAY);
  const after = nexusReceivables(withAbs, TODAY);
  expect(after).toEqual(before);
  expect(JSON.stringify(after.items)).not.toMatch(/AB-20/);
});

test('ABs sind kein Zahlungsziel: Zuordnungskontext ohne AB, Zahlung mit AB-Nummer im Verwendungszweck trifft keine AB', () => {
  const ctx = buildMatchContext(withAbs, NOW_0930);
  expect(ctx.invoices.map((i) => i.number)).not.toContain('AB-2002');
  expect(ctx.invoices).toEqual(buildMatchContext(lexState, NOW_0930).invoices);
  const ab = withAbs.orderConfirmations.find((x) => x.number === 'AB-2002')!;
  const p: Payment = { id: 'p-ab', company: 'nexus', source: 'bank', connectionId: 'bank_qonto', externalId: 't-ab', amountCents: 50000, bookedOn: '2026-11-10', payerName: 'Lisa Beispiel', reference: 'AB-2002', kind: 'incoming' };
  const r = matchBankPayment(p, ctx);
  expect([r.target, ...r.candidates].some((t) => t?.id === ab.id)).toBe(false);
});

test('ABs erzeugen keine Überfällig- oder Rechnungshinweise', () => {
  const ids = (s: AppState) => runDetectors(s, NOW_0930).filter((i) => i.dedupeKey !== 'ab-ohne-rechnung').map((i) => i.dedupeKey).sort();
  expect(ids(withAbs)).toEqual(ids(lexState));
  expect(JSON.stringify(runDetectors(withAbs, NOW_0930))).not.toMatch(/AB-20/);
});

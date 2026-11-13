import { todayBerlin } from '@/domain/clock';
import { classifyBankTx, normalizeIban } from '@/domain/matching/payments';
import type { ImportBatch, ImportedPayment } from './batch';
import { emptyBatch, IMPORT_SINCE } from './batch';

/** Feldnamen gegen https://api-doc.qonto.com prüfen (gegen Doku prüfen; Session ohne Netz). Eine Stelle für Korrekturen. */
export const QF = {
  list: 'transactions', id: 'transaction_id', amountCents: 'amount_cents', side: 'side', currency: 'currency',
  label: 'label', reference: 'reference', settledAt: 'settled_at', emittedAt: 'emitted_at', operationType: 'operation_type',
  counterpartyIban: ['income.counterparty_account_number', 'transfer.counterparty_account_number'], // erster nicht leerer Pfad
} as const;

/** operation_type einer Rückbuchung (Ausgang, der eine Zahlung rückgängig macht) – gegen Doku prüfen. */
export const QONTO_RETURN_TYPES: readonly string[] = ['recall', 'direct_debit_collection'];

type Obj = Record<string, unknown>;

/** Wert unter Punktpfad `a.b` lesen. */
function pick(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Obj)[k] : undefined), obj);
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/** Qonto-Buchungen → Zahlungen (nur Eingänge und Rückbuchungen, nur EUR, ab IMPORT_SINCE). Rein, ohne Netz. */
export function mapQonto(transactions: unknown[]): ImportBatch {
  const batch = emptyBatch();
  for (const t of transactions) {
    if (pick(t, QF.currency) !== 'EUR') continue;
    const side = pick(t, QF.side);
    const cents = pick(t, QF.amountCents);
    const id = str(pick(t, QF.id));
    const at = str(pick(t, QF.settledAt)) ?? str(pick(t, QF.emittedAt));
    if (!id || !at || typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0) continue;
    const bookedOn = todayBerlin(new Date(at));
    if (bookedOn < IMPORT_SINCE) continue;
    const isReturn = side === 'debit' && QONTO_RETURN_TYPES.includes(String(pick(t, QF.operationType)));
    if (side !== 'credit' && !isReturn) continue;
    const rawIban = QF.counterpartyIban.map((p) => str(pick(t, p))).find(Boolean);
    const payerName = str(pick(t, QF.label));
    const reference = str(pick(t, QF.reference));
    const iban = rawIban ? normalizeIban(rawIban) : undefined;
    const p: ImportedPayment = {
      company: 'nexus', source: 'bank', connectionId: 'bank_qonto', externalId: id,
      amountCents: isReturn ? -cents : cents, bookedOn, payerName, iban, reference,
      kind: isReturn ? 'incoming' : classifyBankTx({ payerName, reference, iban }),
    };
    batch.payments.push(p);
  }
  return batch;
}

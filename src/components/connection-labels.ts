import { daysBetween, todayBerlin } from '@/domain/clock';
import { HOW_TO } from '@/domain/connections';
import { ageText } from '@/domain/freshness';
import { MONTHLY_LIMIT_CENTS, type readerSummary } from '@/domain/import/invoice-reading';
import { shortDateDe } from '@/domain/import/statement';
import { formatEuro, formatUsdCents } from '@/domain/money';
import type { Connection } from '@/domain/types';

/** Stand des Sparkassen-Auszugs: 'Noch kein Auszug' oder 'Auszug bis 11.11. · hochgeladen heute|gestern|vor 2 Tagen'. */
export function statementStandText(c: Connection, at: Date): string {
  if (!c.lastSuccessAt) return 'Noch kein Auszug';
  const days = daysBetween(todayBerlin(new Date(c.lastSuccessAt)), todayBerlin(at));
  const uploaded = `hochgeladen ${days <= 0 ? 'heute' : days === 1 ? 'gestern' : `vor ${days} Tagen`}`;
  return c.sync?.cursor ? `Auszug bis ${shortDateDe(c.sync.cursor)} · ${uploaded}` : `Auszug ${uploaded}`;
}

/** Untertitel einer Verbindung im Echtmodus: Stand, Störung im Klartext oder die Anleitung zum Einrichten. */
export function connectionSubtitle(c: Connection, at: Date, reader?: ReturnType<typeof readerSummary>): string {
  if (c.id === 'bank_sparkasse') return statementStandText(c, at);
  if (c.status === 'missing') return HOW_TO[c.id];
  const stand = c.lastSuccessAt ? ageText(c, at) : 'noch nie abgerufen';
  if (c.status === 'error') return `${c.lastError ? `Störung: ${c.lastError}` : 'Störung'} · ${stand}`;
  const base = c.lastSuccessAt ? `Verbunden · ${stand}` : 'Verbunden';
  if (c.id === 'claude_invoices' && reader) {
    const cost = `Kosten diesen Monat: ${formatUsdCents(reader.monthCostCents)} von ${formatEuro(MONTHLY_LIMIT_CENTS).replace(',00', '')} (1 $ als 1 € gerechnet)`;
    return [base, cost, ...(reader.limitReached ? ['Limit erreicht'] : c.lastError ? [`Hinweis: ${c.lastError}`] : [])].join(' · ');
  }
  // Teil-Störung (z. B. ABs abgelehnt): verbunden, Grund trotzdem sichtbar.
  return c.lastError ? `${base} · Hinweis: ${c.lastError}` : base;
}

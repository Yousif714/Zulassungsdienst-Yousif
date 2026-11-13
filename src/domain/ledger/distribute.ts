import type { IsoDate } from '../types';

export interface Share { id: string; amountCents: number }

/** Betrag der Reihe nach verteilen: je Ziel höchstens `capCents`, nur Anteile > 0; `restCents` = nicht verteilbarer Rest (Überzahlung). */
export function distributeInOrder(amountCents: number, items: { id: string; capCents: number }[]): { shares: Share[]; restCents: number } {
  let rest = Math.max(0, amountCents);
  const shares: Share[] = [];
  for (const it of items) {
    const part = Math.min(rest, Math.max(0, it.capCents));
    if (part <= 0) continue;
    shares.push({ id: it.id, amountCents: part });
    rest -= part;
  }
  return { shares, restCents: rest };
}

/** Älteste Rechnung zuerst (Fälligkeit, dann Nummer); bei Unterzahlung bleibt der Rest an der jüngsten offen. */
export function distributeOldestFirst(
  amountCents: number,
  invoices: { id: string; dueDate: IsoDate; number: string; openCents: number }[],
): { shares: Share[]; restCents: number } {
  const ordered = [...invoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number, 'de'));
  return distributeInOrder(amountCents, ordered.map((i) => ({ id: i.id, capCents: i.openCents })));
}

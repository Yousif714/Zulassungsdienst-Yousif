const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** Cent (Ganzzahl) -> "1.150,00 €" (normales Leerzeichen statt NBSP). */
export function formatEuro(cents: number): string {
  return euro.format(cents / 100).replace(/[  ]/g, ' ');
}

/** Deutsche Betragseingabe ("300", "300,00", "1.234,5 €") -> Cent; `null` bei ungültigen oder nicht positiven Werten. */
export function parseEuroInput(input: string): number | null {
  const t = input.replace(/€/g, '').replace(/\s/g, '');
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1].replace(/\./g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

/** Cent (Ganzzahl) in US-Dollar, deutsch formatiert: 42 → "0,42 $" (Claude-Kosten). */
export function formatUsdCents(cents: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} $`;
}

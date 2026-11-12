const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** Cent (Ganzzahl) -> "1.150,00 €" (normales Leerzeichen statt NBSP). */
export function formatEuro(cents: number): string {
  return euro.format(cents / 100).replace(/[  ]/g, ' ');
}

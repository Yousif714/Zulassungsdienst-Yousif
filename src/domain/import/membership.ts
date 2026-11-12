/** Mitgliedschafts-Erkennung für Lexware-Rechnungstexte und Stripe-Produkt-/Positionsnamen. */

export function isMembership(text: string): boolean {
  return text.toLowerCase().replace(/[-\s]/g, '').includes('mitgliedschaft');
}

/** `null` = keine Mitgliedschaft. Monate = Laufzeit (Anzahl Raten), dueDay = Fälligkeitstag 1–31. */
export function parseMembership(text: string): { months: number | null; dueDay: number | null } | null {
  if (!isMembership(text)) return null;
  const m = /(\d{1,2})\s*-?\s*monat/i.exec(text);
  const d = /(?:am|zum)\s+(\d{1,2})\.\s*(?:eines|jedes|des)\s+monats/i.exec(text);
  const dueDay = d ? Number(d[1]) : null;
  return {
    months: m ? Number(m[1]) : null,
    dueDay: dueDay !== null && dueDay >= 1 && dueDay <= 31 ? dueDay : null,
  };
}

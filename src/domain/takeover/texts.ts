import { formatIsoDe } from '../clock';
import { formatEuro } from '../money';
import type { Installment, IsoDate } from '../types';

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? '';

/** Nachricht mit dem Zahlungslink, die der Inhaber selbst verschickt. */
export function shareText(i: { name: string; link: string; rates: Installment[] }): string {
  const first = i.rates[0] ? formatIsoDe(i.rates[0].dueDate) : '';
  return `Hallo ${firstName(i.name)}, ab sofort kannst du deine NEXUS-Raten automatisch abbuchen lassen (Karte oder SEPA-Lastschrift). ${i.rates.length} Raten, erste am ${first}. Hier hinterlegst du dein Zahlungsmittel: ${i.link}\nWichtig: Bitte lösche danach deinen Dauerauftrag für NEXUS, damit nichts doppelt abgeht. Danke!`;
}

export function upcomingReminderText(i: { name: string; amountCents: number; dueDate: IsoDate; link: string | null }): string {
  const base = `Hallo ${firstName(i.name)}, kurze Erinnerung: Am ${formatIsoDe(i.dueDate)} ist deine NEXUS-Rate über ${formatEuro(i.amountCents)} fällig.`;
  return i.link ? `${base} Bequemer geht es mit automatischer Abbuchung: ${i.link}` : base;
}

export function linkNudgeText(i: { name: string; link: string }): string {
  return `Hallo ${firstName(i.name)}, hast du meinen Link schon gesehen? Dort kannst du deine NEXUS-Raten automatisch abbuchen lassen: ${i.link}`;
}

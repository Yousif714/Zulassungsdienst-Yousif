import type { Company, Connection, ConnectionId, MemberContract } from './types';

export const CONNECTION_CATALOG: readonly { id: ConnectionId; company: Company | null; label: string }[] = [
  { id: 'lexware_nexus', company: 'nexus', label: 'Lexware NEXUS' },
  { id: 'lexware_zulassung', company: 'zulassung', label: 'Lexware Zulassungsdienst' },
  { id: 'stripe_nexus', company: 'nexus', label: 'Stripe NEXUS' },
  { id: 'bank', company: null, label: 'Bankkonto' },
  { id: 'gmail', company: null, label: 'Gmail' },
  { id: 'icloud', company: null, label: 'iCloud-Mail' },
  { id: 'info_mail', company: 'zulassung', label: 'info@-Postfach' },
  { id: 'calendar', company: null, label: 'Kalender' },
  { id: 'whatsapp_kunden', company: 'zulassung', label: 'WhatsApp Kunden' },
  { id: 'whatsapp_assistent', company: null, label: 'WhatsApp Assistent' },
];

/** Kurzanleitung für die echte Anbindung in Phase 2. */
export const HOW_TO: Record<ConnectionId, string> = {
  lexware_nexus: 'API-Schlüssel im Lexware-Konto erstellen und hier eintragen.',
  lexware_zulassung: 'API-Schlüssel im Lexware-Konto erstellen und hier eintragen.',
  stripe_nexus: 'In Stripe einen eingeschränkten Lese-Schlüssel anlegen.',
  bank: 'CSV- oder CAMT-Export seit 1. August hochladen, später PSD2-Freigabe bei der Bank.',
  gmail: 'Mit dem Google-Login freigeben.',
  icloud: 'App-spezifisches Passwort in der Apple-ID erstellen.',
  info_mail: 'Anbieter des info@-Postfachs klären (Zugangsart und Zugangsdaten).',
  calendar: 'Google- oder iCloud-Kalender freigeben.',
  whatsapp_kunden: 'Coexistence über einen Anbieter: Die WhatsApp-Business-App bleibt nutzbar.',
  whatsapp_assistent: 'Zweite Nummer einrichten und Meta-Vorlagen für Briefings freigeben lassen.',
};

/** True, wenn alle genannten Quellen noch nicht verbunden sind (Status 'missing'). */
export function notConnected(sources: ConnectionId[], connections: Connection[]): boolean {
  return sources.length > 0 && sources.every((id) => connections.find((c) => c.id === id)?.status === 'missing');
}

/** Quellen, aus denen sich der Stand eines Vertrags speist: Banküberweisung → Bank, Stripe → Stripe NEXUS. */
export function contractSources(c: MemberContract): ConnectionId[] {
  return c.billing === 'legacy' ? ['bank'] : ['stripe_nexus'];
}

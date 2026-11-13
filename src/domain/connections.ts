import type { Company, Connection, ConnectionId, MemberContract } from './types';

export const CONNECTION_CATALOG: readonly { id: ConnectionId; company: Company | null; label: string }[] = [
  { id: 'lexware_nexus', company: 'nexus', label: 'Lexware NEXUS' },
  { id: 'lexware_zulassung', company: 'zulassung', label: 'Lexware Zulassungsdienst' },
  { id: 'stripe_nexus', company: 'nexus', label: 'Stripe NEXUS' },
  { id: 'bank_qonto', company: 'nexus', label: 'Qonto (NEXUS)' },
  { id: 'bank_sparkasse', company: 'zulassung', label: 'Sparkasse (Zulassung)' },
  { id: 'gmail', company: null, label: 'Gmail' },
  { id: 'icloud', company: null, label: 'iCloud-Mail' },
  { id: 'info_mail', company: 'zulassung', label: 'info@-Postfach' },
  { id: 'calendar', company: null, label: 'Kalender' },
  { id: 'whatsapp_kunden', company: 'zulassung', label: 'WhatsApp Kunden' },
  { id: 'whatsapp_assistent', company: null, label: 'WhatsApp Assistent' },
  { id: 'portal_nexus', company: 'nexus', label: 'NEXUS-Portal' },
];

/** Kurzanleitung für die echte Anbindung in Phase 2. */
export const HOW_TO: Record<ConnectionId, string> = {
  lexware_nexus: 'Schlüssel als Vercel-Variable LEXWARE_NEXUS_API_KEY hinterlegen (nur lesen: Kontakte, Rechnungen, Zahlungen).',
  lexware_zulassung: 'Schlüssel als Vercel-Variable LEXWARE_ZULASSUNG_API_KEY hinterlegen (nur lesen: Kontakte, Rechnungen, Zahlungen).',
  stripe_nexus: 'Schlüssel als Vercel-Variable STRIPE_RESTRICTED_KEY hinterlegen (nur lesen: Kunden, Abos, Rechnungen, Zahlungen).',
  bank_qonto: 'Qonto → Einstellungen → Integrationen → API-Schlüssel: Login und Secret Key als Vercel-Variablen QONTO_LOGIN und QONTO_SECRET_KEY hinterlegen (nur lesen).',
  bank_sparkasse: 'Kommt als Upload (CAMT- oder CSV-Export).',
  gmail: 'Mit dem Google-Login freigeben.',
  icloud: 'App-spezifisches Passwort in der Apple-ID erstellen.',
  info_mail: 'Anbieter des info@-Postfachs klären (Zugangsart und Zugangsdaten).',
  calendar: 'Google- oder iCloud-Kalender freigeben.',
  whatsapp_kunden: 'Coexistence über einen Anbieter: Die WhatsApp-Business-App bleibt nutzbar.',
  whatsapp_assistent: 'Zweite Nummer einrichten und Meta-Vorlagen für Briefings freigeben lassen.',
  portal_nexus: 'Mitgliederliste auf portal.nexusnetzwerk.de/mitglieder kopieren (oder als CSV speichern) und unter NEXUS → Portal-Mitglieder → „Mitgliederliste einfügen“ übernehmen.',
};

/** True, wenn alle genannten Quellen noch nicht verbunden sind (Status 'missing'). */
export function notConnected(sources: ConnectionId[], connections: Connection[]): boolean {
  return sources.length > 0 && sources.every((id) => connections.find((c) => c.id === id)?.status === 'missing');
}

/** Quellen, aus denen sich der Stand eines Vertrags speist: Banküberweisung → Bank, Stripe → Stripe NEXUS. */
export function contractSources(c: MemberContract): ConnectionId[] {
  return c.billing === 'legacy' ? ['bank_qonto'] : ['stripe_nexus'];
}

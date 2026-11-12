import type { Company, Connection, ConnectionId } from './types';

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

/** True, wenn alle genannten Quellen noch nicht verbunden sind (Status 'missing'). */
export function notConnected(sources: ConnectionId[], connections: Connection[]): boolean {
  return sources.length > 0 && sources.every((id) => connections.find((c) => c.id === id)?.status === 'missing');
}

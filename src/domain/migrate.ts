import { CONNECTION_CATALOG } from './connections';
import { normalizeIban } from './matching/payments';
import type { AppState, Connection, ConnectionId } from './types';

// 'bank' ist nicht mehr im Typ ConnectionId, deshalb lose verglichen.
const LEGACY = 'bank';
const NEW_ID: ConnectionId = 'bank_qonto';
const isLegacy = (id: unknown) => (id as string) === LEGACY;

/**
 * Hebt gespeicherte Stände (localStorage, Datenbank) auf das aktuelle Schema: Verbindung `bank` heißt jetzt
 * `bank_qonto`, IBANs sind normalisiert. Idempotent; gibt bei nichts zu tun dasselbe Objekt zurück.
 */
export function migrateState(s: AppState): AppState {
  let changed = false;

  let connections = s.connections;
  if (connections.some((c) => isLegacy(c.id))) {
    changed = true;
    const hasNew = connections.some((c) => c.id === NEW_ID);
    const label = CONNECTION_CATALOG.find((c) => c.id === NEW_ID)!.label;
    connections = connections.flatMap((c): Connection[] => {
      if (!isLegacy(c.id)) return [c];
      return hasNew ? [] : [{ ...c, id: NEW_ID, company: 'nexus', label }];
    });
  }

  let payments = s.payments;
  if (payments.some((p) => isLegacy(p.connectionId) || (p.iban !== undefined && p.iban !== normalizeIban(p.iban)))) {
    changed = true;
    payments = payments.map((p) => {
      const iban = p.iban === undefined ? undefined : normalizeIban(p.iban);
      const connectionId = isLegacy(p.connectionId) ? NEW_ID : p.connectionId;
      return { ...p, connectionId, ...(iban === undefined ? {} : { iban }) };
    });
  }

  let ibanLinks = s.ibanLinks;
  const normalized = ibanLinks.map((l) => ({ ...l, iban: normalizeIban(l.iban) }));
  const unique = normalized.filter((l, i) => normalized.findIndex((x) => x.iban === l.iban) === i);
  if (unique.length !== ibanLinks.length || unique.some((l, i) => l.iban !== ibanLinks[i].iban)) {
    changed = true;
    ibanLinks = unique;
  }

  let insights = s.insights;
  if (insights.some((i) => i.needsSources.some(isLegacy))) {
    changed = true;
    insights = insights.map((i) => ({ ...i, needsSources: i.needsSources.map((id) => (isLegacy(id) ? NEW_ID : id)) }));
  }

  return changed ? { ...s, connections, payments, ibanLinks, insights } : s;
}

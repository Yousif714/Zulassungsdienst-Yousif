'use client';

import { DemoBadge } from '@/components/DemoBadge';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { COMPANY_LABEL } from '@/components/MoneyCard';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { now } from '@/domain/clock';
import { ageMinutes } from '@/domain/freshness';
import type { Connection, ConnectionId } from '@/domain/types';

const STATUS_LABEL: Record<Connection['status'], string> = { connected: 'Verbunden', error: 'Störung', missing: 'Nicht verbunden' };

/** Kurzanleitung für die echte Anbindung in Phase 2. */
const HOW_TO: Record<ConnectionId, string> = {
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

export default function ConnectionsPage() {
  const { state, dispatch, mode } = useAppStore();
  const at = now();

  return (
    <>
      <PageHeader title="Verbindungen" badge={<DemoBadge />} />
      <ListGroup title="Quellen" testId="connections">
        {state.connections.map((c) => {
          const age = ageMinutes(c, at);
          const subtitle = [c.company ? COMPANY_LABEL[c.company] : 'Firmenübergreifend', STATUS_LABEL[c.status], age === null ? 'Noch nie abgerufen' : `Stand vor ${age} Min.`].join(' · ');
          return (
            <div key={c.id}>
              <ListRow testId={`conn-${c.id}`} title={<span className="wrap-text">{c.label}</span>} subtitle={<span className="wrap-text">{subtitle}</span>}
                accessory={mode !== 'demo' ? undefined : c.status === 'connected'
                  ? <button type="button" className="btn btn-secondary btn-small" onClick={() => dispatch({ type: 'setConnectionStatus', id: c.id, status: 'error' })}>Störung simulieren</button>
                  : <button type="button" className="btn btn-secondary btn-small" onClick={() => dispatch({ type: 'setConnectionStatus', id: c.id, status: 'connected' })}>Wieder verbinden</button>} />
              <details className="conn-help" data-testid={`conn-help-${c.id}`}>
                <summary>So verbindest du das (Phase 2)</summary>
                <p>{HOW_TO[c.id]}</p>
              </details>
            </div>
          );
        })}
      </ListGroup>
    </>
  );
}

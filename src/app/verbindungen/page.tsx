'use client';

import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { COMPANY_LABEL } from '@/components/MoneyCard';
import { PageHeader } from '@/components/PageHeader';
import { SetupChecklist } from '@/components/SetupChecklist';
import { useAppStore } from '@/data/store';
import { now } from '@/domain/clock';
import { HOW_TO } from '@/domain/connections';
import { ageMinutes } from '@/domain/freshness';
import type { Connection } from '@/domain/types';

const STATUS_LABEL: Record<Connection['status'], string> = { connected: 'Verbunden', error: 'Störung', missing: 'Nicht verbunden' };

/** Quellen mit Status und Stand; im Demo-Modus mit Simulations-Knöpfen. */
function SourceList() {
  const { state, dispatch, mode } = useAppStore();
  const at = now();
  return (
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
  );
}

/** Echtmodus: Einrichtungs-Liste statt Simulation. Demo und offline: Quellenliste. */
export default function ConnectionsPage() {
  const { state, mode } = useAppStore();
  return (
    <>
      <PageHeader title="Verbindungen" />
      {mode === 'real' ? <SetupChecklist connections={state.connections} /> : <SourceList />}
    </>
  );
}

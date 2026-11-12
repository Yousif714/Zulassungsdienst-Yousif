'use client';

import { DemoBadge } from '@/components/DemoBadge';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { COMPANY_LABEL } from '@/components/MoneyCard';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { now } from '@/domain/clock';
import { ageMinutes } from '@/domain/freshness';
import type { Connection } from '@/domain/types';

const STATUS_LABEL: Record<Connection['status'], string> = { connected: 'Verbunden', error: 'Störung', missing: 'Nicht verbunden' };

export default function ConnectionsPage() {
  const { state, dispatch } = useAppStore();
  const at = now();

  return (
    <>
      <PageHeader title="Verbindungen" badge={<DemoBadge />} />
      <ListGroup title="Quellen" testId="connections">
        {state.connections.map((c) => {
          const age = ageMinutes(c, at);
          const subtitle = [c.company ? COMPANY_LABEL[c.company] : 'Firmenübergreifend', STATUS_LABEL[c.status], age === null ? 'Noch nie abgerufen' : `Stand vor ${age} Min.`].join(' · ');
          return (
            <ListRow key={c.id} testId={`conn-${c.id}`} title={<span className="wrap-text">{c.label}</span>} subtitle={<span className="wrap-text">{subtitle}</span>}
              accessory={c.status === 'connected'
                ? <button type="button" className="btn btn-secondary btn-small" onClick={() => dispatch({ type: 'setConnectionStatus', id: c.id, status: 'error' })}>Störung simulieren</button>
                : <button type="button" className="btn btn-secondary btn-small" onClick={() => dispatch({ type: 'setConnectionStatus', id: c.id, status: 'connected' })}>Wieder verbinden</button>} />
          );
        })}
      </ListGroup>
    </>
  );
}

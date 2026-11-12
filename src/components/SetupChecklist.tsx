import { HOW_TO } from '@/domain/connections';
import type { Connection } from '@/domain/types';

import { IconCheck } from './Icons';
import { ListGroup } from './ListGroup';
import { ListRow } from './ListRow';

/** Echtmodus: alle Verbindungen als Einrichtungs-Liste, Häkchen bei „verbunden“, sonst die Anleitung. */
export function SetupChecklist({ connections }: { connections: Connection[] }) {
  return (
    <ListGroup title="Einrichtung" testId="setup-checklist">
      {connections.map((c) => {
        const done = c.status === 'connected';
        return (
          <ListRow key={c.id} testId={`setup-${c.id}`}
            leading={done
              ? <span className="setup-mark" data-done="true" role="img" aria-label="Verbunden" data-testid="setup-check"><IconCheck /></span>
              : <span className="setup-mark" role="img" aria-label="Noch offen" />}
            title={<span className="wrap-text">{c.label}</span>}
            subtitle={<span className="wrap-text">{done ? 'Verbunden' : c.status === 'error' ? `Störung. ${HOW_TO[c.id]}` : HOW_TO[c.id]}</span>} />
        );
      })}
    </ListGroup>
  );
}

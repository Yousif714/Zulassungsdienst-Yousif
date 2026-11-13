import Link from 'next/link';

import { now } from '@/domain/clock';
import type { readerSummary } from '@/domain/import/invoice-reading';
import type { Connection } from '@/domain/types';

import { connectionSubtitle } from './connection-labels';
import { IconCheck } from './Icons';
import { ListGroup } from './ListGroup';
import { ListRow } from './ListRow';

/** Sparkasse hat keine Schnittstelle: Knopf zur Upload-Seite statt Simulation bzw. Anleitung. */
export function StatementUploadLink() {
  return <Link href="/zulassung/zuordnen" className="btn btn-secondary btn-small">Auszug hochladen</Link>;
}

/** Echtmodus: alle Verbindungen als Einrichtungs-Liste, Häkchen bei „verbunden“, sonst die Anleitung. */
export function SetupChecklist({ connections, reader }: { connections: Connection[]; reader?: ReturnType<typeof readerSummary> }) {
  const at = now();
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
            subtitle={<span className="wrap-text">{connectionSubtitle(c, at, reader)}</span>}
            accessory={c.id === 'bank_sparkasse' ? <StatementUploadLink /> : undefined} />
        );
      })}
    </ListGroup>
  );
}

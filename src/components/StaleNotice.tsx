'use client';

import { useAppStore } from '@/data/store';
import { notConnected } from '@/domain/connections';
import type { ConnectionId } from '@/domain/types';

import { IconWarning } from './Icons';

/** Hinweis, dass eine Aussage wegen veralteter Quellen nicht möglich ist. */
export function StaleNotice({ sources }: { sources: ConnectionId[] }) {
  const { state } = useAppStore();
  const labels = sources.map((id) => state.connections.find((c) => c.id === id)?.label ?? id);
  return (
    <div className="stale-notice" data-testid="stale-notice" role="note">
      <IconWarning />
      <div>
        <div>{notConnected(sources, state.connections) ? 'Noch nicht verbunden' : 'Datenstand zu alt, um das zu beurteilen'}</div>
        {labels.length > 0 && <div className="stale-notice-sources">Quelle: {labels.join(', ')}</div>}
      </div>
    </div>
  );
}

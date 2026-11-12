'use client';

import { DemoBadge } from '@/components/DemoBadge';
import { IconLog } from '@/components/Icons';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { formatBerlin } from '@/domain/clock';
import type { AuditEntry } from '@/domain/types';

const ACTOR: Record<AuditEntry['actor'], string> = { owner: 'Inhaber', assistant: 'Assistent', system: 'System' };

export default function ProtokollPage() {
  const { state } = useAppStore();
  // Das Protokoll wird nur angehängt: umgekehrte Reihenfolge = neueste zuerst, auch bei gleicher Demo-Uhrzeit.
  const list = state.audit.map((e, i) => ({ e, i })).reverse();

  return (
    <>
      <PageHeader title="Protokoll" subtitle="Alles, was die App getan hat." />
      {list.length === 0 ? (
        <div className="empty-state">
          <IconLog size={40} />
          <div>Noch keine Einträge.</div>
        </div>
      ) : (
        <ListGroup testId="audit-list">
          {list.map(({ e, i }) => (
            <ListRow key={i} testId="audit-row" title={<span className="wrap-text">{e.text}</span>}
              subtitle={`${formatBerlin(new Date(e.at), 'dd.MM. HH:mm')} · ${ACTOR[e.actor]}`}
              accessory={e.isDemo ? <DemoBadge /> : undefined} />
          ))}
        </ListGroup>
      )}
    </>
  );
}

'use client';

import { DemoBadge } from '@/components/DemoBadge';
import { IconLog } from '@/components/Icons';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { formatBerlin } from '@/domain/clock';
import type { AuditEntry } from '@/domain/types';

type Row = { key: string; latest: AuditEntry; index: number; steps: string[] };

/** Neueste zuerst. Einträge derselben Aktion bilden eine Zeile (letzter Stand), frühere Schritte stehen kurz darunter. */
function rows(audit: AuditEntry[]): Row[] {
  const out: Row[] = [];
  const byAction = new Map<string, Row>();
  audit.forEach((e, i) => {
    const row = e.actionId ? byAction.get(e.actionId) : undefined;
    if (row) {
      row.steps.push(row.latest.text.split(':')[0]);
      row.latest = e;
      row.index = i;
      return;
    }
    const fresh: Row = { key: e.actionId ?? `e-${i}`, latest: e, index: i, steps: [] };
    if (e.actionId) byAction.set(e.actionId, fresh);
    out.push(fresh);
  });
  // Das Protokoll wird nur angehängt: der Index ist die Reihenfolge, auch bei gleicher Demo-Uhrzeit.
  return out.sort((a, b) => b.index - a.index);
}

export default function ProtokollPage() {
  const { state } = useAppStore();
  const list = rows(state.audit);

  return (
    <>
      <PageHeader title="Protokoll" />
      {list.length === 0 ? (
        <div className="empty-state">
          <IconLog size={40} />
          <div>Noch keine Einträge.</div>
        </div>
      ) : (
        <ListGroup testId="audit-list">
          {list.map(({ key, latest, steps }) => (
            <ListRow key={key} testId="audit-row" title={latest.text}
              subtitle={[formatBerlin(new Date(latest.at), 'dd.MM. HH:mm'), ...(steps.length ? [steps.join(' → ')] : [])].join(' · ')}
              accessory={latest.isDemo ? <DemoBadge /> : undefined} />
          ))}
        </ListGroup>
      )}
    </>
  );
}

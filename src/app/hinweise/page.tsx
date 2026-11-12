'use client';

import { BackLink } from '@/components/BackLink';
import { ListGroup } from '@/components/ListGroup';
import { PageHeader } from '@/components/PageHeader';
import { TaskRow } from '@/components/TaskRow';
import { openInsights } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { selectTop } from '@/domain/detectors';
import type { Insight } from '@/domain/types';

const GROUPS: { priority: Insight['priority']; title: string }[] = [
  { priority: 'now', title: 'Jetzt' },
  { priority: 'today', title: 'Heute' },
  { priority: 'info', title: 'Info' },
];

export default function HinweisePage() {
  const { state, dispatch } = useAppStore();
  const open = openInsights(state);
  const sorted = selectTop(open, open.length);

  return (
    <>
      <PageHeader title="Alle Hinweise" subtitle={`${open.length} offen`} trailing={<BackLink href="/" label="Heute" />} />
      {open.length === 0 && <div className="empty-state">Alles erledigt.</div>}
      {GROUPS.map(({ priority, title }) => {
        const list = sorted.filter((i) => i.priority === priority);
        if (list.length === 0) return null;
        return (
          <ListGroup key={priority} title={`${title} (${list.length})`} testId={`insights-${priority}`}>
            {list.map((i) => <TaskRow key={i.dedupeKey} insight={i} onDone={() => dispatch({ type: 'dismissInsight', key: i.dedupeKey })} />)}
          </ListGroup>
        );
      })}
    </>
  );
}

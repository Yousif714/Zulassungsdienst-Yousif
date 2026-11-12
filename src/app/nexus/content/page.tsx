'use client';

import { BackLink } from '@/components/BackLink';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { formatIsoDe } from '@/domain/clock';
import type { ContentItem } from '@/domain/types';

const STAGES: { stage: ContentItem['stage']; label: string }[] = [
  { stage: 'idea', label: 'Idee' },
  { stage: 'raw', label: 'Rohmaterial' },
  { stage: 'edit', label: 'Schnitt' },
  { stage: 'approval', label: 'Freigabe' },
  { stage: 'published', label: 'Veröffentlicht' },
];

export default function ContentPage() {
  const { state } = useAppStore();
  return (
    <>
      <PageHeader title="Content" subtitle="Vom Einfall bis zur Veröffentlichung" trailing={<BackLink href="/nexus" label="NEXUS" />} />
      <div className="board" tabIndex={0} role="region" aria-label="Content-Board">
        {STAGES.map(({ stage, label }) => {
          const items = state.content.filter((c) => c.stage === stage);
          return (
            <section key={stage} className="board-column" data-testid="content-stage" data-stage={stage} aria-labelledby={`stage-${stage}`}>
              <h2 id={`stage-${stage}`} className="list-group-title">{label} <span className="board-count">{items.length}</span></h2>
              <ul className="board-items">
                {items.length === 0 && <li className="board-empty">Nichts in dieser Stufe.</li>}
                {items.map((c) => (
                  <li key={c.id} className="board-card">
                    <div className="board-card-title">{c.title}</div>
                    {c.due && <div className="board-card-due">fällig {formatIsoDe(c.due)}</div>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

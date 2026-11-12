'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import { DemoBadge } from '@/components/DemoBadge';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { MoneyCard } from '@/components/MoneyCard';
import { MoreMenu } from '@/components/MoreMenu';
import { PageHeader } from '@/components/PageHeader';
import { TaskRow } from '@/components/TaskRow';
import { openInsights } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { MONEY_SOURCES, buildBriefing, renderBriefingText } from '@/domain/briefing';
import { formatBerlin, formatBerlinDe, now } from '@/domain/clock';
import { areaStale } from '@/domain/freshness';
import { openReplies } from '@/domain/matching/messages';
import type { StoredInsight } from '@/domain/types';

function CoachTip({ tip, onTake, onLater, onNever }: { tip: StoredInsight; onTake: () => void; onLater: () => void; onNever: () => void }) {
  const href = tip.refs[0]?.href;
  return (
    <section className="list-group" data-testid="coach-tip">
      <h2 className="list-group-title">Coach-Tipp</h2>
      <div className="coach-card">
        <div className="coach-title">{href ? <Link href={href}>{tip.title}</Link> : tip.title}</div>
        {tip.body && <p className="coach-body">{tip.body}</p>}
        <div className="coach-buttons">
          <button type="button" className="btn btn-primary" onClick={onTake}>Übernehmen</button>
          <button type="button" className="btn btn-secondary" onClick={onLater}>Später</button>
          <button type="button" className="btn btn-plain" onClick={onNever}>Nicht mehr vorschlagen</button>
        </div>
      </div>
    </section>
  );
}

export default function HeutePage() {
  const { state, dispatch } = useAppStore();
  const [showBriefing, setShowBriefing] = useState(false);
  const briefingId = useId();
  const at = now();

  const briefing = buildBriefing(state, 'morning', at);
  const allOpen = openInsights(state);
  const coachTip = briefing.coach[0];
  const replies = openReplies(state.messages, at, state.settings.replyThresholdHours);

  return (
    <>
      <PageHeader title="Heute" subtitle={formatBerlinDe(at, 'EEEE, d. MMMM')} badge={<DemoBadge />} trailing={<MoreMenu />} />

      <ListGroup title="Wichtig heute" testId="top-insights">
        {briefing.top.length === 0
          ? <ListRow key="empty" title="Alles erledigt." />
          : briefing.top.map((i) => <TaskRow key={i.dedupeKey} insight={i} onDone={() => dispatch({ type: 'dismissInsight', key: i.dedupeKey })} />)}
        <ListRow key="all" href="/hinweise" title={`Alle Hinweise (${allOpen.length})`} testId="all-insights-link" />
      </ListGroup>

      <ListGroup title="Termine heute" testId="events-today">
        {briefing.events.length === 0
          ? <ListRow key="empty" title="Keine Termine heute." />
          : briefing.events.map((e) => (
            <ListRow key={e.id} title={e.title} subtitle={e.location} value={formatBerlin(new Date(e.startAt), 'HH:mm')} />
          ))}
      </ListGroup>

      <section className="money-cards" aria-label="Geld">
        {briefing.money.map((m) => (
          <MoneyCard key={m.company} company={m.company} openCents={m.openCents} overdueCents={m.overdueCents}
            stale={areaStale(MONEY_SOURCES[m.company], state.connections, at)} />
        ))}
      </section>

      <ListGroup title="Nachrichten" testId="replies">
        {replies.length === 0
          ? <ListRow key="empty" title="Keine offenen Antworten." />
          : replies.map(({ message: m, waitingHours }) => (
            <ListRow key={m.id} href={`/nachrichten/${m.threadId}`} testId="reply-row"
              title={state.contacts.find((c) => c.id === m.contactId)?.name ?? m.from}
              subtitle={m.body} value={`${waitingHours} Std.`} />
          ))}
      </ListGroup>

      {coachTip && (
        <CoachTip key={coachTip.dedupeKey} tip={coachTip}
          onTake={() => dispatch({ type: 'dismissInsight', key: coachTip.dedupeKey })}
          onLater={() => dispatch({ type: 'snoozeInsight', key: coachTip.dedupeKey })}
          onNever={() => dispatch({ type: 'suppressCoach', key: coachTip.dedupeKey })} />
      )}

      <section className="briefing">
        <button type="button" className="nav-button" aria-expanded={showBriefing} aria-controls={briefingId} onClick={() => setShowBriefing((v) => !v)}>
          {showBriefing ? 'Morgenbriefing ausblenden' : 'Morgenbriefing ansehen'}
        </button>
        <div id={briefingId} className="briefing-panel" data-testid="briefing-text" hidden={!showBriefing}>
          {renderBriefingText(briefing)}
        </div>
      </section>
    </>
  );
}

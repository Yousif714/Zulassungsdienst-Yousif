'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { formatEuro } from '@/domain/money';
import type { Insight } from '@/domain/types';

import { IconCheck } from './Icons';
import { COMPANY_LABEL } from './MoneyCard';

const PRIORITY: Record<Insight['priority'], { color: string; label: string }> = {
  now: { color: 'var(--red)', label: 'Jetzt' },
  today: { color: 'var(--orange)', label: 'Heute' },
  info: { color: 'var(--gray)', label: 'Info' },
};

/** Aufgabe im Stil von Erinnerungen: runder Haken links (wenn `onDone`), Tipp öffnet `refs[0].href`. */
export function TaskRow({ insight, onDone }: { insight: Insight; onDone?: () => void }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const complete = () => {
    if (done || !onDone) return;
    setDone(true);
    // Kurz den gefüllten Haken zeigen, dann melden – wie in Erinnerungen.
    timer.current = setTimeout(onDone, 350);
  };

  const prio = PRIORITY[insight.priority];
  const href = insight.refs[0]?.href;
  const body = (
    <>
      <div className="task-text">
        <div className="task-title">{insight.title}</div>
        {insight.body && <div className="task-note">{insight.body}</div>}
        <div className="task-meta">
          <span className="priority-dot" style={{ background: prio.color }} aria-hidden="true" />
          <span>{prio.label}</span>
          {insight.company && <span className="chip">{COMPANY_LABEL[insight.company]}</span>}
        </div>
      </div>
      {insight.amountCents !== undefined && <span className="task-amount">{formatEuro(insight.amountCents)}</span>}
    </>
  );

  return (
    <div className={onDone ? 'task-row' : 'task-row task-row-plain'} data-testid="insight-row" data-key={insight.dedupeKey} data-done={done}>
      {onDone && (
        <button type="button" className="task-check" onClick={complete} aria-label={`Erledigt: ${insight.title}`} aria-pressed={done}>
          <span className="task-check-ring"><IconCheck /></span>
        </button>
      )}
      {href ? <Link href={href} className="task-body">{body}</Link> : <div className="task-body">{body}</div>}
    </div>
  );
}

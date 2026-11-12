'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { formatEuro } from '@/domain/money';
import type { Insight } from '@/domain/types';

import { IconCheck } from './Icons';
import { COMPANY_LABEL } from './MoneyCard';

const PRIORITY: Record<Insight['priority'], { color: string; label: string }> = {
  now: { color: 'var(--red)', label: 'Jetzt' },
  today: { color: 'var(--orange)', label: 'Heute' },
  info: { color: 'var(--gray)', label: 'Info' },
};

/** Ab hier gilt die Bewegung als Wischen (px); darunter bleibt es ein Tippen. */
const SLOP = 10;
/** Anteil der Breite oder Wurf-Geschwindigkeit (px/ms), ab der ein Wischen auslöst. */
const COMMIT_SHARE = 0.38;
const COMMIT_VELOCITY = 0.55;
const SHOW_DONE_MS = 300;
const COLLAPSE_MS = 300;

type Drag = { id: number; x: number; y: number; t: number; dx: number; mode: 'pending' | 'swipe' | 'scroll' };

/**
 * Aufgabe im Stil von Erinnerungen: runder Haken links (wenn `onDone`), Tipp öffnet `refs[0].href`.
 * Wischen wie in Mail: nach links → erledigt, nach rechts → später (`onLater`). Per Tastatur bleiben
 * der Haken und „Zurückstellen“ (erscheint bei Fokus) bedienbar.
 */
export function TaskRow({ insight, onDone, onLater }: { insight: Insight; onDone?: () => void; onLater?: () => void }) {
  const [done, setDone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [swipe, setSwipe] = useState<{ dir: 'left' | 'right' | null; active: boolean; settling: boolean }>({ dir: null, active: false, settling: false });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const setX = (x: number) => {
    if (content.current) content.current.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
  };

  /** Erst kurz den gefüllten Haken zeigen, dann einklappen, dann melden – wie in Erinnerungen. */
  const complete = (afterSwipe = false) => {
    if (done || leaving || !onDone) return;
    setDone(true);
    later(() => setLeaving(true), afterSwipe ? 0 : SHOW_DONE_MS);
    later(onDone, (afterSwipe ? 0 : SHOW_DONE_MS) + COLLAPSE_MS);
  };
  const postpone = () => {
    if (done || leaving || !onLater) return;
    setLeaving(true);
    later(onLater, COLLAPSE_MS);
  };

  const canSwipe = !!(onDone || onLater);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canSwipe || leaving || drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, mode: 'pending' };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || d.mode === 'scroll') return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.mode === 'pending') {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) { d.mode = 'scroll'; return; }
      if (Math.abs(dx) <= SLOP) return;
      d.mode = 'swipe';
      e.currentTarget.setPointerCapture(e.pointerId);
      setSwipe({ dir: null, active: true, settling: false });
    }
    // Richtung ohne passende Aktion: nur zäh nachgeben (Reibung statt harter Wand).
    const allowed = dx < 0 ? !!onDone : !!onLater;
    const x = allowed ? dx : dx * 0.15;
    d.dx = x;
    setX(x);
    const dir = x < 0 ? 'left' : x > 0 ? 'right' : null;
    setSwipe((s) => (s.dir === dir ? s : { ...s, dir }));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.mode !== 'swipe') return;
    swallowClick.current = true; // der folgende Klick gehört zum Wischen, nicht zum Link
    later(() => { swallowClick.current = false; }, 80);
    const width = content.current?.offsetWidth ?? 320;
    const velocity = Math.abs(d.dx) / Math.max(1, performance.now() - d.t);
    const far = Math.abs(d.dx) > width * COMMIT_SHARE || (velocity > COMMIT_VELOCITY && Math.abs(d.dx) > 30);
    const action = !cancelled && far ? (d.dx < 0 ? (onDone ? 'done' : null) : (onLater ? 'later' : null)) : null;
    setSwipe({ dir: action ? (d.dx < 0 ? 'left' : 'right') : null, active: false, settling: true });
    if (action) {
      setX(d.dx < 0 ? -width : width);
      if (action === 'done') complete(true);
      else postpone();
    } else {
      setX(0);
      later(() => setSwipe((s) => ({ ...s, dir: null, settling: false })), 420);
    }
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
    <div className={onDone ? 'task-row' : 'task-row task-row-plain'} data-testid="insight-row" data-key={insight.dedupeKey} data-done={done}
      data-leaving={leaving} data-swiping={swipe.active} data-settling={swipe.settling} data-swipe-dir={swipe.dir ?? undefined}>
      <div className="task-row-inner">
        {canSwipe && (
          <div className="task-swipe-bg" aria-hidden="true">
            <span className="task-swipe-later">{onLater ? 'Später' : ''}</span>
            <span className="task-swipe-done">{onDone ? 'Erledigt' : ''}</span>
          </div>
        )}
        <div className="task-row-content" ref={content}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={(e) => endDrag(e, false)} onPointerCancel={(e) => endDrag(e, true)}
          onClickCapture={(e) => {
            if (!swallowClick.current) return;
            swallowClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}>
          {onDone && (
            <button type="button" className="task-check" onClick={() => complete()} aria-label={`Erledigt: ${insight.title}`} aria-pressed={done}>
              <span className="task-check-ring"><IconCheck /></span>
            </button>
          )}
          {href ? <Link href={href} className="task-body" draggable={false}>{body}</Link> : <div className="task-body">{body}</div>}
        </div>
      </div>
      {onLater && (
        <button type="button" className="task-later-key" onClick={postpone}>Zurückstellen<span className="visually-hidden">: {insight.title}</span></button>
      )}
    </div>
  );
}

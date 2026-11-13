'use client';

import { useEffect, useRef, useState } from 'react';

import { useAppStore } from '@/data/store';
import { PULL_THRESHOLD, pullBlocked, pullProgress } from '@/data/refresh';

/**
 * Herunterziehen zum Aktualisieren (die installierte iPhone-App hat es nicht von Haus aus). Nur im Echtmodus,
 * nur wenn die Seite ganz oben steht. Vorwiegend waagerechte Bewegungen (Wisch-Aktionen, Quer-Scrollen) zählen nicht.
 */
export function PullToRefresh() {
  const { mode, reload } = useAppStore();
  const [pull, setPull] = useState(0); // 0..1+
  const [busy, setBusy] = useState(false);
  const reloadRef = useRef(reload);
  const start = useRef<{ x: number; y: number } | null>(null);
  const progress = useRef(0);

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  useEffect(() => {
    if (mode !== 'real') return;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      // Nur am oberen Rand, nicht in Dialogen, Eingaben oder bereits gescrollten Bereichen.
      const blocked = e.target instanceof Element && pullBlocked(e.target);
      start.current = window.scrollY <= 0 && !blocked && e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start.current || !t) return;
      if (window.scrollY > 0) { start.current = null; progress.current = 0; setPull(0); return; }
      progress.current = pullProgress(t.clientX - start.current.x, t.clientY - start.current.y);
      setPull(progress.current);
    };
    const onEnd = () => {
      const fire = start.current !== null && progress.current >= 1;
      start.current = null;
      progress.current = 0;
      setPull(0);
      if (!fire) return;
      setBusy(true);
      void reloadRef.current().finally(() => setBusy(false));
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [mode]);

  if (mode !== 'real' || (pull === 0 && !busy)) return null;
  const shown = busy ? 1 : Math.min(pull, 1);
  return (
    <div className="ptr" role="status" aria-live="polite" data-testid="pull-indicator"
      style={{ opacity: shown, transform: `translate(-50%, ${Math.round(shown * PULL_THRESHOLD * 0.5)}px)` }}>
      <span className="ptr-spinner" data-busy={busy || pull >= 1} aria-hidden="true" />
      <span className="ptr-label">{busy ? 'Aktualisiere …' : pull >= 1 ? 'Loslassen zum Aktualisieren' : 'Zum Aktualisieren ziehen'}</span>
    </div>
  );
}

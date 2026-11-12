'use client';

import { useEffect, useRef, useState } from 'react';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Zahl, die beim Erscheinen hochzählt (bei Änderungen vom alten zum neuen Wert).
 * Im Text steht immer der Endwert (Vorlesen, Kopieren, Tests); die laufende Zahl ist nur eine
 * Überlagerung per CSS (`data-shown`). Bei „weniger Bewegung“ keine Zählung.
 */
export function CountUp({ value, format, duration = 700 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState<number | null>(0);
  const current = useRef(0);

  useEffect(() => {
    const from = current.current;
    if (from === value || reducedMotion()) {
      current.current = value;
      setShown(null);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4); // weich auslaufend
      current.current = p === 1 ? value : Math.round(from + (value - from) * eased);
      setShown(p === 1 ? null : current.current);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <span className="count-up" data-shown={shown === null ? undefined : format(shown)}>{format(value)}</span>
  );
}

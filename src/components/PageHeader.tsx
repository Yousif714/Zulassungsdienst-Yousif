'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Kopfzeile mit großem Titel (iOS Large Title), mittig. `trailing` sitzt in der Navigationszeile
 * (Zurück-Knopf links, sonst rechts). Scrollt der Titel unter die Zeile, erscheint er dort kompakt.
 */
export function PageHeader({ title, subtitle, trailing, badge }: { title: string; subtitle?: ReactNode; trailing?: ReactNode; badge?: ReactNode }) {
  const { barRef, targetRef, past } = useScrolledPast<HTMLHeadingElement>();
  return (
    <header className="page-header" data-compact={past}>
      <div className="page-header-bar" ref={barRef}>
        <span className="page-header-compact" data-title={title} aria-hidden="true" />
        {trailing && <div className="page-header-slot">{trailing}</div>}
      </div>
      <div className="page-header-row">
        <h1 className="large-title" ref={targetRef}>{title}</h1>
        {badge}
      </div>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </header>
  );
}

/** `past` wird wahr, sobald das Ziel (der große Titel) unter der klebenden Zeile verschwunden ist. */
function useScrolledPast<T extends HTMLElement>() {
  const barRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<T>(null);
  const [past, setPast] = useState(false);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const bar = barRef.current;
      const target = targetRef.current;
      if (!bar || !target || target.offsetParent === null) return;
      setPast(target.getBoundingClientRect().bottom - 8 < bar.getBoundingClientRect().bottom);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return { barRef, targetRef, past };
}

'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { IconMore } from './Icons';
import { SECONDARY_NAV } from './nav';

/** „Mehr“ oben rechts auf Heute (nur mobil): Disclosure mit Links zu den weiteren Bereichen. */
export function MoreMenu() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="more">
      <button ref={trigger} type="button" className="nav-button" data-testid="more-button" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}>
        <IconMore size={22} />
        <span>Mehr</span>
      </button>
      {open && <div className="more-backdrop" onClick={() => close(true)} aria-hidden="true" />}
      <nav id={panelId} className="more-menu" data-testid="more-menu" aria-label="Weitere Bereiche" hidden={!open}>
        {SECONDARY_NAV.map(({ key, href, label, Icon }) => (
          <Link key={key} href={href} className="more-item" data-testid={`more-${key}`} onClick={() => close(false)}>
            <span>{label}</span>
            <Icon size={20} />
          </Link>
        ))}
      </nav>
    </div>
  );
}

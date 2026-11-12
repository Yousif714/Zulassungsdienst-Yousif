'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { IconMore } from './Icons';
import { SECONDARY_NAV } from './nav';

/** „Mehr“ oben rechts auf Heute (nur mobil): Pull-down-Menü zu den weiteren Bereichen. */
export function MoreMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="more">
      <button type="button" className="nav-button" data-testid="more-button" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <IconMore size={22} />
        <span>Mehr</span>
      </button>
      {open && (
        <>
          <div className="more-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="more-menu" role="menu" data-testid="more-menu">
            {SECONDARY_NAV.map(({ key, href, label, Icon }) => (
              <Link key={key} href={href} role="menuitem" className="more-item" data-testid={`more-${key}`} onClick={() => setOpen(false)}>
                <span>{label}</span>
                <Icon size={20} />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

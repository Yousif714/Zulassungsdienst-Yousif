'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { PRIMARY_NAV, isActive } from './nav';

/** Mobile Tab-Leiste (< 768px): genau Heute · NEXUS · Zulassungsdienst. */
export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabbar" data-testid="tab-bar" aria-label="Hauptbereiche">
      {PRIMARY_NAV.map(({ key, href, label, Icon }) => (
        <Link key={key} href={href} className="tabbar-item" data-testid={`tab-${key}`}
          aria-current={isActive(href, pathname) ? 'page' : undefined}>
          <Icon size={26} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

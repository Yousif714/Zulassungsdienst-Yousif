'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { PRIMARY_NAV, SECONDARY_NAV, isActive, type NavItem } from './nav';

function Item({ item, pathname }: { item: NavItem; pathname: string }) {
  const { key, href, label, Icon } = item;
  return (
    <Link href={href} className="sidebar-item" data-testid={`nav-${key}`} aria-current={isActive(href, pathname) ? 'page' : undefined}>
      <Icon size={22} />
      <span>{label}</span>
    </Link>
  );
}

/** Seitenleiste ab 768px: Hauptbereiche plus Chat, Assistent, Verbindungen, Protokoll, Einstellungen. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="sidebar" data-testid="sidebar" aria-label="Navigation">
      <div className="sidebar-title">Nexus</div>
      {PRIMARY_NAV.map((item) => <Item key={item.key} item={item} pathname={pathname} />)}
      <div className="sidebar-section">Weitere</div>
      {SECONDARY_NAV.map((item) => <Item key={item.key} item={item} pathname={pathname} />)}
    </nav>
  );
}

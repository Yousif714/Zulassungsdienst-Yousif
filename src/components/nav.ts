import type { ComponentType, SVGProps } from 'react';

import { IconAssistant, IconCar, IconChat, IconGear, IconLink, IconLog, IconNexus, IconToday } from './Icons';

export type NavItem = { key: string; href: string; label: string; Icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }> };

/** Die drei Haupt-Tabs (mobil unten, am Desktop oben in der Seitenleiste). */
export const PRIMARY_NAV: NavItem[] = [
  { key: 'heute', href: '/', label: 'Heute', Icon: IconToday },
  { key: 'nexus', href: '/nexus', label: 'NEXUS', Icon: IconNexus },
  { key: 'zulassung', href: '/zulassung', label: 'Zulassungsdienst', Icon: IconCar },
];

/** Weitere Bereiche: am Desktop in der Seitenleiste, mobil über „Mehr“ auf Heute. */
export const SECONDARY_NAV: NavItem[] = [
  { key: 'chat', href: '/chat', label: 'Chat', Icon: IconChat },
  { key: 'assistent', href: '/assistent', label: 'Assistent (WhatsApp)', Icon: IconAssistant },
  { key: 'verbindungen', href: '/verbindungen', label: 'Verbindungen', Icon: IconLink },
  { key: 'protokoll', href: '/protokoll', label: 'Protokoll', Icon: IconLog },
  { key: 'einstellungen', href: '/einstellungen', label: 'Einstellungen', Icon: IconGear },
];

/** Aktiver Bereich für einen Pfad: Heute umfasst Startseite, Nachrichten und Hinweise. */
export function isActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/nachrichten') || pathname.startsWith('/hinweise');
  return pathname === href || pathname.startsWith(`${href}/`);
}

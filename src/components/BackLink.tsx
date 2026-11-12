import Link from 'next/link';

import { IconChevron } from './Icons';

/** Zurück-Knopf oben links in der Navigationszeile (iOS). */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="nav-button back-button">
      <IconChevron className="back-chevron" size={20} />
      <span>{label}</span>
    </Link>
  );
}

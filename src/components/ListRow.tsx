import Link from 'next/link';
import type { ReactNode } from 'react';

import { IconChevron } from './Icons';

type Props = { href?: string; title: ReactNode; subtitle?: ReactNode; value?: ReactNode; accessory?: ReactNode; testId?: string; leading?: ReactNode; role?: 'status' };

/** Zeile in einer `ListGroup`: Titel, Untertitel, Wert rechts (nowrap), Accessory oder Pfeil bei Link. Mind. 44px hoch. */
export function ListRow({ href, title, subtitle, value, accessory, testId, leading, role }: Props) {
  const content = (
    <>
      {leading}
      <div className="list-row-text">
        <div className="list-row-title">{title}</div>
        {subtitle && <div className="list-row-subtitle">{subtitle}</div>}
      </div>
      {value !== undefined && value !== null && <span className="list-row-value">{value}</span>}
      {accessory ? <span className="list-row-accessory">{accessory}</span> : href && <IconChevron className="chevron" />}
    </>
  );
  return href ? (
    <Link href={href} className="list-row" data-testid={testId}>{content}</Link>
  ) : (
    <div className="list-row" data-testid={testId} role={role}>{content}</div>
  );
}

import type { ReactNode } from 'react';

/** Kopfzeile mit großem Titel (iOS Large Title); `trailing` sitzt oben rechts in der Navigationszeile. */
export function PageHeader({ title, subtitle, trailing, badge }: { title: string; subtitle?: ReactNode; trailing?: ReactNode; badge?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-bar">{trailing}</div>
      <div className="page-header-row">
        <h1 className="large-title">{title}</h1>
        {badge}
      </div>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </header>
  );
}

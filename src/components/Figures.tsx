import type { ReactNode } from 'react';

import { formatEuro } from '@/domain/money';

/** Kennzahlen-Raster (Wallet-Stil) mit Abschnittsüberschrift. */
export function Figures({ title, children, columns }: { title: string; children: ReactNode; columns?: 4 }) {
  return (
    <section className="list-group">
      <h2 className="list-group-title">{title}</h2>
      <dl className="figures" data-columns={columns}>{children}</dl>
    </section>
  );
}

/** Eine Kennzahl: Bezeichnung und Betrag (`testId` am Betrag). */
export function Figure({ label, cents, testId, strong }: { label: string; cents: number; testId: string; strong?: boolean }) {
  return (
    <div className="figure" data-strong={strong}>
      <dt>{label}</dt>
      <dd className="amount" data-testid={testId}>{formatEuro(cents)}</dd>
    </div>
  );
}

/** Eine Kennzahl als Anzahl (oder Platzhalter wie „–“, wenn der Datenstand kein Urteil erlaubt). */
export function CountFigure({ label, value, testId }: { label: string; value: number | string; testId: string }) {
  return (
    <div className="figure">
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
}

import type { ReactNode } from 'react';

import { formatEuro } from '@/domain/money';

/** Kennzahlen-Raster (Wallet-Stil) mit Abschnittsüberschrift. */
export function Figures({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="list-group">
      <h2 className="list-group-title">{title}</h2>
      <dl className="figures">{children}</dl>
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

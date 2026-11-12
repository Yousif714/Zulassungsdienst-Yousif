'use client';

import type { ReactNode } from 'react';

import { formatEuro } from '@/domain/money';

import { CountUp } from './CountUp';

/** Kennzahlen-Raster (Wallet-Stil) mit Abschnittsüberschrift. */
export function Figures({ title, children, columns }: { title: string; children: ReactNode; columns?: 4 }) {
  return (
    <section className="list-group">
      <h2 className="list-group-title">{title}</h2>
      <dl className="figures" data-columns={columns}>{children}</dl>
    </section>
  );
}

/** Eine Kennzahl: Bezeichnung und Betrag (`testId` am Betrag). `arrears`: rot, wenn > 0, sonst neutral. */
export function Figure({ label, cents, testId, strong, arrears }: { label: string; cents: number; testId: string; strong?: boolean; arrears?: boolean }) {
  return (
    <div className="figure" data-strong={strong} data-tone={arrears ? (cents > 0 ? 'alert' : 'neutral') : undefined}>
      <dt>{label}</dt>
      <dd className="amount" data-testid={testId}><CountUp value={cents} format={formatEuro} /></dd>
    </div>
  );
}

/** Eine Kennzahl als Anzahl (oder Platzhalter wie „–“, wenn der Datenstand kein Urteil erlaubt). */
export function CountFigure({ label, value, testId }: { label: string; value: number | string; testId: string }) {
  return (
    <div className="figure">
      <dt>{label}</dt>
      <dd data-testid={testId}>{typeof value === 'number' ? <CountUp value={value} format={String} duration={500} /> : value}</dd>
    </div>
  );
}

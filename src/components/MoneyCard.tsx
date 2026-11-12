'use client';

import { formatEuro } from '@/domain/money';
import type { Company, ConnectionId } from '@/domain/types';

import { StaleNotice } from './StaleNotice';
import { CountUp } from './CountUp';

export const COMPANY_LABEL: Record<Company, string> = { nexus: 'NEXUS', zulassung: 'Zulassungsdienst' };

type Props = { company: Company; openCents: number; overdueCents: number; stale: ConnectionId[] };

/** Wallet-artige Karte: offene Beträge einer Firma. Bei veralteten Quellen (`stale` nicht leer) ohne Urteil zur Überfälligkeit. */
export function MoneyCard({ company, openCents, overdueCents, stale }: Props) {
  const isStale = stale.length > 0;
  return (
    <section className="money-card" data-company={company} data-stale={isStale} data-testid={`money-card-${company}`}>
      <div className="money-card-head">
        <span>{COMPANY_LABEL[company]}</span>
      </div>
      <div className="money-card-label">Offen</div>
      <div className="money-card-amount"><CountUp value={openCents} format={formatEuro} /></div>
      {isStale ? (
        <StaleNotice sources={stale} />
      ) : (
        overdueCents > 0 && (
          <div className="money-card-overdue">
            <span>Überfällig</span>
            <span className="amount">{formatEuro(overdueCents)}</span>
          </div>
        )
      )}
    </section>
  );
}

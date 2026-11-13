import { daysBetween } from '../clock';
import { formatEuro } from '../money';
import type { Installment, InstallmentState, IsoDate } from '../types';

export type MemberStatus = {
  dueCents: number;
  paidCents: number;
  arrearsCents: number;
  futureCents: number;
  openCents: number;
  traffic: 'green' | 'yellow' | 'red';
  oldestUnpaidDue: IsoDate | null;
  daysOverdue: number;
  nextDue: Installment | null;
  steps: string[];
};

function formatDe(d: IsoDate): string {
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

export function trafficFor(arrearsCents: number, daysOverdue: number): 'green' | 'yellow' | 'red' {
  return arrearsCents === 0 ? 'green' : daysOverdue <= 7 ? 'yellow' : 'red';
}

export function memberStatus(states: InstallmentState[], overpaidCents: number, today: IsoDate): MemberStatus {
  const due = states.filter((s) => s.dueDate <= today);
  const future = states.filter((s) => s.dueDate > today);

  const dueCents = due.reduce((n, s) => n + s.amountCents, 0);
  const paidCents = due.reduce((n, s) => n + s.paidCents, 0);
  const arrearsCents = Math.max(0, dueCents - paidCents);
  const futureRaw = future.reduce((n, s) => n + s.amountCents - s.paidCents, 0);
  const futureCents = Math.max(0, futureRaw - overpaidCents);
  const openCents = arrearsCents + futureCents;

  const oldest = due.find((s) => s.paidCents < s.amountCents) ?? null;
  const oldestUnpaidDue = oldest ? oldest.dueDate : null;
  const daysOverdue = oldest ? daysBetween(oldest.dueDate, today) : 0;
  const traffic = trafficFor(arrearsCents, daysOverdue);
  const next = future.find((s) => s.paidCents < s.amountCents) ?? null;
  const nextDue = next ? { no: next.no, dueDate: next.dueDate, amountCents: next.amountCents } : null;

  const steps = [
    `Fällig bis ${formatDe(today)}: ${formatEuro(dueCents)}`,
    `Gezahlt: ${formatEuro(paidCents)}`,
    `Rückstand: ${formatEuro(arrearsCents)}`,
    `Künftige Raten: ${formatEuro(futureCents)}`,
  ];
  if (overpaidCents > 0) steps.push(`Überzahlung: ${formatEuro(overpaidCents)}`);

  return { dueCents, paidCents, arrearsCents, futureCents, openCents, traffic, oldestUnpaidDue, daysOverdue, nextDue, steps };
}

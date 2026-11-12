import type { Installment, InstallmentState, IsoDate } from '../types';
import { memberStatus } from './status';

export type TakeoverPlan = {
  arrearsCents: number;
  futureCents: number;
  openCents: number;
  rates: Installment[];
  mode: 'first_rate' | 'spread';
};

export function planTakeover(states: InstallmentState[], today: IsoDate, mode: 'first_rate' | 'spread'): TakeoverPlan {
  const { arrearsCents, futureCents, openCents } = memberStatus(states, 0, today);
  const future = states
    .filter((s) => s.dueDate > today && s.amountCents - s.paidCents > 0)
    .map((s) => ({ dueDate: s.dueDate, amountCents: s.amountCents - s.paidCents }));

  let raw: { dueDate: IsoDate; amountCents: number }[];
  if (openCents === 0) raw = [];
  else if (future.length === 0) raw = [{ dueDate: today, amountCents: arrearsCents }];
  else if (mode === 'first_rate') raw = future.map((f, i) => (i === 0 ? { ...f, amountCents: f.amountCents + arrearsCents } : f));
  else {
    const each = Math.floor(openCents / future.length);
    const rest = openCents - each * future.length;
    raw = future.map((f, i) => ({ dueDate: f.dueDate, amountCents: each + (i === future.length - 1 ? rest : 0) }));
  }

  return { arrearsCents, futureCents, openCents, mode, rates: raw.map((r, i) => ({ no: i + 1, ...r })) };
}

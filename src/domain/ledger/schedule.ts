import type { ContractException, Installment, IsoDate, MemberContract } from '../types';

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Kalendertag in Monat (month0 darf überlaufen); Tag über Monatslänge → Monatsende. */
function makeDate(year: number, month0: number, day: number): IsoDate {
  const y = year + Math.floor(month0 / 12);
  const m = ((month0 % 12) + 12) % 12;
  const d = Math.min(day, daysInMonth(y, m));
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function buildSchedule(c: MemberContract, ex: ContractException[]): Installment[] {
  const [sy, sm] = c.startDate.split('-').map(Number);
  const pauses = ex.filter((e) => e.kind === 'pause');
  const shifts = ex.filter((e) => e.kind === 'due_day_shift');
  const deferrals = ex.filter((e) => e.kind === 'deferral');

  const out: Installment[] = [];
  for (let i = 0; i < c.installments; i++) {
    let month0 = sm - 1 + i;
    let day = c.dueDay;
    let date = makeDate(sy, month0, day);

    for (const p of pauses) {
      if (date >= p.from) {
        month0 += p.months;
        date = makeDate(sy, month0, day);
      }
    }
    for (const s of shifts) {
      if (date >= s.from) {
        day = s.newDueDay;
        date = makeDate(sy, month0, day);
      }
    }
    for (const d of deferrals) {
      if (date >= d.from && date <= d.to) date = d.to;
    }

    const amountCents =
      i === c.installments - 1 ? c.totalCents - c.installmentCents * (c.installments - 1) : c.installmentCents;
    out.push({ no: i + 1, dueDate: date, amountCents });
  }
  return out;
}

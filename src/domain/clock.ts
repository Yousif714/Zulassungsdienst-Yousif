import { TZDate } from '@date-fns/tz';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { de } from 'date-fns/locale';

import type { IsoDate } from './types';

export type { IsoDate };

const TZ = 'Europe/Berlin';
export const DEMO_NOW = new Date('2026-11-12T09:30:00+01:00');

let override: Date | null = null;

export function setNowForTests(d: Date | null): void {
  override = d;
}

/** Aktuelle Zeit: Test-Override, dann ?now= (nur Browser), sonst DEMO_NOW. */
export function now(): Date {
  if (override) return override;
  if (typeof window !== 'undefined') {
    const raw = new URLSearchParams(window.location.search).get('now');
    if (raw) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return DEMO_NOW;
}

export function formatBerlin(d: Date, pattern: string): string {
  return format(new TZDate(d, TZ), pattern);
}

/** Wie `formatBerlin`, aber mit deutschen Monats- und Wochentagsnamen (z. B. 'EEEE, d. MMMM'). */
export function formatBerlinDe(d: Date, pattern: string): string {
  return format(new TZDate(d, TZ), pattern, { locale: de });
}

export function todayBerlin(d: Date = now()): IsoDate {
  return formatBerlin(d, 'yyyy-MM-dd');
}

export function berlinParts(d: Date): { date: IsoDate; time: string; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 } {
  const z = new TZDate(d, TZ);
  return {
    date: format(z, 'yyyy-MM-dd'),
    time: format(z, 'HH:mm'),
    weekday: z.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  };
}

export function berlinLocalToUtc(date: IsoDate, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, 0, TZ).getTime());
}

function utcDay(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDaysIso(d: IsoDate, n: number): IsoDate {
  return addDays(utcDay(d), n).toISOString().slice(0, 10);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return differenceInCalendarDays(utcDay(b), utcDay(a));
}

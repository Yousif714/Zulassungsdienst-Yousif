import { afterEach, describe, expect, it } from 'vitest';
import {
  addDaysIso, berlinLocalToUtc, berlinParts, daysBetween, formatBerlin, now, setNowForTests, todayBerlin,
} from '@/domain/clock';

afterEach(() => setNowForTests(null));

describe('clock', () => {
  it('todayBerlin nutzt Europe/Berlin', () => {
    expect(todayBerlin(new Date('2026-11-11T23:30:00Z'))).toBe('2026-11-12');
  });
  it('berlinLocalToUtc beachtet Sommer-/Winterzeit', () => {
    expect(berlinLocalToUtc('2026-11-12', '07:00').toISOString()).toBe('2026-11-12T06:00:00.000Z');
    expect(berlinLocalToUtc('2026-07-01', '07:00').toISOString()).toBe('2026-07-01T05:00:00.000Z');
  });
  it('daysBetween und addDaysIso', () => {
    expect(daysBetween('2026-11-01', '2026-11-12')).toBe(11);
    expect(addDaysIso('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDaysIso('2026-03-28', 2)).toBe('2026-03-30');
  });
  it('berlinParts', () => {
    expect(berlinParts(new Date('2026-11-12T08:30:00Z'))).toEqual({ date: '2026-11-12', time: '09:30', weekday: 4 });
  });
  it('formatBerlin', () => {
    expect(formatBerlin(new Date('2026-11-12T08:30:00Z'), 'dd.MM.yyyy HH:mm')).toBe('12.11.2026 09:30');
  });
  it('now: Test-Override und DEMO_NOW', () => {
    setNowForTests(null);
    expect(now().toISOString()).toBe('2026-11-12T08:30:00.000Z');
    setNowForTests(new Date('2026-01-01T00:00:00Z'));
    expect(now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

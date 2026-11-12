import { describe, expect, test } from 'vitest';
import { chooseDelivery, dueRuns } from '@/domain/scheduler';
import { NOW_0930 as NOW } from './helpers';

const keys = (d: string, ex = new Set<string>()) => dueRuns(new Date(d), ex, { briefingsEnabled: true }).map((r) => r.key);

describe('dueRuns', () => {
  test('Briefing 7:00', () => expect(keys('2026-11-12T06:02:00Z')).toContain('briefing_morning:2026-11-12:07:00'));
  test('Sommerzeit', () => expect(keys('2026-03-29T05:01:00Z')).toContain('briefing_morning:2026-03-29:07:00'));
  test('Winterzeit', () => {
    expect(keys('2026-10-25T06:01:00Z')).toContain('briefing_morning:2026-10-25:07:00');
    expect(keys('2026-10-25T05:01:00Z')).not.toContain('briefing_morning:2026-10-25:07:00');
  });
  test('doppelter Takt → kein zweiter Lauf', () =>
    expect(keys('2026-11-12T06:07:00Z', new Set(['briefing_morning:2026-11-12:07:00']))).not.toContain('briefing_morning:2026-11-12:07:00'));
  test('Sync nur jüngster Slot', () =>
    expect(keys('2026-11-12T06:02:00Z').filter((k) => k.startsWith('sync:'))).toEqual(['sync:2026-11-12:07:00']));
  test('Briefings aus', () =>
    expect(dueRuns(new Date('2026-11-12T06:02:00Z'), new Set(), { briefingsEnabled: false }).map((r) => r.job)).not.toContain('briefing_morning'));
  test('Wochenrückblick sonntags', () => expect(keys('2026-11-15T18:03:00Z')).toContain('review_weekly:2026-11-15:19:00'));
  test('kein Wochenrückblick sonst', () => expect(keys('2026-11-12T18:03:00Z').join()).not.toContain('review_weekly'));
  test('Abend 2 Std. später noch fällig, danach nicht', () => {
    expect(keys('2026-11-12T21:30:00Z')).not.toContain('review_evening:2026-11-12:19:00');
    expect(keys('2026-11-12T19:30:00Z')).toContain('review_evening:2026-11-12:19:00');
  });
  test('Slot von gestern über Mitternacht', () => {
    // 23:00 Berlin = 22:00Z; Slot gestern 22:00 Ortszeit wäre sync; prüfe Sync gestern
    expect(keys('2026-11-11T23:10:00Z').filter((k) => k.startsWith('sync:'))).toEqual(['sync:2026-11-12:00:00']);
  });
});

describe('chooseDelivery', () => {
  test('Fenster offen', () => expect(chooseDelivery({ waConfigured: true, windowOpenUntil: '2026-11-12T10:00:00Z', templateApproved: true }, NOW)).toBe('whatsapp_freeform'));
  test('Fenster zu → Vorlage', () => expect(chooseDelivery({ waConfigured: true, windowOpenUntil: '2026-11-12T07:00:00Z', templateApproved: true }, NOW)).toBe('whatsapp_template'));
  test('keine Vorlage → Push', () => expect(chooseDelivery({ waConfigured: true, windowOpenUntil: null, templateApproved: false }, NOW)).toBe('push'));
  test('kein WhatsApp → Push', () => expect(chooseDelivery({ waConfigured: false, windowOpenUntil: '2026-11-12T10:00:00Z', templateApproved: true }, NOW)).toBe('push'));
});

import { addDaysIso, berlinLocalToUtc, berlinParts } from './clock';
import type { IsoDate, Settings } from './types';

export type JobName = 'sync' | 'briefing_morning' | 'review_evening' | 'review_weekly';

const WINDOW_MS = 2 * 3_600_000;

type Run = { key: string; job: JobName; scheduledFor: string };

function slotsOf(date: IsoDate): { job: JobName; time: string }[] {
  const out: { job: JobName; time: string }[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) out.push({ job: 'sync', time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` });
  out.push({ job: 'briefing_morning', time: '07:00' }, { job: 'review_evening', time: '19:00' });
  if (berlinParts(berlinLocalToUtc(date, '12:00')).weekday === 0) out.push({ job: 'review_weekly', time: '19:00' });
  return out;
}

/** Fällige Läufe (Berlin-Zeit): Slot ist fällig, wenn 0 ≤ jetzt − Slot < 2 Std. und der Schlüssel noch fehlt. */
export function dueRuns(nowUtc: Date, existingKeys: Set<string>, settings: Pick<Settings, 'briefingsEnabled'>): Run[] {
  const today = berlinParts(nowUtc).date;
  const runs: Run[] = [];
  let latestSync: (Run & { at: number }) | null = null;
  for (const date of [addDaysIso(today, -1), today]) {
    for (const { job, time } of slotsOf(date)) {
      if (job !== 'sync' && !settings.briefingsEnabled) continue;
      const at = berlinLocalToUtc(date, time);
      if (berlinParts(at).time !== time) continue; // Slot existiert wegen Zeitumstellung nicht
      const diff = nowUtc.getTime() - at.getTime();
      if (diff < 0 || diff >= WINDOW_MS) continue;
      const run = { key: `${job}:${date}:${time}`, job, scheduledFor: at.toISOString() };
      if (job === 'sync') {
        if (!latestSync || at.getTime() > latestSync.at) latestSync = { ...run, at: at.getTime() };
      } else runs.push(run);
    }
  }
  if (latestSync) runs.push({ key: latestSync.key, job: latestSync.job, scheduledFor: latestSync.scheduledFor });
  return runs.filter((r) => !existingKeys.has(r.key)).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
}

export function chooseDelivery(
  o: { waConfigured: boolean; windowOpenUntil: string | null; templateApproved: boolean },
  now: Date,
): 'whatsapp_freeform' | 'whatsapp_template' | 'push' {
  if (!o.waConfigured) return 'push';
  if (o.windowOpenUntil && Date.parse(o.windowOpenUntil) > now.getTime()) return 'whatsapp_freeform';
  return o.templateApproved ? 'whatsapp_template' : 'push';
}

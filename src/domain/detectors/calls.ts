import { addDaysIso, todayBerlin, berlinParts } from '../clock';
import type { AppState, Insight } from '../types';
import { callRef } from './refs';

export function detectCallSlides(s: AppState, now: Date): Insight[] {
  const today = todayBerlin(now);
  const tomorrow = addDaysIso(today, 1);
  const out: Insight[] = [];
  for (const c of s.calls) {
    if (c.slidesStatus !== 'todo') continue;
    const { date, time } = berlinParts(new Date(c.startsAt));
    if (date !== today && date !== tomorrow) continue;
    out.push({
      dedupeKey: `slides:${c.id}`,
      type: 'call_slides_missing',
      company: 'nexus',
      priority: date === today ? 'now' : 'today',
      title: `Folien für „${c.topic}“ fehlen noch`,
      body: `Call ${date === today ? 'heute' : 'morgen'} um ${time} Uhr, ${c.slideCount} Folien geplant, noch keine vorbereitet.`,
      refs: [callRef(c.id, c.topic)],
      nextStep: 'Folientexte vorbereiten',
      needsSources: ['calendar'],
    });
  }
  return out;
}

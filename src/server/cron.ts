import 'server-only';
import { buildBriefing, renderBriefingText } from '@/domain/briefing';
import type { ActionProvider } from '@/domain/actions/machine';
import { chooseDelivery, dueRuns, type JobName } from '@/domain/scheduler';
import type { Repos } from './db/repository';
import { dispatchEvents, loadState, syncState } from './state-service';

/**
 * Wie weit `runTick` beanspruchte Läufe zurückliest. `dueRuns` betrachtet nur Slots von gestern und heute (Berlin)
 * innerhalb von 2 Std.; ein Lauf wird frühestens zu seinem Slot beansprucht. 8 Tage decken das mit großem Abstand.
 */
export const JOB_RUN_LOOKBACK_MS = 8 * 24 * 3_600_000;

const BRIEFING: Partial<Record<JobName, 'morning' | 'evening' | 'weekly'>> = {
  briefing_morning: 'morning', review_evening: 'evening', review_weekly: 'weekly',
};

/** Ein Takt: fällige Läufe atomar beanspruchen (`job_runs`), nur der Gewinner führt aus. */
export async function runTick(deps: { repos: Repos; at: Date; provider: ActionProvider; sync?: () => Promise<unknown> }): Promise<{ ran: string[]; skipped: string[] }> {
  const { repos, at, provider, sync } = deps;
  const state = await loadState(repos, at);
  const ran: string[] = [];
  const skipped: string[] = [];
  let syncClaimed = false;
  const claimed = new Set(await repos.state.recentJobRuns(new Date(at.getTime() - JOB_RUN_LOOKBACK_MS)));
  for (const run of dueRuns(at, claimed, state.settings)) {
    if (!(await repos.state.claimJobRun(run.key, at))) {
      skipped.push(run.key);
      continue;
    }
    const kind = BRIEFING[run.job];
    if (kind) {
      const current = await loadState(repos, at);
      const text = renderBriefingText(buildBriefing(current, kind, at));
      // Phase 2a: WhatsApp ist nicht angebunden, die Zustellung bleibt „push“ ohne echten Versand.
      const delivery = chooseDelivery({ waConfigured: false, windowOpenUntil: null, templateApproved: false }, at);
      await dispatchEvents(repos, [{ type: 'assistantOutbound', text, delivery }], { at: () => at, provider });
    } else {
      await syncState(repos, { at });
      syncClaimed = true;
    }
    ran.push(run.key);
  }
  // Einmal je Takt, auch wenn mehrere Sync-Slots fällig waren. Ein Fehler bricht den Takt nicht ab.
  if (syncClaimed && sync) {
    try { await sync(); } catch (e) {
      // Details stehen je Verbindung im Zustand; ins Log nur der Fehlertyp, nie Meldung oder Geheimnisse.
      console.error('Sync nach dem Takt fehlgeschlagen:', e instanceof Error ? e.name : typeof e);
    }
  }
  return { ran, skipped };
}

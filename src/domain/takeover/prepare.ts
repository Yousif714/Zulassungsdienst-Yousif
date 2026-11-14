import { abandonFailed, cancelDraft, editDraft } from '../actions/machine';
import { takeoverAction } from '../action-factory';
import { todayBerlin } from '../clock';
import { memberView } from '../detectors/members';
import { isMembershipContract } from '../ledger/contracts';
import { planTakeover } from '../ledger/takeover';
import type { Action, AppState, MemberContract } from '../types';
import { currentTakeover, nextTakeoverAttempt, openTakeoverAction, takeoverBlockReason } from './status';

export type DraftSync =
  | { outcome: 'created' | 'updated'; state: AppState; action: Action }
  | { outcome: 'unchanged'; state: AppState; action: Action }
  /** Offene Aktion ist schon freigegeben, in Ausführung, unklar oder fehlgeschlagen: höchstens eine offene Umstellung. */
  | { outcome: 'running'; state: AppState; action: Action }
  | { outcome: 'blocked'; state: AppState; reason: string };

const sameRates = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Grund, mit dem der Ausführer eine Umstellung mit veraltetem Plan ablehnt. */
export const TAKEOVER_PLAN_STALE = 'Plan hat sich geändert – neu vorbereiten';

/**
 * Ergibt `planTakeover` aus dem aktuellen Stand noch genau den Plan der Aktion (offener Betrag und Raten)?
 * Sonst darf sie nicht ausgeführt werden: Ein Zeitplan aus altem Plan zöge z. B. eine inzwischen überwiesene Rate erneut ein.
 */
export function takeoverActionCurrent(s: AppState, a: Action, at: Date): boolean {
  const contractId = String(a.payload.contractId ?? '');
  if (!s.contracts.some((c) => c.id === contractId)) return false;
  const today = todayBerlin(at);
  const plan = planTakeover(memberView(s, contractId, today).states, today, a.payload.mode as MemberContract['catchUpMode']);
  return a.payload.openCents === plan.openCents && sameRates(a.payload.rates, plan.rates);
}

/**
 * Einzige Stelle, die den Umstellungs-Entwurf eines Vertrags pflegt: legt ihn an oder schreibt ihn als neue Version fort.
 * Raten entstehen immer aus dem aktuellen Stand (`planTakeover`), nie aus Client-Daten. Bei Sperrgrund bleibt der Zustand gleich.
 */
export function syncTakeoverDraft(s: AppState, contractId: string, mode: MemberContract['catchUpMode'], at: Date, isDemo: boolean): DraftSync {
  if (!s.contracts.some((c) => c.id === contractId)) return { outcome: 'blocked', state: s, reason: 'Vertrag nicht gefunden.' };
  const today = todayBerlin(at);
  let open = openTakeoverAction(s, contractId);
  // Fehlgeschlagen mit veraltetem Plan: aufgeben (auch bei Sperrgrund, sonst bleibt die Karte dauerhaft „Fehlgeschlagen“);
  // frischer Versuch aus dem aktuellen Stand („Erneut versuchen“ ginge nie mehr).
  if (open?.status === 'failed' && !takeoverActionCurrent(s, open, at)) {
    const gone = abandonFailed(open);
    s = { ...s, actions: s.actions.map((a) => (a.id === gone.id ? gone : a)) };
    open = undefined;
  }
  const reason = takeoverBlockReason(s, contractId, today);
  if (reason) return { outcome: 'blocked', state: s, reason };
  if (open && open.status !== 'draft') return { outcome: 'running', state: s, action: open };
  const v = memberView(s, contractId, today);
  if (!v.contact) return { outcome: 'blocked', state: s, reason: 'Kontakt fehlt.' };
  const plan = planTakeover(v.states, today, mode);
  const attempt = nextTakeoverAttempt(s, contractId);
  const fresh = takeoverAction({ contract: v.contract, contact: v.contact, mode, plan, attempt, prior: currentTakeover(s, contractId), at, isDemo });
  if (!open) return { outcome: 'created', state: { ...s, actions: [...s.actions, fresh] }, action: fresh };
  const p = open.payload;
  if (p.mode === mode && p.openCents === plan.openCents && sameRates(p.rates, plan.rates)) return { outcome: 'unchanged', state: s, action: open };
  const edited = editDraft(open, fresh.payload);
  return { outcome: 'updated', state: { ...s, actions: s.actions.map((a) => (a.id === open.id ? edited : a)) }, action: edited };
}

/** Bricht den offenen Umstellungs-Entwurf ab; undefined, wenn keiner offen ist. */
export function cancelTakeoverDraft(s: AppState, contractId: string): { state: AppState; action: Action } | undefined {
  const open = openTakeoverAction(s, contractId);
  if (!open || open.status !== 'draft') return undefined;
  const cancelled = cancelDraft(open);
  return { state: { ...s, actions: s.actions.map((a) => (a.id === open.id ? cancelled : a)) }, action: cancelled };
}

/** Verträge für „Alle umstellen“: Mitgliedschaften ohne Sperrgrund und ohne offene Umstellungs-Aktion. */
export function takeoverCandidates(s: AppState, at: Date): MemberContract[] {
  const today = todayBerlin(at);
  return s.contracts.filter((c) => isMembershipContract(c) && !openTakeoverAction(s, c.id) && takeoverBlockReason(s, c.id, today) === null);
}

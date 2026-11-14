import { contractSources, notConnected } from '../connections';
import { memberView } from '../detectors/members';
import { contractOnHold, isMembershipContract } from '../ledger/contracts';
import type { Action, ActionStatus, AppState, IsoDate, MemberContract, StripeTakeover, TakeoverStatus } from '../types';

export const TAKEOVER_STATUS_LABEL: Record<TakeoverStatus, string> = {
  prepared: 'vorbereitet',
  link_sent: 'Link verschickt',
  set_up: 'eingerichtet',
  active: 'aktiv',
  plan_changed: 'Plan geändert',
  withdrawn: 'zurückgezogen',
  aborted: 'abgebrochen',
};

const PREFIX = 'stripe-takeover-';
export const takeoverActionId = (contractId: string, attempt: number): string => `${PREFIX}${contractId}-${attempt}`;

/** Versuchsnummer aus der Aktions-ID dieses Vertrags (`stripe-takeover-<id>-<n>`), sonst null. */
function attemptOf(a: Action, contractId: string): number | null {
  const head = `${PREFIX}${contractId}-`;
  if (!a.id.startsWith(head)) return null;
  const rest = a.id.slice(head.length);
  return /^\d+$/.test(rest) ? Number(rest) : null;
}

/** Nächste freie Versuchsnummer: Zahl der bisherigen Umstellungs-Aktionen + 1 (Lücken: höchste + 1). */
export function nextTakeoverAttempt(s: AppState, contractId: string): number {
  const nums = s.actions.map((a) => attemptOf(a, contractId)).filter((n): n is number => n !== null);
  return Math.max(nums.length, ...nums) + 1;
}

/** Nicht abgeschlossene Aktionen gelten als offen: Solange eine existiert, entsteht kein zweiter Versuch. */
const OPEN: ActionStatus[] = ['draft', 'approved', 'executing', 'uncertain', 'failed'];

export function openTakeoverAction(s: AppState, contractId: string): Action | undefined {
  return s.actions.find((a) => a.type === 'stripe_takeover' && attemptOf(a, contractId) !== null && OPEN.includes(a.status));
}

/** Jüngste Umstellung des Vertrags (nach `linkSentAt`). */
export function currentTakeover(s: AppState, contractId: string): StripeTakeover | undefined {
  let best: StripeTakeover | undefined;
  for (const t of s.takeovers) {
    if (t.contractId === contractId && (!best || t.linkSentAt >= best.linkSentAt)) best = t;
  }
  return best;
}

export function takeoverStatus(s: AppState, contractId: string): TakeoverStatus | null {
  if (openTakeoverAction(s, contractId)) return 'prepared';
  return currentTakeover(s, contractId)?.status ?? null;
}

/** Raten laufen über Stripe, sobald der Zeitplan angelegt ist. */
export function runsViaStripe(s: AppState, contractId: string): boolean {
  const st = currentTakeover(s, contractId)?.status;
  return st === 'set_up' || st === 'active';
}

/** Stand unbekannt, weil die Quelle fehlt. Läuft die Rate über Stripe, spielt die Bank keine Rolle mehr. */
export function standUnknown(s: AppState, contract: MemberContract): boolean {
  return notConnected(contractSources(contract), s.connections) && !runsViaStripe(s, contract.id);
}

/** Keine Zahlungserinnerung, solange die Raten über Stripe laufen (sonst droht Doppelzahlung); null = Erinnerung erlaubt. */
export function reminderBlockedReason(s: AppState, contractId: string): string | null {
  return runsViaStripe(s, contractId) ? 'Raten laufen über Stripe – keine Erinnerung nötig.' : null;
}

/** Grund, warum „Auf Stripe umstellen“ gesperrt ist; null = erlaubt. Ein offener Entwurf sperrt nicht. */
export function takeoverBlockReason(s: AppState, contractId: string, today: IsoDate): string | null {
  const v = memberView(s, contractId, today);
  if (v.contract.billing === 'stripe') return 'Zahlt bereits über Stripe.';
  if (!isMembershipContract(v.contract)) return 'Nur Mitgliedschaften.';
  if (contractOnHold(s, v.contract)) return 'Quellrechnung storniert.';
  if (v.contract.readBy && !v.contract.readBy.confirmed) return 'Ratenplan erst bestätigen.';
  if (standUnknown(s, v.contract)) return 'Bank nicht verbunden: Der Restbetrag wird erst nach der Bankanbindung berechnet.';
  if (v.status.openCents <= 0) return 'Nichts mehr offen.';
  const st = currentTakeover(s, contractId)?.status;
  if (st === 'link_sent' || st === 'set_up' || st === 'active') return 'Umstellung läuft bereits.';
  return null;
}

/** Aktionsstatus, in denen eine Umstellung schon an Stripe unterwegs sein kann (Entwurf und Fehler zählen nicht). */
const IN_FLIGHT: ActionStatus[] = ['approved', 'executing', 'uncertain'];

/**
 * Grund, warum der Vertrag gerade nicht korrigiert oder gelöscht werden darf; null = erlaubt.
 * Läuft ein Zeitplan, würden Ledger und Stripe sonst auseinanderlaufen (Rest verloren, Zahlungen ohne Vertrag).
 */
export function contractLockedReason(s: AppState, contractId: string): string | null {
  if (runsViaStripe(s, contractId)) return 'Vertrag läuft über Stripe – erst Zeitplan in Stripe beenden.';
  const open = openTakeoverAction(s, contractId);
  if (currentTakeover(s, contractId)?.status === 'link_sent' || (open && IN_FLIGHT.includes(open.status))) return 'Umstellung auf Stripe läuft – erst zurückziehen.';
  return null;
}

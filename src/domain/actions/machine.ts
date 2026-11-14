import type { Action, ActionStatus } from '../types';

const BUTTON_TTL_MS = 24 * 3_600_000;
/** Eine Ausführung, die so lange läuft, gilt als abgebrochen: Ausgang unklar. */
export const STALE_EXECUTING_MS = 5 * 60_000;
/** So lange wartet der Ausführer auf den Anbieter. */
export const EXECUTE_TIMEOUT_MS = 10_000;

function settled(a: Action): Action {
  const { executingSince: _since, ...rest } = a;
  return rest;
}

function fail(from: ActionStatus, to: ActionStatus): never {
  throw new Error(`Ungültiger Übergang: ${from} → ${to}`);
}

export function idempotencyKey(a: Action): string {
  return `${a.id}:${a.version}`;
}

export function editDraft(a: Action, payload: Record<string, unknown>): Action {
  if (a.status !== 'draft') fail(a.status, 'draft');
  return { ...a, payload, version: a.version + 1 };
}

/** Ablehnungsgründe von `approve` auf Deutsch (für App und WhatsApp-Antworten). */
export const REJECT_REASON_DE = {
  stale_version: 'Der Entwurf wurde inzwischen geändert.',
  not_draft: 'Die Aktion ist kein Entwurf mehr.',
  already_approved: 'Die Aktion wurde bereits freigegeben.',
  expired: 'Der Knopf ist abgelaufen.',
} as const;

export function approve(
  a: Action,
  req: { version: number; via: 'app' | 'whatsapp'; buttonIssuedAt?: string },
  now: Date,
): { ok: true; action: Action } | { ok: false; reason: 'stale_version' | 'not_draft' | 'already_approved' | 'expired' } {
  if (a.status === 'approved' || a.status === 'executing' || a.status === 'executed') return { ok: false, reason: 'already_approved' };
  if (a.status !== 'draft') return { ok: false, reason: 'not_draft' };
  if (req.via === 'whatsapp') {
    const issued = req.buttonIssuedAt ? Date.parse(req.buttonIssuedAt) : NaN;
    const age = now.getTime() - issued;
    if (!Number.isFinite(age) || age < 0 || age > BUTTON_TTL_MS) return { ok: false, reason: 'expired' };
  }
  if (req.version !== a.version) return { ok: false, reason: 'stale_version' };
  return { ok: true, action: { ...a, status: 'approved', approvedVia: req.via, approvedAt: now.toISOString() } };
}

export function cancelDraft(a: Action): Action {
  if (a.status !== 'draft') fail(a.status, 'cancelled');
  return { ...a, status: 'cancelled' };
}

export function startExecution(a: Action): Action {
  if (a.status !== 'approved') fail(a.status, 'executing');
  return { ...a, status: 'executing' };
}

export function finishExecution(a: Action, result: 'ok' | 'error' | 'timeout', now: Date, error?: string): Action {
  if (a.status !== 'executing') fail(a.status, result === 'ok' ? 'executed' : result === 'error' ? 'failed' : 'uncertain');
  const base = settled(a);
  if (result === 'ok') return { ...base, status: 'executed', executedAt: now.toISOString() };
  if (result === 'timeout') return { ...base, status: 'uncertain' };
  return { ...base, status: 'failed', error };
}

export function reconcileUncertain(a: Action, foundAtProvider: boolean, now: Date): Action {
  if (a.status !== 'uncertain') fail(a.status, foundAtProvider ? 'executed' : 'failed');
  return foundAtProvider
    ? { ...a, status: 'executed', executedAt: now.toISOString() }
    : { ...a, status: 'failed', error: 'Beim Anbieter nicht gefunden' };
}

export function retry(a: Action): Action {
  if (a.status !== 'failed') fail(a.status, 'approved');
  const { error: _error, ...rest } = a;
  return { ...rest, status: 'approved' };
}

/** Ergebnisdaten, die ein Anbieter nach der Ausführung zurückmeldet (z. B. Stripe-IDs). */
export type ActionOutput = Record<string, string>;
export type ExecuteOutcome = 'ok' | 'error' | 'timeout' | { result: 'ok'; output: ActionOutput };

/** Ob der Ausführer diese Aktion nur simuliert. */
export const isSimulated = (p: ActionProvider, a: Action): boolean => p.simulatedFor?.(a) ?? p.simulated;

export interface ActionProvider {
  /** true: führt nichts wirklich aus (Demo-Ausführer). */
  readonly simulated: boolean;
  /** Je Aktion abweichend von `simulated` (z. B. Server-Ausführer: Nachrichten Demo, Stripe-Umstellung echt). */
  simulatedFor?(a: Action): boolean;
  execute(a: Action, key: string): Promise<ExecuteOutcome>;
  lookup(key: string, a?: Action): Promise<boolean | { output: ActionOutput }>;
}

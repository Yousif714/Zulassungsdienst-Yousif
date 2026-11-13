import 'server-only';
import { applyEvent, applyEvents, refresh, type EngineContext } from '@/data/engine';
import { checkAction, executeApproved, sweepStaleExecutions, type EventSink } from '@/data/executor';
import type { ActionProvider } from '@/domain/actions/machine';
import { isPortalEmail } from '@/domain/import/portal-list';
import type { StoreEvent } from '@/domain/events';
import { newId } from '@/domain/ids';
import type { ActionType, AppState, Call, Company, Job, Settings } from '@/domain/types';
import type { Repos, StateRepository } from './db/repository';
import { diffState, type ChangeSet } from './db/tables';

const MAX_ATTEMPTS = 3;

/** Ereignisse, die ein Client senden darf. Ausführer-, Demo-, Verbindungs- und Assistenten-Ereignisse entstehen nur auf dem Server. */
export const CLIENT_EVENTS: ReadonlySet<StoreEvent['type']> = new Set<StoreEvent['type']>([
  'confirmPaymentMatch', 'dismissPayment', 'settleInvoice', 'linkInvoiceToJob', 'setJobStatus', 'createAction', 'editAction', 'approveAction',
  'retryAction', 'checkAction', 'dismissInsight', 'snoozeInsight', 'suppressCoach', 'setSlides', 'updateSettings',
  'confirmProposal', 'dismissProposal', 'confirmReadContract', 'correctContract', 'deleteReadContract', 'importPortalList', 'importBankStatement', 'createPortalContract', 'ignorePortalMember', 'unignorePortalMember',
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isVersion = (v: unknown) => Number.isInteger(v) && (v as number) >= 1;
/** Prüft gegen alle Werte eines String-Unions; `Record<T, true>` erzwingt zur Compile-Zeit Vollständigkeit. */
const oneOf = <T extends string>(all: Record<T, true>) => (v: unknown): v is T => typeof v === 'string' && Object.hasOwn(all, v);

const isActionType = oneOf<ActionType>({ send_whatsapp: true, send_email: true, send_reminder: true, create_invoice_draft: true, create_calendar_event: true, mark_invoice_settled: true, link_invoice_to_job: true, confirm_payment_match: true });
const isCompany = oneOf<Company>({ nexus: true, zulassung: true });
const isJobStatus = oneOf<Job['status']>({ open: true, waiting_customer: true, done: true, invoiced: true, paid: true });
const isSlidesStatus = oneOf<Call['slidesStatus']>({ todo: true, draft: true, reviewed: true, copied: true });

/** Erlaubte Einstellungen mit Typprüfung je Schlüssel. Ein falscher Typ würde gespeichert und jede spätere Auswertung sprengen. */
const SETTINGS: { [K in keyof Settings]: (v: unknown) => boolean } = {
  replyThresholdHours: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 72, // wie im Einstellungs-Formular
  briefingsEnabled: (v) => typeof v === 'boolean',
  ownerPhone: (v) => typeof v === 'string', // Nummernformat prüft die Engine (validPhone)
  suppressedCoachKeys: (v) => Array.isArray(v) && v.every((k) => typeof k === 'string'),
};
const isSettingsPatch = (p: unknown) => isObj(p) && Object.entries(p).every(([k, v]) => Object.hasOwn(SETTINGS, k) && SETTINGS[k as keyof Settings](v));

/** Status- und Ausführungsfelder setzt nur der Server; ein Client-Entwurf darf sie nicht mitbringen. */
const SERVER_ONLY_ACTION_FIELDS = ['approvedVia', 'approvedAt', 'executedAt', 'executingSince', 'error'] as const;
const isDraft = (a: unknown) =>
  isObj(a) && isStr(a.id) && isActionType(a.type) && (a.company === null || isCompany(a.company)) && isStr(a.title)
  && isObj(a.payload) && isVersion(a.version) && a.status === 'draft' && isStr(a.createdAt)
  && a.isDemo === false // Echtmodus: ein Demo-Entwurf wird abgelehnt, nicht umgeschrieben
  && (a.insightKey === undefined || isStr(a.insightKey))
  && SERVER_ONLY_ACTION_FIELDS.every((k) => a[k] === undefined);

const isIsoDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isCatchUp = oneOf<'first_rate' | 'spread'>({ first_rate: true, spread: true });
/** Grundform des Vertragsentwurfs; Wertebereiche und Rechenregeln prüft die Engine (validateContractDraft). */
const isContractDraft = (d: unknown) =>
  isObj(d) && Number.isInteger(d.totalCents) && Number.isInteger(d.installments) && Number.isInteger(d.installmentCents)
  && Number.isInteger(d.dueDay) && isIsoDate(d.startDate) && isCatchUp(d.catchUpMode);

const isSlides = (v: unknown) => Array.isArray(v) && v.every((x) => isObj(x) && Number.isInteger(x.position) && typeof x.title === 'string' && typeof x.body === 'string');

const isPortalMail = (v: unknown) => typeof v === 'string' && v.length <= 254 && isPortalEmail(v);
const optStr = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max);
const optDate = (v: unknown) => v === undefined || v === null || isIsoDate(v);
/** Strenge Form eines Listeneintrags: Typen und Größen aller Felder, `emails[0]` ist die Hauptadresse. */
const isPortalEntry = (x: unknown) =>
  isObj(x) && isPortalMail(x.email) && typeof x.name === 'string' && x.name.length <= 200
  && (x.emails === undefined || (Array.isArray(x.emails) && x.emails.length >= 1 && x.emails.length <= 10 && x.emails.every(isPortalMail) && String(x.emails[0]).toLowerCase() === String(x.email).toLowerCase()))
  && optDate(x.joinedOn) && optDate(x.lastActiveOn) && optStr(x.joinedText, 100) && optStr(x.lastActiveText, 100);

/** Strenge Form einer Sparkasse-Zahlung aus dem Client: feste Werte, Schlüssel- und Betragsgrenzen. */
const isSparkassePayment = (x: unknown) =>
  isObj(x) && x.company === 'zulassung' && x.source === 'bank' && x.connectionId === 'bank_sparkasse' && x.kind === 'incoming'
  && typeof x.externalId === 'string' && /^spk-[0-9a-f]{16}$/.test(x.externalId)
  && Number.isInteger(x.amountCents) && x.amountCents !== 0 && Math.abs(x.amountCents as number) <= 100_000_000_00
  && isIsoDate(x.bookedOn)
  && optStr(x.payerName, 200) && optStr(x.iban, 34) && optStr(x.reference, 500);

/** Sammelzahlung: 1–50 eindeutige Rechnungs-IDs. */
const isInvoiceIds = (v: unknown) => Array.isArray(v) && v.length >= 1 && v.length <= 50 && v.every(isStr) && new Set(v).size === v.length;

/** Pflichtfelder je erlaubtem Ereignis (Grundform; die Fachregeln prüft die Engine). */
const SHAPE: Record<string, (e: Record<string, unknown>) => boolean> = {
  confirmPaymentMatch: (e) => isStr(e.paymentId) && [isStr(e.contractId), isStr(e.invoiceId), e.invoiceIds !== undefined].filter(Boolean).length === 1
    && (e.invoiceIds === undefined || isInvoiceIds(e.invoiceIds)),
  dismissPayment: (e) => isStr(e.paymentId),
  settleInvoice: (e) => isStr(e.invoiceId) && isStr(e.paymentId),
  linkInvoiceToJob: (e) => isStr(e.jobId) && isStr(e.invoiceId),
  setJobStatus: (e) => isStr(e.jobId) && isJobStatus(e.status),
  // Nur Entwürfe: eine Aktion darf nie ohne Freigabe als „approved“ hereinkommen.
  createAction: (e) => isDraft(e.action),
  editAction: (e) => isStr(e.id) && isObj(e.payload),
  // Nur die App: WhatsApp-Freigaben kommen über den Webhook, sonst ließen sich Kanal und Knopf-Zeit fälschen.
  approveAction: (e) => isStr(e.id) && isVersion(e.version) && e.via === 'app' && e.buttonIssuedAt === undefined,
  retryAction: (e) => isStr(e.id),
  checkAction: (e) => isStr(e.id),
  dismissInsight: (e) => isStr(e.key),
  snoozeInsight: (e) => isStr(e.key),
  suppressCoach: (e) => isStr(e.key),
  setSlides: (e) => isStr(e.callId) && isSlides(e.slides) && isSlidesStatus(e.status),
  updateSettings: (e) => isSettingsPatch(e.patch),
  confirmProposal: (e) => isStr(e.proposalId) && isContractDraft(e.draft) && (e.contactId === null || isStr(e.contactId)),
  dismissProposal: (e) => isStr(e.proposalId),
  confirmReadContract: (e) => isStr(e.contractId),
  correctContract: (e) => isStr(e.contractId) && isContractDraft(e.draft),
  deleteReadContract: (e) => isStr(e.contractId),
  createPortalContract: (e) => isStr(e.externalId) && isContractDraft(e.draft) && (e.contactId === null || isStr(e.contactId)),
  ignorePortalMember: (e) => isStr(e.externalId),
  unignorePortalMember: (e) => isStr(e.externalId),
  importBankStatement: (e) => e.connectionId === 'bank_sparkasse' && Array.isArray(e.payments) && e.payments.length >= 1 && e.payments.length <= 5000 && e.payments.every(isSparkassePayment),
  importPortalList: (e) => Array.isArray(e.entries) && e.entries.length >= 1 && e.entries.length <= 2000 && e.entries.every(isPortalEntry),
};

export function isClientEvent(e: unknown): e is StoreEvent {
  if (!isObj(e) || typeof e.type !== 'string') return false;
  if (!CLIENT_EVENTS.has(e.type as StoreEvent['type'])) return false;
  return SHAPE[e.type]?.(e) ?? false;
}

export async function loadState(repos: Repos, at: Date): Promise<AppState> {
  return refresh((await repos.state.load()).state, at, false);
}

const isEmpty = (c: ChangeSet) => Object.values(c).every((t) => !t.upsert.length && !t.delete.length);

/**
 * Laden → `step` anwenden → mit Revisionsprüfung speichern. Bei Konflikt neu laden und `step` auf dem frischen Stand
 * erneut anwenden, höchstens 3 Versuche, dann `Error('conflict')`. `skip`: nichts speichern (z. B. Start verloren).
 */
async function commit<T>(repo: StateRepository, step: (s: AppState) => { state: AppState; value: T; skip?: boolean }): Promise<{ state: AppState; value: T }> {
  for (let attempt = 1; ; attempt++) {
    const { state: prev, revision } = await repo.load();
    const { state, value, skip } = step(prev);
    if (skip) return { state: prev, value };
    const changes = diffState(prev, state);
    if (isEmpty(changes)) return { state, value };
    const r = await repo.save(changes, revision);
    if (r.ok) return { state, value };
    if (attempt >= MAX_ATTEMPTS) throw new Error('conflict');
  }
}

/** Sink des Ausführers: jedes Ereignis wird einzeln auf dieselbe Weise gespeichert. */
function serverSink(repo: StateRepository, initial: AppState, ctx: () => EngineContext): EventSink {
  let current = initial;
  return {
    current: () => current,
    async apply(e) {
      current = (await commit(repo, (s) => ({ state: applyEvent(s, e, ctx()).state, value: undefined }))).state;
      return current;
    },
    // Ausführen darf nur, wessen eigenes gespeichertes `actionStarted` die Aktion von „approved“ auf „executing“ gestellt hat.
    async claimStart(id) {
      const r = await commit(repo, (s) => {
        if (s.actions.find((a) => a.id === id)?.status !== 'approved') return { state: s, value: false, skip: true };
        const next = applyEvent(s, { type: 'actionStarted', id }, ctx()).state;
        return { state: next, value: next.actions.find((a) => a.id === id)?.status === 'executing' };
      });
      current = r.state;
      return r.value;
    },
  };
}

export async function dispatchEvents(
  repos: Repos,
  events: StoreEvent[],
  deps: { at: () => Date; provider: ActionProvider },
): Promise<{ state: AppState; created: string[] }> {
  const ctx = (): EngineContext => ({ at: deps.at(), isDemo: false, newId });
  const r = await commit(repos.state, (s) => {
    // Auf dem abgeglichenen Stand anwenden, den auch GET /api/state zeigt: sonst verpufft z. B. das Erledigen eines
    // Hinweises, der erst durch refresh entsteht und noch nicht gespeichert ist.
    const c = ctx();
    const res = applyEvents(refresh(s, c.at, false), events, c);
    return { state: res.state, value: res.created };
  });
  const sink = serverSink(repos.state, r.state, ctx);
  await executeApproved(sink, deps.provider);
  for (const e of events) if (e.type === 'checkAction') await checkAction(sink, deps.provider, e.id);
  return { state: sink.current(), created: r.value };
}

/** Cron-Sync: Ableitungen (Zuordnung, Hinweise) speichern und hängende Ausführungen zu „Ausgang unklar“ machen. */
export async function syncState(repos: Repos, deps: { at: Date }): Promise<AppState> {
  const ctx = (): EngineContext => ({ at: deps.at, isDemo: false, newId });
  const r = await commit(repos.state, (s) => ({ state: refresh(s, deps.at, false), value: undefined }));
  const sink = serverSink(repos.state, r.state, ctx);
  await sweepStaleExecutions(sink, deps.at);
  return sink.current();
}

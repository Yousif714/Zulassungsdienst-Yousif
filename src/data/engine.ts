import { REJECT_REASON_DE, approve, editDraft, finishExecution, startExecution } from '@/domain/actions/machine';
import { handleButton } from '@/domain/assistant';
import { jobBilling } from '@/domain/billing';
import { berlinParts, todayBerlin } from '@/domain/clock';
import { runCoach } from '@/domain/coach';
import { detectCommitment } from '@/domain/commitments';
import { reconcileInsights, runDetectors } from '@/domain/detectors';
import { expectedAmounts } from '@/domain/detectors/payments';
import type { StoreEvent } from '@/domain/events';
import { areaStale } from '@/domain/freshness';
import { normalizePhone, validPhone } from '@/domain/matching/messages';
import { classifyBankTx, matchBankPayment } from '@/domain/matching/payments';
import { formatEuro } from '@/domain/money';
import type { Action, AppState, AssistantMessage, AuditEntry, Connection, Message, Settings } from '@/domain/types';
import { OWNER_EMAIL, OWNER_WHATSAPP, createDemoState } from './seed';

export interface EngineContext { at: Date; isDemo: boolean; newId: () => string }
export interface EngineResult { state: AppState; created: string[] }

// ---------- refresh ----------

function autoAllocate(s: AppState, at: Date, isDemo: boolean): AppState {
  let st = s;
  for (const p of s.payments) {
    if (p.source !== 'bank' || p.kind !== 'incoming' || p.company !== 'nexus') continue;
    if (st.allocations.some((a) => a.paymentId === p.id)) continue;
    const m = matchBankPayment(p, { contacts: st.contacts, ibanLinks: st.ibanLinks, expected: expectedAmounts(st, at) });
    if (m.confidence !== 'high' || !m.contactId) continue;
    const contract = st.contracts.find((c) => c.contactId === m.contactId);
    if (!contract) continue;
    const name = st.contacts.find((c) => c.id === m.contactId)?.name ?? m.contactId;
    st = {
      ...st,
      allocations: [...st.allocations, { paymentId: p.id, contractId: contract.id, amountCents: p.amountCents, method: 'auto' }],
      audit: [...st.audit, { at: at.toISOString(), actor: 'system', text: `Automatisch zugeordnet: ${name}`, isDemo }],
    };
  }
  return st;
}

function settleCommitments(s: AppState, at: Date): AppState {
  let changed = false;
  const commitments = s.commitments.map((c) => {
    if (c.status === 'kept') return c;
    const msg = s.messages.find((m) => m.id === c.messageId);
    const since = msg ? berlinParts(new Date(msg.sentAt)).date : '0000-00-00';
    const kept = c.kind === 'invoice' && s.invoices.some((i) => i.contactId === c.contactId && i.issuedOn >= since);
    if (kept) {
      changed = true;
      return { ...c, status: 'kept' as const };
    }
    if (c.status === 'open' && Date.parse(c.dueAt) < at.getTime()) {
      changed = true;
      return { ...c, status: 'broken' as const };
    }
    return c;
  });
  return changed ? { ...s, commitments } : s;
}

/** Auto-Zuordnung (`high`), Zusagen prüfen, Hinweise neu abgleichen. */
export function refresh(s: AppState, at: Date, isDemo = true): AppState {
  const st = settleCommitments(autoAllocate(s, at, isDemo), at);
  const stale = areaStale(st.connections.map((c) => c.id), st.connections, at);
  return { ...st, insights: reconcileInsights(st.insights, [...runDetectors(st, at), ...runCoach(st, at)], at, stale, st.settings.suppressedCoachKeys) };
}

// ---------- Mutationen ----------

type Mutation = { state: AppState; text: string };

const contactName = (s: AppState, id: string | null | undefined) => s.contacts.find((c) => c.id === id)?.name ?? 'Unbekannt';

function confirmPaymentMatch(s: AppState, paymentId: string, contractId: string, at: Date): Mutation {
  const p = s.payments.find((x) => x.id === paymentId);
  const c = s.contracts.find((x) => x.id === contractId);
  if (!p || !c) return { state: s, text: `Zuordnung nicht möglich: ${paymentId}` };
  const ibanLinks = p.iban && !s.ibanLinks.some((l) => l.iban === p.iban)
    ? [...s.ibanLinks, { iban: p.iban, contactId: c.contactId, confirmedAt: at.toISOString() }]
    : s.ibanLinks;
  return {
    state: {
      ...s,
      allocations: [...s.allocations.filter((a) => a.paymentId !== paymentId), { paymentId, contractId, amountCents: p.amountCents, method: 'confirmed' }],
      ibanLinks,
    },
    text: `Zahlung über ${formatEuro(p.amountCents)} ${contactName(s, c.contactId)} zugeordnet`,
  };
}

function settleInvoice(s: AppState, invoiceId: string, paymentId: string): Mutation {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  return {
    state: { ...s, invoices: s.invoices.map((i) => (i.id === invoiceId ? { ...i, status: 'paid', openCents: 0, settledByPaymentId: paymentId } : i)) },
    text: `Rechnung ${inv?.number ?? invoiceId} als durch Stripe bezahlt markiert`,
  };
}

function linkInvoiceToJob(s: AppState, jobId: string, invoiceId: string): Mutation {
  const inv = s.invoices.find((i) => i.id === invoiceId);
  const jobs = s.jobs.map((j) => {
    if (j.id !== jobId || j.invoiceIds.includes(invoiceId)) return j;
    const linked = { ...j, invoiceIds: [...j.invoiceIds, invoiceId] };
    return { ...linked, status: j.status === 'done' && jobBilling(s, linked).restCents <= 0 ? ('invoiced' as const) : j.status };
  });
  const job = s.jobs.find((j) => j.id === jobId);
  return { state: { ...s, jobs }, text: `Rechnung ${inv?.number ?? invoiceId} dem Auftrag ${contactName(s, job?.contactId)} · ${job?.service ?? jobId} zugeordnet` };
}

function sendMessage(s: AppState, a: Action, ctx: EngineContext): Mutation {
  const at = ctx.at;
  const p = a.payload as { contactId?: string; threadId?: string; channel?: string; text?: string; jobId?: string };
  const channel: Message['channel'] = p.channel === 'email' || (!p.channel && a.type === 'send_email') ? 'email' : 'whatsapp';
  const contact = s.contacts.find((c) => c.id === p.contactId);
  const msg: Message = {
    id: ctx.newId(),
    channel,
    connectionId: channel === 'email' ? 'info_mail' : 'whatsapp_kunden',
    externalId: `demo-${a.id}-${a.version}`,
    threadId: p.threadId ?? `t-${p.contactId}`,
    direction: 'out',
    from: channel === 'email' ? OWNER_EMAIL : OWNER_WHATSAPP,
    to: (channel === 'email' ? contact?.emails[0] : contact?.phones[0]) ?? '',
    body: p.text ?? '',
    sentAt: at.toISOString(),
    contactId: p.contactId ?? null,
    jobId: p.jobId ?? null,
    needsReply: false,
  };
  // Zusage des Inhabers in der Nachricht („Die Rechnung schicke ich morgen“) wird zur offenen Zusage.
  const promise = msg.contactId ? detectCommitment(msg.body, msg.sentAt) : null;
  const commitments = promise && msg.contactId
    ? [...s.commitments, { id: ctx.newId(), messageId: msg.id, contactId: msg.contactId, kind: promise.kind, text: msg.body, dueAt: promise.dueAt, status: 'open' as const }]
    : s.commitments;
  return {
    state: { ...s, messages: [...s.messages, msg], commitments },
    text: `Gesendet (Demo): ${channel === 'email' ? 'E-Mail' : 'WhatsApp'} an ${contact?.name ?? 'Unbekannt'}`,
  };
}

function applyEffects(s: AppState, a: Action, ctx: EngineContext): Mutation {
  const p = a.payload as Record<string, string>;
  switch (a.type) {
    case 'send_whatsapp':
    case 'send_email':
    case 'send_reminder':
      return sendMessage(s, a, ctx);
    case 'link_invoice_to_job':
      return linkInvoiceToJob(s, p.jobId, p.invoiceId);
    case 'mark_invoice_settled':
      return settleInvoice(s, p.invoiceId, p.paymentId);
    case 'confirm_payment_match':
      return confirmPaymentMatch(s, p.paymentId, p.contractId, ctx.at);
    default:
      return { state: s, text: `Ausgeführt (Demo): ${a.title}` };
  }
}

/** Ein abgehakter Antwort-Hinweis gilt als manuell beantwortet: die Nachricht wartet dann nicht mehr. */
function dismissInsight(s: AppState, key: string, at: Date): AppState {
  const st = setStatus(s, key, 'dismissed', at);
  if (!key.startsWith('reply:')) return st;
  const messageId = key.slice('reply:'.length);
  return { ...st, messages: st.messages.map((m) => (m.id === messageId ? { ...m, doneManually: true } : m)) };
}

const setStatus = (s: AppState, key: string, status: 'dismissed' | 'snoozed', at: Date): AppState => ({
  ...s,
  insights: s.insights.map((i) => (i.dedupeKey === key ? { ...i, status, resolvedAt: at.toISOString() } : i)),
});

function replaceAction(s: AppState, a: Action): AppState {
  return { ...s, actions: s.actions.map((x) => (x.id === a.id ? a : x)) };
}

function mutate(s: AppState, e: StoreEvent, ctx: EngineContext): { state: AppState; audit?: Omit<AuditEntry, 'at' | 'isDemo'> } {
  const at = ctx.at;
  const owner = (m: Mutation, actionId?: string) => ({ state: m.state, audit: { actor: 'owner' as const, text: m.text, actionId } });
  switch (e.type) {
    case 'confirmPaymentMatch':
      return owner(confirmPaymentMatch(s, e.paymentId, e.contractId, at));
    case 'simulateTransfer': {
      const id = ctx.newId();
      const payment = {
        id, company: 'nexus' as const, source: 'bank' as const, connectionId: 'bank' as const, externalId: `demo-${id}`, amountCents: e.amountCents,
        bookedOn: todayBerlin(at), payerName: e.payerName, iban: e.iban, reference: 'Überweisung (Demo)', kind: classifyBankTx({ payerName: e.payerName }),
      };
      return owner({ state: { ...s, payments: [...s.payments, payment] }, text: `Überweisung simuliert: ${e.payerName}, ${formatEuro(e.amountCents)}` });
    }
    case 'settleInvoice':
      return owner(settleInvoice(s, e.invoiceId, e.paymentId));
    case 'linkInvoiceToJob':
      return owner(linkInvoiceToJob(s, e.jobId, e.invoiceId));
    case 'setJobStatus': {
      const jobs = s.jobs.map((j) => {
        if (j.id !== e.jobId) return j;
        const doneAt = e.status === 'open' || e.status === 'waiting_customer' ? null : (j.doneAt ?? at.toISOString());
        return { ...j, status: e.status, doneAt };
      });
      const job = s.jobs.find((j) => j.id === e.jobId);
      return owner({ state: { ...s, jobs }, text: `Auftragsstatus geändert: ${contactName(s, job?.contactId)} · ${job?.service ?? e.jobId} → ${e.status}` });
    }
    case 'createAction':
      if (s.actions.some((a) => a.id === e.action.id)) return { state: s };
      return owner({ state: { ...s, actions: [...s.actions, e.action] }, text: `Entwurf angelegt: ${e.action.title}` }, e.action.id);
    case 'editAction': {
      const a = s.actions.find((x) => x.id === e.id);
      if (!a || a.status !== 'draft') return { state: s };
      return owner({ state: replaceAction(s, editDraft(a, e.payload)), text: `Entwurf geändert: ${a.title}` }, a.id);
    }
    case 'approveAction': {
      const a = s.actions.find((x) => x.id === e.id);
      if (!a) return { state: s };
      const r = approve(a, { version: e.version, via: e.via, buttonIssuedAt: e.buttonIssuedAt }, at);
      if (!r.ok) return owner({ state: s, text: `Abgelehnt: ${REJECT_REASON_DE[r.reason]}` }, a.id);
      return owner({ state: replaceAction(s, r.action), text: `Freigegeben (${e.via === 'app' ? 'App' : 'WhatsApp'}): ${a.title}` }, a.id);
    }
    case 'actionExecuted': {
      const a = s.actions.find((x) => x.id === e.id);
      if (!a || a.status !== 'approved') return { state: s };
      const done = finishExecution(startExecution(a), e.result, at, e.error);
      const st = replaceAction(s, done);
      if (e.result === 'ok') return owner(applyEffects(st, done, ctx), a.id);
      const text = e.result === 'error' ? `Fehlgeschlagen: ${a.title}${e.error ? ` (${e.error})` : ''}` : `Ausgang unklar: ${a.title}`;
      return owner({ state: st, text }, a.id);
    }
    case 'dismissInsight':
      return owner({ state: dismissInsight(s, e.key, at), text: `Hinweis erledigt: ${s.insights.find((i) => i.dedupeKey === e.key)?.title ?? e.key}` });
    case 'snoozeInsight':
      return owner({ state: setStatus(s, e.key, 'snoozed', at), text: `Hinweis zurückgestellt: ${s.insights.find((i) => i.dedupeKey === e.key)?.title ?? e.key}` });
    case 'suppressCoach': {
      const keys = s.settings.suppressedCoachKeys.includes(e.key) ? s.settings.suppressedCoachKeys : [...s.settings.suppressedCoachKeys, e.key];
      const st = setStatus({ ...s, settings: { ...s.settings, suppressedCoachKeys: keys } }, e.key, 'dismissed', at);
      return owner({ state: st, text: `Coach-Tipp nicht mehr vorschlagen: ${s.insights.find((i) => i.dedupeKey === e.key)?.title ?? e.key}` });
    }
    case 'setSlides': {
      const call = s.calls.find((c) => c.id === e.callId);
      const calls = s.calls.map((c) => (c.id === e.callId ? { ...c, slides: e.slides, slidesStatus: e.status } : c));
      return owner({ state: { ...s, calls }, text: `Folien für „${call?.topic ?? e.callId}“: ${e.status}` });
    }
    case 'setConnectionStatus': {
      const conn = s.connections.find((c) => c.id === e.id);
      const connections = s.connections.map((c) => {
        if (c.id !== e.id) return c;
        if (e.status === 'connected') {
          const next: Connection = { ...c, status: e.status, lastSuccessAt: at.toISOString() };
          delete next.lastError;
          return next;
        }
        return { ...c, status: e.status, ...(e.status === 'error' ? { lastError: 'Störung simuliert (Demo)' } : {}) };
      });
      const what = e.status === 'error' ? 'Störung simuliert' : e.status === 'connected' ? 'wieder verbunden' : 'getrennt';
      return owner({ state: { ...s, connections }, text: `Verbindung ${conn?.label ?? e.id}: ${what}` });
    }
    case 'assistantInbound': {
      const owner = validPhone(s.settings.ownerPhone);
      const fromOwner = owner !== null && normalizePhone(e.from) === owner;
      const text = fromOwner ? e.text : `Nachricht von fremder Nummer ignoriert: „${e.text}“`;
      const msg: AssistantMessage = { id: ctx.newId(), direction: fromOwner ? 'from_owner' : 'ignored', from: e.from, text, at: at.toISOString() };
      const st = { ...s, assistantChat: [...s.assistantChat, msg] };
      return fromOwner
        ? { state: st, audit: { actor: 'owner', text: `Nachricht an den Assistenten: ${e.text}` } }
        : { state: st, audit: { actor: 'system', text: `Nachricht von fremder Nummer ignoriert: ${e.from}` } };
    }
    case 'assistantOutbound': {
      const msg: AssistantMessage = {
        id: e.id ?? ctx.newId(), direction: 'to_owner', from: 'Nexus Assistent', text: e.text, at: at.toISOString(),
        ...(e.buttons ? { buttons: e.buttons } : {}),
        ...(e.links?.length ? { links: e.links } : {}),
      };
      return { state: { ...s, assistantChat: [...s.assistantChat, msg] }, audit: { actor: 'assistant', text: `Assistent an Inhaber: ${e.text}` } };
    }
    case 'updateSettings': {
      const LABEL: Record<keyof Settings, string> = {
        replyThresholdHours: 'Antwortzeit-Schwelle', briefingsEnabled: 'Briefings', ownerPhone: 'Inhaber-Nummer', suppressedCoachKeys: 'Coach-Tipps',
      };
      const patch = { ...e.patch };
      // Ohne gültige Inhaber-Nummer könnte ein leerer Absender als Inhaber gelten: alte Nummer behalten.
      const badPhone = patch.ownerPhone !== undefined && validPhone(patch.ownerPhone) === null;
      if (badPhone) delete patch.ownerPhone;
      const keys = Object.keys(patch) as (keyof Settings)[];
      const parts = [
        ...(keys.length ? [`Einstellungen geändert: ${keys.map((k) => LABEL[k]).join(', ')}`] : []),
        ...(badPhone ? [`Inhaber-Nummer ungültig, nicht übernommen: „${e.patch.ownerPhone}“`] : []),
      ];
      return owner({ state: { ...s, settings: { ...s.settings, ...patch } }, text: parts.join(' · ') });
    }
    case 'assistantButton':
      return { state: s }; // wird im reducer aufgelöst
    case 'resetDemo':
      return { state: createDemoState() };
  }
}

export function applyEvent(s: AppState, e: StoreEvent, ctx: EngineContext): EngineResult {
  const created: string[] = [];
  const tracked: EngineContext = { ...ctx, newId: () => { const id = ctx.newId(); created.push(id); return id; } };
  const step = (st: AppState, ev: StoreEvent): AppState => {
    // Knopf aus dem WhatsApp-Verlauf: mit dem frischesten Stand auswerten, damit ein zweiter Klick nie ein zweites „Gesendet“ ergibt.
    if (ev.type === 'assistantButton') return handleButton(st, ev.button, ctx.at).events.reduce(step, st);
    const { state, audit } = mutate(st, ev, tracked);
    const withAudit = audit ? { ...state, audit: [...state.audit, { at: ctx.at.toISOString(), isDemo: ctx.isDemo, ...audit }] } : state;
    return refresh(withAudit, ctx.at, ctx.isDemo);
  };
  return { state: step(s, e), created };
}

export function applyEvents(s: AppState, es: StoreEvent[], ctx: EngineContext): EngineResult {
  let state = s;
  const created: string[] = [];
  for (const e of es) {
    const r = applyEvent(state, e, ctx);
    state = r.state;
    created.push(...r.created);
  }
  return { state, created };
}

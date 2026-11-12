export type Company = 'nexus' | 'zulassung';
export type IsoDate = string; // 'YYYY-MM-DD'
export type ConnectionId = 'lexware_nexus'|'lexware_zulassung'|'stripe_nexus'|'bank'|'gmail'|'icloud'|'info_mail'|'calendar'|'whatsapp_kunden'|'whatsapp_assistent';
export interface Connection { id: ConnectionId; company: Company | null; label: string; status: 'connected'|'missing'|'error'; lastSuccessAt: string | null; lastError?: string }
export interface Contact { id: string; company: Company; kind: 'member'|'private'|'dealer'; name: string; phones: string[]; emails: string[] }
export interface MemberContract { id: string; contactId: string; totalCents: number; installments: number; installmentCents: number; dueDay: number; startDate: IsoDate; billing: 'legacy'|'stripe'; specialTerms?: string; catchUpMode: 'first_rate'|'spread' }
export type ContractException =
  | { kind: 'deferral'; from: IsoDate; to: IsoDate }
  | { kind: 'pause'; from: IsoDate; months: number }
  | { kind: 'due_day_shift'; from: IsoDate; newDueDay: number };
export interface Installment { no: number; dueDate: IsoDate; amountCents: number }
export interface InstallmentState extends Installment { paidCents: number; paidOn: IsoDate | null }
export interface Payment { id: string; company: Company; source: 'bank'|'stripe'|'manual'; connectionId: ConnectionId | null; externalId: string; amountCents: number; bookedOn: IsoDate; payerName?: string; iban?: string; reference?: string; kind: 'incoming'|'stripe_payout' }
export interface Allocation { paymentId: string; contractId: string; amountCents: number; method: 'auto'|'confirmed'|'manual' }
export interface IbanLink { iban: string; contactId: string; confirmedAt: string }
export interface Invoice { id: string; company: Company; source: 'lexware'|'stripe'; connectionId: ConnectionId; externalId: string; contactId: string | null; number: string; totalCents: number; openCents: number; issuedOn: IsoDate; dueDate: IsoDate; status: 'open'|'paid'|'overdue'|'void'; text?: string; settledByPaymentId?: string }
export interface Message { id: string; channel: 'whatsapp'|'email'; connectionId: ConnectionId; externalId: string; threadId: string; direction: 'in'|'out'; from: string; to: string; body: string; sentAt: string; contactId: string | null; jobId: string | null; needsReply: boolean; doneManually?: boolean }
export interface Commitment { id: string; messageId: string; contactId: string; kind: 'invoice'|'callback'|'other'; text: string; dueAt: string; status: 'open'|'kept'|'broken' }
export interface CalendarEvent { id: string; title: string; startAt: string; endAt: string; location?: string }
export interface Call { id: string; series: string; startsAt: string; topic: string; slideCount: number; slidesStatus: 'todo'|'draft'|'reviewed'|'copied'; slides: { position: number; title: string; body: string }[] }
export interface ContentItem { id: string; title: string; stage: 'idea'|'raw'|'edit'|'approval'|'published'; due?: IsoDate }
export interface Vehicle { id: string; contactId: string; vin: string; plate: string; model: string }
export interface Job { id: string; vehicleId: string; contactId: string; service: string; location: 'bottrop'|'essen'|'online'|'onsite'; priceCents: number; status: 'open'|'waiting_customer'|'done'|'invoiced'|'paid'; doneAt: string | null; invoiceIds: string[]; notes?: string }
export type InsightType = 'reply_waiting'|'member_overdue'|'unmatched_payment'|'stripe_paid_lexware_open'|'double_invoice'|'job_not_invoiced'|'invoice_overdue'|'call_slides_missing'|'commitment_broken'|'stale_source'|'coach_quick_reply'|'coach_due_day'|'coach_onsite_surcharge'|'coach_invoice_delay';
export interface Ref { kind: 'member'|'message'|'thread'|'invoice'|'job'|'call'|'payment'|'connection'; id: string; href: string; label: string }
export interface Insight { dedupeKey: string; type: InsightType; company: Company | null; priority: 'now'|'today'|'info'; title: string; body: string; amountCents?: number; refs: Ref[]; nextStep: string; needsSources: ConnectionId[] }
export interface StoredInsight extends Insight { status: 'open'|'done'|'snoozed'|'dismissed'|'stale'; createdAt: string; resolvedAt?: string }
export interface Settings { replyThresholdHours: number; briefingsEnabled: boolean; ownerPhone: string; suppressedCoachKeys: string[] }

export type ActionType = 'send_whatsapp'|'send_email'|'send_reminder'|'create_invoice_draft'|'create_calendar_event'|'mark_invoice_settled'|'link_invoice_to_job'|'confirm_payment_match';
export type ActionStatus = 'draft'|'approved'|'executing'|'executed'|'failed'|'uncertain'|'cancelled';
export interface Action { id: string; type: ActionType; company: Company | null; title: string; payload: Record<string, unknown>; version: number; status: ActionStatus; createdAt: string; approvedVia?: 'app'|'whatsapp'|'auto'; approvedAt?: string; executedAt?: string; error?: string; isDemo: true; insightKey?: string }
export interface AuditEntry { at: string; actor: 'owner'|'assistant'|'system'; text: string; actionId?: string; isDemo: boolean }
export interface AssistantMessage { id: string; direction: 'to_owner'|'from_owner'|'ignored'; from: string; text: string; at: string; buttons?: { label: 'Senden'|'Ändern'|'Später'; actionId: string; version: number; issuedAt: string }[]; links?: { label: string; href: string }[] }

export interface AppState { connections: Connection[]; contacts: Contact[]; contracts: MemberContract[]; exceptions: Record<string, ContractException[]>; payments: Payment[]; allocations: Allocation[]; ibanLinks: IbanLink[]; invoices: Invoice[]; messages: Message[]; commitments: Commitment[]; events: CalendarEvent[]; calls: Call[]; content: ContentItem[]; vehicles: Vehicle[]; jobs: Job[]; insights: StoredInsight[]; actions: Action[]; audit: AuditEntry[]; jobRuns: string[]; assistantChat: AssistantMessage[]; settings: Settings }

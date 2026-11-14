import type { ImportBatch, ImportedPayment } from './import/batch';
import type { ContractDraft } from './import/contract-draft';
import type { PortalListEntry } from './import/portal-list';
import type { Action, AssistantMessage, Call, Connection, ConnectionId, InvoiceReading, IsoDate, Job, MemberContract, Settings } from './types';
import type { ActionOutput } from './actions/machine';

/** Neue Lesung vom Server; `error` gesetzt = Fehlversuch. Ergebnis und Vertrag bestimmt der Reducer. */
export type NewInvoiceReading = Omit<InvoiceReading, 'outcome' | 'contractId'>;

/** Woher eine Nachricht an den Assistenten kommt: WhatsApp (Absender wird geprüft) oder die angemeldete App. */
export type InboundChannel = 'whatsapp' | 'app';

/** Alle Ereignisse, die den App-Zustand ändern (Store, Assistent, später Phase-2-Anbindungen). */
export type StoreEvent =
  /** Genau eins von `contractId`, `invoiceId` und `invoiceIds` (Sammelzahlung, 1–50 eindeutige Rechnungen). */
  | { type: 'confirmPaymentMatch'; paymentId: string; contractId?: string; invoiceId?: string; invoiceIds?: string[] }
  | { type: 'dismissPayment'; paymentId: string }
  | { type: 'simulateTransfer'; iban: string; payerName: string; amountCents: number }
  | { type: 'settleInvoice'; invoiceId: string; paymentId: string }
  | { type: 'linkInvoiceToJob'; jobId: string; invoiceId: string }
  | { type: 'setJobStatus'; jobId: string; status: Job['status'] }
  | { type: 'createAction'; action: Action }
  | { type: 'editAction'; id: string; payload: Record<string, unknown> }
  | { type: 'approveAction'; id: string; version: number; via: 'app' | 'whatsapp'; buttonIssuedAt?: string }
  | { type: 'actionStarted'; id: string }
  | { type: 'actionExecuted'; id: string; result: 'ok' | 'error' | 'timeout'; error?: string; simulated?: boolean; output?: ActionOutput }
  | { type: 'actionReconciled'; id: string; found: boolean; simulated?: boolean; output?: ActionOutput }
  | { type: 'retryAction'; id: string }
  | { type: 'checkAction'; id: string }
  | { type: 'dismissInsight'; key: string }
  | { type: 'snoozeInsight'; key: string }
  | { type: 'suppressCoach'; key: string }
  | { type: 'setSlides'; callId: string; slides: Call['slides']; status: Call['slidesStatus'] }
  | { type: 'setConnectionStatus'; id: ConnectionId; status: Connection['status'] }
  /** `channel: 'app'`: aus der angemeldeten App-Sitzung (nur Server-Ereignis), gilt ohne Nummernprüfung als Inhaber. */
  | { type: 'assistantInbound'; from: string; text: string; channel?: InboundChannel }
  | { type: 'assistantOutbound'; id?: string; text: string; delivery?: AssistantMessage['delivery']; buttons?: AssistantMessage['buttons']; links?: AssistantMessage['links'] }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'assistantButton'; button: NonNullable<AssistantMessage['buttons']>[number] }
  /** Nur Server: Ergebnis eines Abrufs (Stripe, Lexware). */
  | { type: 'importBatch'; connectionId: ConnectionId; batch: ImportBatch; cursor: string | null; complete: boolean; warning?: string }
  | { type: 'syncFailed'; connectionId: ConnectionId; error: string }
  /** `contactId`: „Ja“ auf „Ist das … ?“ (Name-Treffer); sonst null. */
  | { type: 'confirmProposal'; proposalId: string; draft: ContractDraft; contactId: string | null }
  | { type: 'dismissProposal'; proposalId: string }
  | { type: 'invoicesRead'; readings: NewInvoiceReading[]; warning?: string; error?: string }
  | { type: 'confirmReadContract'; contractId: string }
  | { type: 'correctContract'; contractId: string; draft: ContractDraft }
  | { type: 'deleteReadContract'; contractId: string }
  /** Mitgliederliste aus dem Portal: zusammenführen, nie löschen. */
  | { type: 'importPortalList'; entries: PortalListEntry[] }
  /** Sparkasse-Auszug (vom Client geparst); die Engine baut die Zahlungen aus den Feldern neu. `statementTo`: letzter Buchungstag der Datei (auch ohne neue Zahlungen Cursor und Frische). */
  | { type: 'importBankStatement'; connectionId: 'bank_sparkasse'; payments: ImportedPayment[]; statementTo: IsoDate }
  /** Vertrag für ein Portal-Mitglied ohne Vertrag; `created[0]` ist die Vertrags-ID. `contactId`: bestätigter Namenstreffer, sonst null. */
  | { type: 'createPortalContract'; externalId: string; draft: ContractDraft; contactId: string | null }
  /** „Kein zahlendes Mitglied“: Mitglied aus der Arbeitsliste ausblenden (idempotent). */
  | { type: 'ignorePortalMember'; externalId: string }
  /** „Wieder einblenden“: macht „Kein zahlendes Mitglied“ rückgängig (idempotent). */
  | { type: 'unignorePortalMember'; externalId: string }
  /** Umstellung auf Stripe: Entwurf anlegen bzw. als neue Version fortschreiben (Raten rechnet der Reducer aus dem Stand). */
  | { type: 'prepareTakeover'; contractId: string; mode: MemberContract['catchUpMode'] }
  /** „Alle umstellen“: je Mitgliedschaft ohne Sperrgrund und ohne offene Umstellung, Modus aus dem Vertrag. */
  | { type: 'prepareAllTakeovers' }
  | { type: 'withdrawTakeover'; contractId: string }
  /** Sammelfreigabe (nur App), 1–100 Einträge. */
  | { type: 'approveActions'; items: { id: string; version: number }[] }
  /** „Zahlungsmittel hinterlegt (Demo)“: nur für Demo-Umstellungen. */
  | { type: 'simulateTakeoverSetUp'; contractId: string }
  /** Nur Server (Webhook): Zahlungsmittel hinterlegt, Zeitplan angelegt. */
  | { type: 'takeoverSetUp'; takeoverId: string; scheduleId: string; paymentMethodId: string }
  /** Nur Server (Webhook): Plan weicht ab, kein Zeitplan. */
  | { type: 'takeoverPlanChanged'; takeoverId: string; paymentMethodId: string }
  | { type: 'resetDemo' };

import type { Action, AssistantMessage, Call, Connection, ConnectionId, Job, Settings } from './types';

/** Woher eine Nachricht an den Assistenten kommt: WhatsApp (Absender wird geprüft) oder die angemeldete App. */
export type InboundChannel = 'whatsapp' | 'app';

/** Alle Ereignisse, die den App-Zustand ändern (Store, Assistent, später Phase-2-Anbindungen). */
export type StoreEvent =
  | { type: 'confirmPaymentMatch'; paymentId: string; contractId: string }
  | { type: 'simulateTransfer'; iban: string; payerName: string; amountCents: number }
  | { type: 'settleInvoice'; invoiceId: string; paymentId: string }
  | { type: 'linkInvoiceToJob'; jobId: string; invoiceId: string }
  | { type: 'setJobStatus'; jobId: string; status: Job['status'] }
  | { type: 'createAction'; action: Action }
  | { type: 'editAction'; id: string; payload: Record<string, unknown> }
  | { type: 'approveAction'; id: string; version: number; via: 'app' | 'whatsapp'; buttonIssuedAt?: string }
  | { type: 'actionStarted'; id: string }
  | { type: 'actionExecuted'; id: string; result: 'ok' | 'error' | 'timeout'; error?: string; simulated?: boolean }
  | { type: 'actionReconciled'; id: string; found: boolean; simulated?: boolean }
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
  | { type: 'resetDemo' };

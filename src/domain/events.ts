import type { Action, AssistantMessage, Call, Connection, ConnectionId, Job, Settings } from './types';

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
  | { type: 'actionExecuted'; id: string; result: 'ok' | 'error' | 'timeout'; error?: string }
  | { type: 'dismissInsight'; key: string }
  | { type: 'snoozeInsight'; key: string }
  | { type: 'suppressCoach'; key: string }
  | { type: 'setSlides'; callId: string; slides: Call['slides']; status: Call['slidesStatus'] }
  | { type: 'setConnectionStatus'; id: ConnectionId; status: Connection['status'] }
  | { type: 'assistantInbound'; from: string; text: string }
  | { type: 'assistantOutbound'; text: string; buttons?: AssistantMessage['buttons'] }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'assistantButton'; button: NonNullable<AssistantMessage['buttons']>[number] }
  | { type: 'resetDemo' };

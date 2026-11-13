import 'server-only';

import type { ImportBatch } from '@/domain/import/batch';

export interface PullContext {
  fetch: typeof fetch;
  key: string;
  sleep: (ms: number) => Promise<void>;
  now: () => number; // Millisekunden
  deadline: number; // Millisekunden; vor jeder Anfrage gilt now() < deadline
  known: ReadonlyMap<string, string | undefined>; // externalId → sourceUpdatedAt
}

export interface PullResult {
  batch: ImportBatch;
  /** Fortsetzungspunkt (bei `complete: false`) bzw. Startpunkt des nächsten Laufs (bei `complete: true`, Lexware: null). */
  cursor: string | null;
  complete: boolean;
  /** Teil-Störung ohne Abbruch (z. B. Lexware lehnt die AB-Belegliste ab): schon bereinigte Meldung, Verbindung bleibt verbunden. */
  warning?: string;
}

/** Nachricht ist bereits sicher: ohne Schlüssel, ohne URL-Query, ohne Antworttext. */
export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorError';
  }
}

/** Intern: Zeitbudget erreicht. Wird vom Connector gefangen und in ein Teilergebnis verwandelt. */
export class BudgetExceeded extends Error {}

/** Der Anbieter drosselt auch nach Wiederholungen (HTTP 429): wie Zeitbudget behandeln, im nächsten Lauf am Cursor weiter. */
export class RateLimited extends BudgetExceeded {}

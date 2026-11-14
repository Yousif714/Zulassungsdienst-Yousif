import { currentTakeover } from './takeover/status';
import type { AppState } from './types';

/** Echter Zahlungslink der Umstellung; nur solange er gültig ist (Status `link_sent`), sonst null. */
export function takeoverLinkFor(s: AppState, contractId: string): string | null {
  const t = currentTakeover(s, contractId);
  return t?.status === 'link_sent' ? t.link : null;
}

/** Link für Erinnerungen: echter Umstellungs-Link, ohne Umstellung der bisherige Demo-Link. */
export const paymentLinkFor = (s: AppState, contractId: string): string =>
  takeoverLinkFor(s, contractId) ?? `https://buy.stripe.com/demo/${contractId}`;

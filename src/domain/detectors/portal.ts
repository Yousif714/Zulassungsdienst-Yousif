import { portalViews } from '../portal';
import type { AppState, Insight } from '../types';
import { portalRef } from './refs';

/** Sammelhinweis. Der Schlüssel enthält kein Datum, damit ein abgehakter Hinweis nicht täglich wiederkommt. */
export function detectPortalNoInvoice(s: AppState): Insight[] {
  const names = portalViews(s).filter((v) => v.status === 'no_invoice' && v.inLatestList).map((v) => v.member.name);
  if (names.length === 0) return [];
  const rest = names.length - 3;
  return [{
    dedupeKey: 'portal-no-invoice',
    type: 'portal_no_invoice',
    company: 'nexus',
    priority: 'info',
    title: names.length === 1 ? '1 Mitglied ohne Rechnung' : `${names.length} Mitglieder ohne Rechnung`,
    body: names.slice(0, 3).join(', ') + (rest > 0 ? ` und ${rest} weitere` : ''),
    refs: [portalRef('Portal-Mitglieder')],
    nextStep: 'Mitglieder ohne Rechnung ansehen',
    needsSources: ['portal_nexus', 'lexware_nexus'],
  }];
}

/** Sammelhinweis „N Mitglieder mit Auftragsbestätigung, aber ohne Rechnung“ (Schlüssel ohne Datum). */
export function detectPortalAbNoInvoice(s: AppState): Insight[] {
  const views = portalViews(s).filter((v) => v.abHint !== null && v.status !== 'ignored' && v.inLatestList);
  if (views.length === 0) return [];
  const rest = views.length - 3;
  return [{
    dedupeKey: 'ab-ohne-rechnung',
    type: 'portal_ab_no_invoice',
    company: 'nexus',
    priority: 'info',
    title: `${views.length === 1 ? '1 Mitglied' : `${views.length} Mitglieder`} mit Auftragsbestätigung, aber ohne Rechnung`,
    body: views.slice(0, 3).map((v) => `${v.member.name} (${v.orderConfirmations.map((x) => x.number).join(', ')})`).join(', ') + (rest > 0 ? ` und ${rest} weitere` : ''),
    refs: [portalRef('Portal-Mitglieder')],
    nextStep: 'Rechnungen in Lexware schreiben',
    needsSources: ['portal_nexus', 'lexware_nexus'],
  }];
}

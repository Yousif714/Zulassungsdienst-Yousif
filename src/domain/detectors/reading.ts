import { sourceInvoiceOf } from '../ledger/contracts';
import type { AppState, Insight, MemberContract } from '../types';
import { memberRef } from './refs';

const contactName = (s: AppState, c: MemberContract) => s.contacts.find((x) => x.id === c.contactId)?.name ?? 'Unbekannter Kontakt';

/** Ein Sammelhinweis, solange Claude-Verträge auf „Passt“ oder „Korrigieren“ warten. */
export function detectReadContracts(s: AppState): Insight[] {
  const open = s.contracts.filter((c) => c.readBy && !c.readBy.confirmed);
  if (open.length === 0) return [];
  const n = open.length;
  return [{
    dedupeKey: 'read-review',
    type: 'contract_read_review',
    company: 'nexus',
    priority: 'today',
    title: n === 1 ? '1 Ratenplan von Claude gelesen – kurz prüfen' : `${n} Ratenpläne von Claude gelesen – kurz prüfen`,
    body: 'Claude hat Ratenpläne aus Rechnungen angelegt. Kurz ansehen und „Passt“ tippen oder korrigieren.',
    refs: open.map((c) => memberRef(c.id, contactName(s, c))),
    nextStep: 'Kurz prüfen',
    needsSources: ['lexware_nexus'],
  }];
}

/** Quellrechnung eines Claude-Vertrags in Lexware storniert oder als bezahlt markiert: Inhaber entscheidet (Spec 9a). */
export function detectReadInvoiceChanged(s: AppState): Insight[] {
  const out: Insight[] = [];
  for (const c of s.contracts) {
    if (!c.readBy) continue;
    const inv = sourceInvoiceOf(s, c);
    if (!inv || (inv.status !== 'void' && inv.status !== 'paid')) continue;
    out.push({
      dedupeKey: `read-inv:${inv.id}:${inv.status}`,
      type: 'read_invoice_changed',
      company: 'nexus',
      priority: 'today',
      title: `Rechnung ${inv.number} ${inv.status === 'void' ? 'storniert' : 'als bezahlt markiert'} – Ratenvertrag prüfen`,
      body: `${contactName(s, c)}: Der Ratenvertrag aus dieser Rechnung bleibt bestehen, bis du entscheidest.`,
      refs: [memberRef(c.id, contactName(s, c))],
      nextStep: 'Vertrag prüfen',
      needsSources: ['lexware_nexus'],
    });
  }
  return out;
}

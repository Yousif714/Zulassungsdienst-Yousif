import { todayBerlin } from '../clock';
import { contractSources, notConnected } from '../connections';
import { allocate } from '../ledger/allocate';
import { buildSchedule } from '../ledger/schedule';
import { memberStatus, type MemberStatus } from '../ledger/status';
import { formatEuro } from '../money';
import type { AppState, ConnectionId, Contact, Insight, InstallmentState, Installment, IsoDate, MemberContract } from '../types';
import { memberRef } from './refs';
import { contractOnHold } from '../ledger/contracts';
import { reminderBlockedReason } from '../takeover/status';

export function memberView(
  s: AppState,
  contractId: string,
  today: IsoDate,
): { contract: MemberContract; contact: Contact | undefined; schedule: Installment[]; states: InstallmentState[]; status: MemberStatus } {
  const contract = s.contracts.find((c) => c.id === contractId);
  if (!contract) throw new Error(`Vertrag ${contractId} nicht gefunden`);
  const schedule = buildSchedule(contract, s.exceptions[contractId] ?? []);
  const paid = s.allocations
    .filter((a) => a.contractId === contractId)
    .flatMap((a) => {
      const p = s.payments.find((x) => x.id === a.paymentId);
      return p ? [{ bookedOn: p.bookedOn, amountCents: a.amountCents }] : [];
    });
  const { states, overpaidCents } = allocate(schedule, paid);
  return {
    contract,
    contact: s.contacts.find((c) => c.id === contract.contactId),
    schedule,
    states,
    status: memberStatus(states, overpaidCents, today),
  };
}

export function detectMemberOverdue(s: AppState, now: Date): Insight[] {
  const today = todayBerlin(now);
  const out: Insight[] = [];
  let sum = 0;
  // Sammelhinweis: nur Verträge, deren Quelle verbunden ist (wie in den Selektoren)
  const sources = new Set<ConnectionId>();
  const summaryRefs: Insight['refs'] = [];
  const overdueContacts = new Set<string>();
  for (const c of s.contracts) {
    if (contractOnHold(s, c)) continue; // stornierte Quellrechnung: ruht, kein Hinweis
    const v = memberView(s, c.id, today);
    if (!v.contact || v.status.traffic === 'green') continue;
    const name = v.contact.name;
    const arrears = v.status.arrearsCents;
    if (!notConnected(contractSources(c), s.connections)) {
      sum += arrears;
      overdueContacts.add(c.contactId);
      contractSources(c).forEach((x) => sources.add(x));
      summaryRefs.push(memberRef(c.id, name));
    }
    // Raten laufen über Stripe: Abbuchung kann unterwegs sein, eine Erinnerung führte zur Doppelzahlung.
    const viaStripe = reminderBlockedReason(s, c.id);
    out.push({
      dedupeKey: `overdue:${c.id}`,
      type: 'member_overdue',
      company: 'nexus',
      priority: 'info',
      title: `${name} ist im Rückstand`,
      body: `Rückstand ${formatEuro(arrears)}, seit ${v.status.daysOverdue} Tagen überfällig.${viaStripe ? ` ${viaStripe}` : ''}`,
      amountCents: arrears,
      refs: [memberRef(c.id, name)],
      nextStep: viaStripe ? 'In Stripe prüfen' : 'Erinnerung vorbereiten',
      needsSources: contractSources(c),
    });
  }
  const count = overdueContacts.size;
  if (count >= 2) {
    out.push({
      dedupeKey: `overdue:all:${today}`,
      type: 'member_overdue',
      company: 'nexus',
      priority: 'today',
      title: `${count} Mitglieder überfällig, zusammen ${formatEuro(sum)}`,
      body: `Offene Rückstände bei ${count} Mitgliedern.`,
      amountCents: sum,
      refs: summaryRefs,
      nextStep: 'Erinnerungen vorbereiten',
      needsSources: [...sources],
    });
  }
  return out;
}

import { todayBerlin } from '../clock';
import { contractSources } from '../connections';
import { allocate } from '../ledger/allocate';
import { buildSchedule } from '../ledger/schedule';
import { memberStatus, type MemberStatus } from '../ledger/status';
import { formatEuro } from '../money';
import type { AppState, ConnectionId, Contact, Insight, InstallmentState, Installment, IsoDate, MemberContract } from '../types';
import { memberRef } from './refs';

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
  let count = 0;
  const sources = new Set<ConnectionId>();
  for (const c of s.contracts) {
    const v = memberView(s, c.id, today);
    if (!v.contact || v.status.traffic === 'green') continue;
    const name = v.contact.name;
    const arrears = v.status.arrearsCents;
    sum += arrears;
    count++;
    contractSources(c).forEach((x) => sources.add(x));
    out.push({
      dedupeKey: `overdue:${c.id}`,
      type: 'member_overdue',
      company: 'nexus',
      priority: 'info',
      title: `${name} ist im Rückstand`,
      body: `Rückstand ${formatEuro(arrears)}, seit ${v.status.daysOverdue} Tagen überfällig.`,
      amountCents: arrears,
      refs: [memberRef(c.id, name)],
      nextStep: 'Erinnerung vorbereiten',
      needsSources: contractSources(c),
    });
  }
  if (count >= 2) {
    out.push({
      dedupeKey: `overdue:all:${today}`,
      type: 'member_overdue',
      company: 'nexus',
      priority: 'today',
      title: `${count} Mitglieder überfällig, zusammen ${formatEuro(sum)}`,
      body: `Offene Rückstände bei ${count} Mitgliedern.`,
      amountCents: sum,
      refs: out.map((i) => i.refs[0]),
      nextStep: 'Erinnerungen vorbereiten',
      needsSources: [...sources],
    });
  }
  return out;
}

import { memberView } from '@/domain/detectors';
import type { AppState, IsoDate, MemberContract, StoredInsight } from '@/domain/types';
import type { MemberStatus } from '@/domain/ledger/status';

export const openInsights = (s: AppState): StoredInsight[] => s.insights.filter((i) => i.status === 'open');

export type MemberRow = {
  contractId: string;
  name: string;
  traffic: MemberStatus['traffic'];
  arrearsCents: number;
  openCents: number;
  billing: MemberContract['billing'];
};

export function memberRows(s: AppState, today: IsoDate): MemberRow[] {
  return s.contracts.map((c) => {
    const v = memberView(s, c.id, today);
    return {
      contractId: c.id,
      name: v.contact?.name ?? 'Unbekannt',
      traffic: v.status.traffic,
      arrearsCents: v.status.arrearsCents,
      openCents: v.status.openCents,
      billing: c.billing,
    };
  });
}

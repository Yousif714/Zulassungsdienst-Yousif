import type { MemberStatus } from '@/domain/ledger/status';

const TRAFFIC: Record<MemberStatus['traffic'], { color: string; label: string }> = {
  green: { color: 'var(--green)', label: 'Im Plan' },
  yellow: { color: 'var(--orange)', label: 'Leicht überfällig' },
  red: { color: 'var(--red)', label: 'Überfällig' },
};

export const TRAFFIC_LABEL = (t: MemberStatus['traffic']) => TRAFFIC[t].label;

/** Ampelpunkt mit Text für Screenreader. */
export function TrafficDot({ traffic }: { traffic: MemberStatus['traffic'] }) {
  return (
    <span className="traffic-dot" style={{ background: TRAFFIC[traffic].color }} role="img" aria-label={TRAFFIC[traffic].label} data-traffic={traffic} />
  );
}

import type { MemberStatus } from '@/domain/ledger/status';

type Traffic = MemberStatus['traffic'] | 'grey';

const TRAFFIC: Record<Traffic, { color: string; label: string }> = {
  green: { color: 'var(--green)', label: 'Im Plan' },
  yellow: { color: 'var(--orange)', label: 'Leicht überfällig' },
  red: { color: 'var(--red)', label: 'Überfällig' },
  grey: { color: 'var(--gray)', label: 'Ruht – Rechnung storniert' },
};

export const TRAFFIC_LABEL = (t: Traffic) => TRAFFIC[t].label;

/** Ampelpunkt mit Text für Screenreader. */
export function TrafficDot({ traffic }: { traffic: Traffic }) {
  return (
    <span className="traffic-dot" style={{ background: TRAFFIC[traffic].color }} role="img" aria-label={TRAFFIC[traffic].label} data-traffic={traffic} />
  );
}

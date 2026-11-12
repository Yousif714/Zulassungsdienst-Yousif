'use client';

import { useState } from 'react';

import { DemoBadge } from '@/components/DemoBadge';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { validPhone } from '@/domain/matching/messages';

export default function EinstellungenPage() {
  const { state, dispatch } = useAppStore();
  const { settings } = state;
  const [resetDone, setResetDone] = useState(false);

  const commitThreshold = (raw: string, el: HTMLInputElement) => {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 72) {
      if (n !== settings.replyThresholdHours) dispatch({ type: 'updateSettings', patch: { replyThresholdHours: n } });
    } else el.value = String(settings.replyThresholdHours);
  };
  const commitPhone = (raw: string, el: HTMLInputElement) => {
    const v = raw.trim();
    if (validPhone(v)) {
      if (v !== settings.ownerPhone) dispatch({ type: 'updateSettings', patch: { ownerPhone: v } });
    } else el.value = settings.ownerPhone;
  };

  return (
    <>
      <PageHeader title="Einstellungen" />

      <ListGroup title="Briefings">
        <ListRow key="briefings" title={<label className="wrap-text" htmlFor="set-briefings">Briefings (Morgen und Abend)</label>}
          subtitle={<span className="wrap-text">{"Morgenbriefing um 7 Uhr, Abendrückblick um 19 Uhr"}</span>}
          accessory={<input id="set-briefings" type="checkbox" role="switch" className="switch" checked={settings.briefingsEnabled}
            onChange={(e) => dispatch({ type: 'updateSettings', patch: { briefingsEnabled: e.target.checked } })} />} />
      </ListGroup>

      <ListGroup title="Antworten">
        <ListRow key="threshold" title={<label className="wrap-text" htmlFor="set-threshold">Antwortzeit-Schwelle (Stunden)</label>}
          subtitle={<span className="wrap-text">{"Ab dann gilt eine Kundennachricht als wartend"}</span>}
          accessory={<input id="set-threshold" key={settings.replyThresholdHours} className="settings-input settings-number" type="number" inputMode="numeric"
            min={1} max={72} defaultValue={settings.replyThresholdHours} onBlur={(e) => commitThreshold(e.target.value, e.target)} />} />
      </ListGroup>

      <ListGroup title="Assistent">
        <ListRow key="phone" title={<label className="wrap-text" htmlFor="set-phone">Inhaber-Nummer</label>}
          subtitle={<span className="wrap-text">{"Nur Nachrichten von dieser Nummer beantwortet der Assistent"}</span>}
          accessory={<input id="set-phone" key={settings.ownerPhone} className="settings-input" type="tel" autoComplete="tel"
            defaultValue={settings.ownerPhone} onBlur={(e) => commitPhone(e.target.value, e.target)} />} />
      </ListGroup>

      <ListGroup title="Coach">
        <ListRow key="coach" title={<span className="wrap-text">Ausgeblendete Tipps</span>} subtitle={<span className="wrap-text">{"Tipps, die du mit „Nicht mehr vorschlagen“ ausgeblendet hast"}</span>}
          accessory={<button type="button" className="btn btn-secondary btn-small" disabled={settings.suppressedCoachKeys.length === 0}
            aria-label={`Coach-Tipps zurücksetzen (${settings.suppressedCoachKeys.length})`} onClick={() => dispatch({ type: 'updateSettings', patch: { suppressedCoachKeys: [] } })}>
            Zurücksetzen ({settings.suppressedCoachKeys.length})
          </button>} />
      </ListGroup>

      <ListGroup title="Demo">
        <ListRow key="reset" title={<span className="wrap-text">Alle Demo-Daten auf den Anfang</span>} subtitle={<DemoBadge />}
          accessory={<button type="button" className="btn btn-secondary btn-small destructive" onClick={() => { dispatch({ type: 'resetDemo' }); setResetDone(true); }}>
            Demo zurücksetzen
          </button>} />
      </ListGroup>
      <p role="status" className="settings-status">{resetDone ? 'Demo-Daten wurden zurückgesetzt.' : ''}</p>
    </>
  );
}

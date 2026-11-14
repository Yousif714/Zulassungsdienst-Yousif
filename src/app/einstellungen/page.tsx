'use client';

import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';

import { DemoBadge } from '@/components/DemoBadge';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { signOut, useMode } from '@/data/mode';
import { useAppStore } from '@/data/store';
import { validPhone } from '@/domain/matching/messages';

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Konto (nur angemeldet): Demo-Schalter, weiterer Passkey, neue Wiederherstellungscodes (einmal sichtbar), Abmelden. */
function AccountGroup({ demo, setDemo, setStatus }: { demo: boolean; setDemo(on: boolean): void; setStatus(s: string): void }) {
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const run = async (fn: () => Promise<string>, fallback: string) => {
    setBusy(true);
    setStatus('');
    try {
      setStatus(await fn());
    } catch {
      setStatus(fallback);
    } finally {
      setBusy(false);
    }
  };

  const addPasskey = () => run(async () => {
    const opts = await postJson('/api/auth/register/options');
    if (!opts.ok) return 'Passkey konnte nicht hinzugefügt werden.';
    const response = await startRegistration({ optionsJSON: opts.data as never });
    const done = await postJson('/api/auth/register/verify', { response });
    return done.ok ? 'Passkey hinzugefügt.' : 'Passkey konnte nicht hinzugefügt werden.';
  }, 'Passkey konnte nicht hinzugefügt werden.');

  const newCodes = () => run(async () => {
    const r = await postJson('/api/auth/recovery-codes');
    if (!r.ok) return 'Neue Codes nicht möglich.';
    setCodes(r.data.recoveryCodes as string[]);
    return 'Neue Codes jetzt sicher speichern: Sie werden nur einmal angezeigt. Die alten gelten nicht mehr.';
  }, 'Neue Codes nicht möglich.');

  const logout = () => run(async () => ((await signOut()) ? '' : 'Abmelden nicht möglich: Server nicht erreichbar.'), 'Abmelden nicht möglich.');

  return (
    <>
      <ListGroup title="Konto" testId="account-group">
        <ListRow key="demo-mode" title={<label className="wrap-text" htmlFor="set-demo">Demo-Modus</label>}
          subtitle={<span className="wrap-text">{"Beispieldaten statt deiner echten Daten"}</span>}
          accessory={<input id="set-demo" type="checkbox" role="switch" className="switch" checked={demo}
            onChange={(e) => setDemo(e.target.checked)} />} />
        <ListRow key="passkey" title={<span className="wrap-text">Passkey</span>} subtitle={<span className="wrap-text">{"Für ein weiteres Gerät"}</span>}
          accessory={<button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={addPasskey}>Passkey hinzufügen</button>} />
        <ListRow key="codes" title={<span className="wrap-text">Codes</span>}
          accessory={<button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={newCodes}>Neue Wiederherstellungscodes</button>} />
        <ListRow key="logout" title={<span className="wrap-text">Dieses Gerät</span>}
          accessory={<button type="button" className="btn btn-secondary btn-small destructive" disabled={busy} onClick={logout}>Abmelden</button>} />
      </ListGroup>
      {codes && (
        <ListGroup title="Neue Wiederherstellungscodes" testId="recovery-codes">
          {codes.map((c) => <ListRow key={c} title={<code>{c}</code>} />)}
        </ListGroup>
      )}
    </>
  );
}

export default function EinstellungenPage() {
  const { state, dispatch, mode } = useAppStore();
  const { authenticated, setDemo } = useMode();
  const { settings } = state;
  const [status, setStatus] = useState('');

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

  const commitDays = (key: 'takeoverReminderDays' | 'takeoverLinkNudgeDays', max: number, raw: string, el: HTMLInputElement) => {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= max) {
      if (n !== settings[key]) dispatch({ type: 'updateSettings', patch: { [key]: n } });
    } else el.value = String(settings[key]);
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

      <ListGroup title="Umstellung auf Stripe">
        <ListRow key="reminder-days" title={<label className="wrap-text" htmlFor="set-reminder-days">Erinnerung vor Fälligkeit (Tage)</label>}
          subtitle={<span className="wrap-text">{"So viele Tage vor der Rate entsteht ein Erinnerungsentwurf"}</span>}
          accessory={<input id="set-reminder-days" key={settings.takeoverReminderDays} className="settings-input settings-number" type="number" inputMode="numeric"
            min={1} max={14} defaultValue={settings.takeoverReminderDays} onBlur={(e) => commitDays('takeoverReminderDays', 14, e.target.value, e.target)} />} />
        <ListRow key="nudge-days" title={<label className="wrap-text" htmlFor="set-nudge-days">Hinweis, wenn Link ungenutzt (Tage)</label>}
          subtitle={<span className="wrap-text">{"Nach so vielen Tagen ohne Einrichtung erscheint ein Hinweis"}</span>}
          accessory={<input id="set-nudge-days" key={settings.takeoverLinkNudgeDays} className="settings-input settings-number" type="number" inputMode="numeric"
            min={1} max={30} defaultValue={settings.takeoverLinkNudgeDays} onBlur={(e) => commitDays('takeoverLinkNudgeDays', 30, e.target.value, e.target)} />} />
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

      {authenticated && <AccountGroup demo={mode === 'demo'} setDemo={setDemo} setStatus={setStatus} />}

      {mode === 'demo' && (
        <ListGroup title="Demo">
          <ListRow key="reset" title={<span className="wrap-text">Alle Demo-Daten auf den Anfang</span>} subtitle={<DemoBadge />}
            accessory={<button type="button" className="btn btn-secondary btn-small destructive" onClick={() => { dispatch({ type: 'resetDemo' }); setStatus('Demo-Daten wurden zurückgesetzt.'); }}>
              Demo zurücksetzen
            </button>} />
        </ListGroup>
      )}
      <p role="status" className="settings-status">{status}</p>
    </>
  );
}

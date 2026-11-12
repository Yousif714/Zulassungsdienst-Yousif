'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { reloadTo } from '@/data/mode';

async function post(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

const errorText = (data: Record<string, unknown>, fallback: string) => (typeof data.error === 'string' ? data.error : fallback);

export default function AnmeldenPage() {
  const router = useRouter();
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);
  const [setupToken, setSetupToken] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((s: { authenticated: boolean; setupOpen: boolean }) => {
        if (!alive) return;
        if (s.authenticated) router.replace('/');
        else setSetupOpen(s.setupOpen);
      })
      .catch(() => alive && setError('Server nicht erreichbar'));
    return () => { alive = false; };
  }, [router]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  };

  const register = () => run(async () => {
    const opts = await post('/api/auth/register/options', { setupToken });
    if (!opts.ok) return setError(errorText(opts.data, 'Einrichtung nicht möglich'));
    const response = await startRegistration({ optionsJSON: opts.data as never });
    const done = await post('/api/auth/register/verify', { setupToken, response });
    if (!done.ok) return setError(errorText(done.data, 'Einrichtung fehlgeschlagen'));
    setRecoveryCodes(done.data.recoveryCodes as string[]);
  }, 'Passkey konnte nicht angelegt werden');

  const login = () => run(async () => {
    const opts = await post('/api/auth/login/options');
    if (!opts.ok) return setError(errorText(opts.data, 'Anmeldung nicht möglich'));
    const response = await startAuthentication({ optionsJSON: opts.data as never });
    const done = await post('/api/auth/login/verify', { response });
    if (!done.ok) return setError(errorText(done.data, 'Anmeldung fehlgeschlagen'));
    reloadTo('/');
  }, 'Anmeldung fehlgeschlagen');

  const recover = () => run(async () => {
    const done = await post('/api/auth/recover', { code });
    if (!done.ok) return setError(errorText(done.data, 'Code ungültig'));
    reloadTo('/');
  }, 'Anmeldung fehlgeschlagen');

  if (recoveryCodes) {
    return (
      <>
        <PageHeader title="Wiederherstellungscodes" subtitle="Jetzt sicher speichern. Sie werden nur einmal angezeigt." />
        <ListGroup>
          {recoveryCodes.map((c) => <ListRow key={c} title={<code>{c}</code>} />)}
        </ListGroup>
        <button type="button" className="btn btn-primary btn-block" onClick={() => reloadTo('/')}>Weiter</button>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Anmelden" />
      {setupOpen === null ? null : setupOpen ? (
        <>
          <ListGroup>
            <ListRow title={<label className="wrap-text" htmlFor="setup-token">Einrichtungs-Code</label>}
              accessory={<input id="setup-token" className="settings-input" type="password" autoComplete="off" value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)} />} />
          </ListGroup>
          <button type="button" className="btn btn-primary btn-block" disabled={busy || !setupToken.trim()} onClick={register}>Passkey anlegen</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={login}>Mit Passkey anmelden</button>
          <details>
            <summary>Wiederherstellungscode verwenden</summary>
            <ListGroup>
              <ListRow title={<label className="wrap-text" htmlFor="recovery-code">Wiederherstellungscode</label>}
                accessory={<input id="recovery-code" className="settings-input" type="text" autoComplete="off" autoCapitalize="characters"
                  value={code} onChange={(e) => setCode(e.target.value)} />} />
            </ListGroup>
            <button type="button" className="btn btn-secondary btn-block" disabled={busy || !code.trim()} onClick={recover}>Anmelden</button>
          </details>
        </>
      )}
      <p role="alert" className="settings-status">{error}</p>
    </>
  );
}

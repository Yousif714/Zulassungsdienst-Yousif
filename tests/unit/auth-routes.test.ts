import { describe, it, expect, vi, beforeEach } from 'vitest';

const jar = new Map<string, string>();
let keepCookies = false; // nur für den Parallel-Test: gemeinsamer Cookie-Speicher
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void (keepCookies || jar.delete(n)),
  }),
}));

const verifyReg = vi.fn();
vi.mock('@/server/auth/webauthn', async (orig) => {
  const m = await orig<typeof import('@/server/auth/webauthn')>();
  return { ...m, verifyRegistrationFor: (...a: unknown[]) => verifyReg(...a) };
});

import { getRepos, resetTestRepos } from '@/server/registry';
import { SESSION_COOKIE } from '@/server/auth/session';
import { CHALLENGE_COOKIE, signChallenge } from '@/server/auth/webauthn';
import { hashRecoveryCode } from '@/server/auth/recovery';
import { realNow } from '@/domain/clock';
import { GET as sessionGet } from '@/app/api/auth/session/route';
import { POST as regOptions } from '@/app/api/auth/register/options/route';
import { POST as regVerify } from '@/app/api/auth/register/verify/route';
import { POST as recover } from '@/app/api/auth/recover/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as newCodes } from '@/app/api/auth/recovery-codes/route';
import { POST as testReset } from '@/app/api/test/reset/route';

const SECRET = 's'.repeat(40);
const TOKEN = 'setup-token-123';
const post = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const passkey = { id: 'cred1', publicKey: 'pk', counter: 0, transports: [], createdAt: '2026-11-12T10:00:00.000Z' };

beforeEach(() => {
  jar.clear();
  keepCookies = false;
  verifyReg.mockReset();
  vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('OWNER_SETUP_TOKEN', TOKEN);
  vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
  vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
  resetTestRepos();
});

async function challengeCookie() {
  jar.set(CHALLENGE_COOKIE, await signChallenge(SECRET, { challenge: 'ch', purpose: 'register' }, realNow()));
}

describe('Auth-Routen', () => {
  it('session ohne Cookie: nicht angemeldet, Einrichtung offen', async () => {
    const r = await sessionGet();
    expect(await r.json()).toEqual({ authenticated: false, setupOpen: true });
  });

  it('register/options: ohne oder mit falschem Token 403', async () => {
    expect((await regOptions(post({}))).status).toBe(403);
    expect((await regOptions(post({ setupToken: 'falsch' }))).status).toBe(403);
  });

  it('register/options mit richtigem Token setzt Challenge-Cookie', async () => {
    const r = await regOptions(post({ setupToken: TOKEN }));
    expect(r.status).toBe(200);
    expect(jar.has(CHALLENGE_COOKIE)).toBe(true);
  });

  it('register/options: mit Passkey und ohne Sitzung 401', async () => {
    await getRepos().auth.addFirstPasskey(passkey);
    expect((await regOptions(post({ setupToken: TOKEN }))).status).toBe(401);
  });

  it('register/verify: Challenge-Cookie wird sofort gelöscht, auch bei Fehler', async () => {
    verifyReg.mockResolvedValue(null);
    await challengeCookie();
    const r = await regVerify(post({ setupToken: TOKEN, response: {} }));
    expect(r.status).toBe(400);
    expect(jar.has(CHALLENGE_COOKIE)).toBe(false);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it('register/verify: ohne Token 403', async () => {
    await challengeCookie();
    expect((await regVerify(post({ response: {} }))).status).toBe(403);
  });

  it('zwei parallele Erst-Registrierungen: genau eine 200, die andere 409', async () => {
    verifyReg.mockResolvedValue(passkey);
    await challengeCookie();
    keepCookies = true; // beide Anfragen sehen dieselbe Challenge
    const call = () => regVerify(post({ setupToken: TOKEN, response: {} }));
    const [a, b] = await Promise.all([call(), call()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const ok = a.status === 200 ? a : b;
    const bad = a.status === 200 ? b : a;
    const body = (await ok.json()) as { recoveryCodes: string[] };
    expect(body.recoveryCodes).toHaveLength(10);
    expect(await bad.json()).toEqual({ error: 'Bereits eingerichtet' });
    expect(await getRepos().auth.passkeyCount()).toBe(1);
  });

  it('recover: gültiger Code einmal 200 mit Sitzung, zweites Mal 401', async () => {
    await getRepos().auth.replaceRecoveryCodes([hashRecoveryCode('ABCDE-FGHJK', SECRET)]);
    const r1 = await recover(post({ code: 'abcde fghjk' }));
    expect(r1.status).toBe(200);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    jar.clear();
    const r2 = await recover(post({ code: 'ABCDE-FGHJK' }));
    expect(r2.status).toBe(401);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it('recover: gleicher Code parallel nur einmal', async () => {
    await getRepos().auth.replaceRecoveryCodes([hashRecoveryCode('ABCDE-FGHJK', SECRET)]);
    const [a, b] = await Promise.all([recover(post({ code: 'ABCDE-FGHJK' })), recover(post({ code: 'ABCDE-FGHJK' }))]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it('recovery-codes: ohne Sitzung 401; mit Sitzung neue Codes, alte ungültig', async () => {
    await getRepos().auth.replaceRecoveryCodes([hashRecoveryCode('ABCDE-FGHJK', SECRET)]);
    expect((await newCodes()).status).toBe(401);
    await recover(post({ code: 'ABCDE-FGHJK' }));
    const r = await newCodes();
    expect(r.status).toBe(200);
    const { recoveryCodes } = (await r.json()) as { recoveryCodes: string[] };
    expect(recoveryCodes).toHaveLength(10);
    expect((await recover(post({ code: 'ABCDE-FGHJK' }))).status).toBe(401);
    expect((await recover(post({ code: recoveryCodes[0] }))).status).toBe(200);
  });

  it('logout löscht die Sitzung; session meldet danach abgemeldet', async () => {
    await getRepos().auth.replaceRecoveryCodes([hashRecoveryCode('ABCDE-FGHJK', SECRET)]);
    await recover(post({ code: 'ABCDE-FGHJK' }));
    expect((await (await sessionGet()).json()).authenticated).toBe(true);
    await logout();
    expect((await (await sessionGet()).json()).authenticated).toBe(false);
  });

  it('test/reset: 404 außerhalb des Testmodus, sonst leert es', async () => {
    await getRepos().auth.addFirstPasskey(passkey);
    expect((await testReset()).status).toBe(200);
    expect(await getRepos().auth.passkeyCount()).toBe(0);
    vi.stubEnv('NEXUS_TEST_MEMORY_DB', '');
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    expect((await testReset()).status).toBe(404);
  });
});

import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken, sessionCookieOptions, SESSION_MAX_AGE_S } from '@/server/auth/session';
import { signChallenge, readChallenge } from '@/server/auth/webauthn';

const S = 'a'.repeat(40);
const t0 = new Date('2026-11-12T10:00:00Z');
const days = (n: number) => new Date(t0.getTime() + n * 86_400_000);

describe('Sitzung', () => {
  it('gültig direkt und nach 29 Tagen', async () => {
    const t = await createSessionToken(S, t0);
    expect(await verifySessionToken(t, S, t0)).toBe(true);
    expect(await verifySessionToken(t, S, days(29))).toBe(true);
  });
  it('ungültig nach 31 Tagen, anderes Secret, verändert, fehlend', async () => {
    const t = await createSessionToken(S, t0);
    expect(await verifySessionToken(t, S, days(31))).toBe(false);
    expect(await verifySessionToken(t, 'b'.repeat(40), t0)).toBe(false);
    expect(await verifySessionToken(t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA'), S, t0)).toBe(false);
    expect(await verifySessionToken(undefined, S, t0)).toBe(false);
    expect(await verifySessionToken('', S, t0)).toBe(false);
  });
  it('Cookie-Optionen', () => {
    expect(sessionCookieOptions('https://x.de')).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_S });
  });
});

describe('Challenge', () => {
  it('richtiger Zweck liefert Challenge', async () => {
    const t = await signChallenge(S, { challenge: 'abc', purpose: 'login' }, t0);
    expect(await readChallenge(t, S, 'login', t0)).toBe('abc');
  });
  it('falscher Zweck, abgelaufen, anderes Secret, fehlend → null', async () => {
    const t = await signChallenge(S, { challenge: 'abc', purpose: 'login' }, t0);
    expect(await readChallenge(t, S, 'register', t0)).toBeNull();
    expect(await readChallenge(t, S, 'login', new Date(t0.getTime() + 6 * 60_000))).toBeNull();
    expect(await readChallenge(t, 'b'.repeat(40), 'login', t0)).toBeNull();
    expect(await readChallenge(undefined, S, 'login', t0)).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, test } from 'vitest';

import { registerServiceWorkerScript } from '@/components/sw-register-script';

function runRegister(pathname: string): string[] {
  const calls: string[] = [];
  const sandbox = {
    navigator: { serviceWorker: { register: (u: string) => { calls.push(u); return Promise.resolve(); } } },
    location: { pathname },
    document: { readyState: 'complete' },
    window: { addEventListener: () => {} },
    console,
  };
  vm.runInNewContext(registerServiceWorkerScript, sandbox);
  return calls;
}

describe('Service-Worker-Registrierung', () => {
  test('registriert auf App-Seiten', () => {
    expect(runRegister('/')).toEqual(['/sw.js']);
    expect(runRegister('/zahlungen')).toEqual(['/sw.js']);
  });
  test.each(['/zahlung', '/zahlung/abc', '/zahlung/danke'])('registriert nicht auf %s', (p) => {
    expect(runRegister(p)).toEqual([]);
  });
});

describe('sw.js', () => {
  test('behandelt /zahlung/** nie (kein respondWith, kein Cache)', () => {
    let fetchHandler: (e: unknown) => void = () => {};
    const sandbox = {
      self: { addEventListener: (t: string, h: (e: unknown) => void) => { if (t === 'fetch') fetchHandler = h; }, location: { origin: 'https://x.example.de' } },
      caches: {},
      fetch: () => Promise.reject(new Error('kein Netz im Test')),
      URL, Response,
    };
    vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), sandbox);
    const ev = (path: string) => { const o = { responded: false, request: { method: 'GET', url: `https://x.example.de${path}`, mode: 'navigate' }, respondWith: () => { o.responded = true; } }; return o; };
    const z = ev('/zahlung/abc'); fetchHandler(z); expect(z.responded).toBe(false);
    const a = ev('/hinweise'); fetchHandler(a); expect(a.responded).toBe(true);
  });
});

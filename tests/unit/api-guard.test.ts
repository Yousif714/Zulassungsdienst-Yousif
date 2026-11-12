import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const API = path.resolve(process.cwd(), 'src/app/api');

function routes(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : [];
  });
}

// Eigene Prüfung bzw. bewusst offen.
const EXEMPT = [/^auth\/session$/, /^auth\/register\//, /^auth\/login\//, /^auth\/recover$/, /^auth\/logout$/, /^cron\/tick$/, /^test\/reset$/, /^test\/import$/];

describe('API-Schutz', () => {
  const files = routes(API);
  it('es gibt Routen', () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    const rel = path.relative(API, path.dirname(f)).split(path.sep).join('/');
    if (EXEMPT.some((r) => r.test(rel))) continue;
    it(`${rel} prüft die Sitzung`, () => {
      expect(readFileSync(f, 'utf8')).toContain('requireSession(');
    });
  }
  // Mit cacheComponents wird ein GET-Handler beim Build vorgerendert, bis er Laufzeitdaten anfasst. Liest er vorher die
  // Umgebung oder die Datenbank, scheitert `next build` ohne Env. Darum zuerst Cookies (requireSession) oder connection().
  it('GET-Routen werden dynamisch, bevor sie Umgebung oder Datenbank lesen', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const body = src.split(/export async function GET\([^)]*\)\s*\{/)[1];
      if (body === undefined) continue;
      const dyn = body.search(/await (connection|cookies|headers)\(\)|requireSession\(/);
      const env = body.search(/readEnv\(|getRepos\(|getActionProvider\(/);
      expect(dyn, path.relative(API, f)).toBeGreaterThanOrEqual(0);
      if (env >= 0) expect(dyn, path.relative(API, f)).toBeLessThan(env);
    }
  });
  it('keine Route setzt runtime', () => {
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/export const runtime/);
  });
});

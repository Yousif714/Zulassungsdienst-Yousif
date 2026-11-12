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
const EXEMPT = [/^auth\/session$/, /^auth\/register\//, /^auth\/login\//, /^auth\/recover$/, /^auth\/logout$/, /^cron\/tick$/, /^test\/reset$/];

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
  it('keine Route setzt runtime', () => {
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/export const runtime/);
  });
});

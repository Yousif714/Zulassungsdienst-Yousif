import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = /from ['"](@\/(ai|data|app|components|server)|\.\.\/(ai|data|app|components|server))/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('Architektur', () => {
  it('src/domain importiert nichts aus ai, data, app, components, server', () => {
    const bad = files('src/domain').filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});

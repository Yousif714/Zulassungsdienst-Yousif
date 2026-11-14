import { describe, expect, test } from 'vitest';
import { allowRequest, clientKey } from '@/server/rate-limit';
import { createMemoryRepos } from '@/server/db/memory';

const reqWithIp = (ip: string) => new Request('http://localhost/x', { headers: { 'x-forwarded-for': ip } });
const SECRET = 's'.repeat(32);

describe('allowRequest', () => {
  test('5 je Minute erlaubt, 6. nicht, nächste Minute wieder', async () => {
    const repo = createMemoryRepos().state;
    const t = new Date('2026-11-14T10:00:10Z');
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push(await allowRequest(repo, 'k', 5, t));
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(await allowRequest(repo, 'k', 5, new Date('2026-11-14T10:00:59Z'))).toBe(false);
    expect(await allowRequest(repo, 'k', 5, new Date('2026-11-14T10:01:00Z'))).toBe(true);
  });
  test('Schlüssel sind getrennt', async () => {
    const repo = createMemoryRepos().state;
    const t = new Date('2026-11-14T10:00:10Z');
    expect(await allowRequest(repo, 'a', 1, t)).toBe(true);
    expect(await allowRequest(repo, 'a', 1, t)).toBe(false);
    expect(await allowRequest(repo, 'b', 1, t)).toBe(true);
  });
  test('Schlüsselformat rl:<key>:<Minute UTC>:<i>', async () => {
    const repo = createMemoryRepos().state;
    await allowRequest(repo, 'abc', 2, new Date('2026-11-14T10:05:30Z'));
    expect(await repo.recentJobRuns(new Date('2026-11-14T00:00:00Z'))).toEqual(['rl:abc:2026-11-14T10:05:0']);
  });
});

describe('clientKey', () => {
  test('enthält die IP nicht, 16 Hex', () => {
    const k = clientKey(reqWithIp('203.0.113.7'), SECRET);
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(k).not.toContain('203');
  });
  test('nur die erste IP zählt, stabil, anderes Geheimnis anderer Schlüssel', () => {
    expect(clientKey(reqWithIp('203.0.113.7, 10.0.0.1'), SECRET)).toBe(clientKey(reqWithIp('203.0.113.7'), SECRET));
    expect(clientKey(reqWithIp('203.0.113.8'), SECRET)).not.toBe(clientKey(reqWithIp('203.0.113.7'), SECRET));
    expect(clientKey(reqWithIp('203.0.113.7'), 'x'.repeat(32))).not.toBe(clientKey(reqWithIp('203.0.113.7'), SECRET));
  });
  test('ohne Header: fester Schlüssel', () => {
    expect(clientKey(new Request('http://localhost/x'), SECRET)).toMatch(/^[0-9a-f]{16}$/);
  });
});

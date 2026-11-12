import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export function checkSetupToken(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  return timingSafeEqual(sha(given), sha(expected));
}

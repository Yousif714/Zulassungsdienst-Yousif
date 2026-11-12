import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford, 32 Zeichen
const GROUP = 5;
const COUNT = 10;

function randomGroup(): string {
  // 256 ist durch 32 teilbar: `& 31` ist ohne Modulo-Verzerrung gleichverteilt.
  const bytes = randomBytes(GROUP);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < COUNT) codes.add(`${randomGroup()}-${randomGroup()}`);
  return [...codes];
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, '');
}

export function hashRecoveryCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(normalizeRecoveryCode(code)).digest('hex');
}

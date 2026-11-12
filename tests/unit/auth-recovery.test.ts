import { describe, it, expect } from 'vitest';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from '@/server/auth/recovery';
import { createMemoryRepos } from '@/server/db/memory';

describe('Wiederherstellungscodes', () => {
  it('10 eindeutige Codes im Crockford-Format', () => {
    const c = generateRecoveryCodes();
    expect(c).toHaveLength(10);
    expect(new Set(c).size).toBe(10);
    for (const x of c) expect(x).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  });
  it('Normalisierung und Hash', () => {
    expect(normalizeRecoveryCode('abcde fghjk')).toBe('ABCDEFGHJK');
    expect(hashRecoveryCode('abcde fghjk', 's')).toBe(hashRecoveryCode('ABCDE-FGHJK', 's'));
    expect(hashRecoveryCode('ABCDE-FGHJK', 's')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode('ABCDE-FGHJK', 's')).not.toBe(hashRecoveryCode('ABCDE-FGHJK', 't'));
  });
  it('einmal einlösbar', async () => {
    const { auth } = createMemoryRepos();
    const [code] = generateRecoveryCodes();
    await auth.replaceRecoveryCodes([hashRecoveryCode(code, 's')]);
    const at = new Date();
    expect(await auth.consumeRecoveryCode(hashRecoveryCode(code.toLowerCase(), 's'), at)).toBe(true);
    expect(await auth.consumeRecoveryCode(hashRecoveryCode(code, 's'), at)).toBe(false);
  });
});

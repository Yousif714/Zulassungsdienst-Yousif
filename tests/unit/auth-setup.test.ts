import { describe, it, expect } from 'vitest';
import { checkSetupToken } from '@/server/auth/setup';

describe('checkSetupToken', () => {
  it('richtig → true', () => expect(checkSetupToken('geheim-token', 'geheim-token')).toBe(true));
  it('falsch, leer, undefined, Präfix → false', () => {
    expect(checkSetupToken('falsch', 'geheim-token')).toBe(false);
    expect(checkSetupToken('', 'geheim-token')).toBe(false);
    expect(checkSetupToken(undefined, 'geheim-token')).toBe(false);
    expect(checkSetupToken('geheim', 'geheim-token')).toBe(false);
    expect(checkSetupToken('', '')).toBe(false);
  });
});

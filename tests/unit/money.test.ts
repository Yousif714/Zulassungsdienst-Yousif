import { describe, expect, it } from 'vitest';
import { formatEuro } from '@/domain/money';

describe('formatEuro', () => {
  it('formatiert Cent im deutschen Format', () => {
    expect(formatEuro(115000)).toBe('1.150,00 €');
    expect(formatEuro(0)).toBe('0,00 €');
    expect(formatEuro(-2550)).toBe('-25,50 €');
  });
});

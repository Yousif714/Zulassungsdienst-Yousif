import { describe, expect, it } from 'vitest';
import { formatEuro, parseEuroInput } from '@/domain/money';

describe('formatEuro', () => {
  it('formatiert Cent im deutschen Format', () => {
    expect(formatEuro(115000)).toBe('1.150,00 €');
    expect(formatEuro(0)).toBe('0,00 €');
    expect(formatEuro(-2550)).toBe('-25,50 €');
  });
});

describe('parseEuroInput', () => {
  it('liest deutsche Eingaben als Cent', () => {
    expect(parseEuroInput('300')).toBe(30000);
    expect(parseEuroInput('300,00')).toBe(30000);
    expect(parseEuroInput(' 1.234,5 € ')).toBe(123450);
    expect(parseEuroInput('0,07')).toBe(7);
  });
  it('lehnt Ungültiges ab', () => {
    expect(parseEuroInput('')).toBeNull();
    expect(parseEuroInput('abc')).toBeNull();
    expect(parseEuroInput('1,234')).toBeNull();
    expect(parseEuroInput('0')).toBeNull();
  });
});

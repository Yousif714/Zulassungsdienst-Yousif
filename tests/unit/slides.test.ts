import { describe, expect, test } from 'vitest';
import { gammaText, slideHeading } from '@/domain/slides';

describe('Gamma-Format', () => {
  test('pro Folie Überschrift, Text und Trenner; kein doppeltes „Folie n:“', () => {
    const slides = [
      { position: 1, title: 'Folie 1: Selbstführung', body: 'Text eins' },
      { position: 2, title: 'Beispiel', body: 'Text zwei' },
    ];
    expect(gammaText(slides)).toBe('# Folie 1: Selbstführung\n\nText eins\n\n---\n\n# Folie 2: Beispiel\n\nText zwei\n\n---\n\n');
    expect(slideHeading(slides[0])).toBe('Selbstführung');
  });
});

import { describe, expect, test } from 'vitest';

import { encodeForm } from '@/server/connectors/form';

describe('encodeForm', () => {
  test('verschachtelt wie Stripe', () => {
    expect(decodeURIComponent(encodeForm({ phases: [{ items: [{ price_data: { unit_amount: 30000, recurring: { interval: 'month' } } }] }], x: null })))
      .toBe('phases[0][items][0][price_data][unit_amount]=30000&phases[0][items][0][price_data][recurring][interval]=month');
  });
  test('lässt undefined weg, kodiert Werte, behält false und 0', () => {
    expect(encodeForm({ a: undefined, b: 'x y&z', c: false, d: 0 })).toBe('b=x%20y%26z&c=false&d=0');
  });
});

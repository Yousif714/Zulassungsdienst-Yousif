import { expect, test } from 'vitest';

import { connectionSubtitle } from '@/components/connection-labels';
import { HOW_TO } from '@/domain/connections';
import type { Connection } from '@/domain/types';

const C: Connection = { id: 'stripe_nexus', company: 'nexus', label: 'Stripe NEXUS', status: 'connected', lastSuccessAt: null };
const at = new Date('2026-11-12T10:00:00Z');

test('verbunden', () => expect(connectionSubtitle({ ...C, status: 'connected', lastSuccessAt: '2026-11-12T09:57:00Z' }, at)).toBe('Verbunden · Stand vor 3 Min.'));
test('Störung im Klartext', () => expect(connectionSubtitle({ ...C, status: 'error', lastSuccessAt: '2026-11-12T09:10:00Z', lastError: 'Stripe: HTTP 401 bei /v1/subscriptions (Schlüssel prüfen)' }, at)).toBe('Störung: Stripe: HTTP 401 bei /v1/subscriptions (Schlüssel prüfen) · Stand vor 50 Min.'));
test('fehlt → Anleitung', () => expect(connectionSubtitle({ ...C, status: 'missing', lastSuccessAt: null }, at)).toBe(HOW_TO.stripe_nexus));
test('Störung ohne Stand', () => expect(connectionSubtitle({ ...C, status: 'error', lastSuccessAt: null }, at)).toBe('Störung · noch nie abgerufen'));

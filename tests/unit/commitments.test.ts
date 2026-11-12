import { describe, expect, it } from 'vitest';
import { detectCommitment } from '@/domain/commitments';

describe('detectCommitment (Domäne)', () => {
  it('erkennt Rechnungs- und Rückruf-Zusagen mit Frist', () => {
    expect(detectCommitment('Die Rechnung schicke ich Ihnen morgen.', '2026-11-10T10:00:00Z')).toEqual({ kind: 'invoice', dueAt: '2026-11-11T17:00:00.000Z' });
    expect(detectCommitment('Ich schicke die Rechnung heute.', '2026-11-10T10:00:00Z')?.dueAt).toBe('2026-11-10T17:00:00.000Z');
    expect(detectCommitment('Ich melde mich.', '2026-11-10T10:00:00Z')).toEqual({ kind: 'callback', dueAt: '2026-11-12T10:00:00.000Z' });
    expect(detectCommitment('Danke, bis dann', '2026-11-10T10:00:00Z')).toBeNull();
  });
});

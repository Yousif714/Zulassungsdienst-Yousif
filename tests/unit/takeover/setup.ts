// Server-Teil der Umstellungs-Testlage; die reinen Fixtures liegen in tests/fixtures/takeover-state.ts (auch für E2E).
import type { AppState } from '@/domain/types';
import type { Repos } from '@/server/db/repository';
import { diffState } from '@/server/db/tables';

export * from '../../fixtures/takeover-state';

/** Schreibt `next` als Stand in die (Memory-)Datenbank. */
export async function seed(repos: Repos, next: AppState): Promise<void> {
  const { state, revision } = await repos.state.load();
  const r = await repos.state.save(diffState(state, next), revision);
  if (!r.ok) throw new Error('seed fehlgeschlagen');
}

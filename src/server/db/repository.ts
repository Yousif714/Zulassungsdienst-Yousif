import 'server-only';
import type { AppState } from '@/domain/types';
import type { ChangeSet } from './tables';

export interface StateRepository {
  load(): Promise<{ state: AppState; revision: number }>;
  save(changes: ChangeSet, expectedRevision: number): Promise<{ ok: true; revision: number } | { ok: false; reason: 'conflict' }>;
  claimJobRun(key: string, at: Date): Promise<boolean>; // true nur für den ersten
}
export interface StoredPasskey { id: string; publicKey: string; counter: number; transports: string[]; createdAt: string }
export interface AuthRepository {
  passkeyCount(): Promise<number>;
  listPasskeys(): Promise<StoredPasskey[]>;
  addFirstPasskey(p: StoredPasskey): Promise<boolean>; // false, wenn schon einer existiert
  addPasskey(p: StoredPasskey): Promise<void>;
  updateCounter(id: string, counter: number): Promise<void>;
  replaceRecoveryCodes(hashes: string[]): Promise<void>;
  consumeRecoveryCode(hash: string, at: Date): Promise<boolean>; // true genau einmal
}
export interface Repos { state: StateRepository; auth: AuthRepository }

import { createHash } from 'node:crypto';
import type { StateRepository } from './db/repository';

/**
 * Ratenbegrenzung über `job_runs`-Claims (serverlos, ohne eigenen Speicher): je Minute (UTC) `limit` Plätze
 * `rl:<key>:<YYYY-MM-DDTHH:MM>:<i>`; wer keinen Platz mehr bekommt, wird abgewiesen.
 */
export async function allowRequest(repo: Pick<StateRepository, 'claimJobRun'>, key: string, limit: number, at: Date): Promise<boolean> {
  const minute = at.toISOString().slice(0, 16);
  for (let i = 0; i < limit; i++) if (await repo.claimJobRun(`rl:${key}:${minute}:${i}`, at)) return true;
  return false;
}

/** Gehasht (erste `x-forwarded-for`-IP + Geheimnis, 16 Hex): die IP selbst wird nie gespeichert. */
export function clientKey(req: Pick<Request, 'headers'>, secret: string): string {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unbekannt';
  return createHash('sha256').update(ip + secret).digest('hex').slice(0, 16);
}

/** Gehashter Schlüssel für beliebige Werte (z. B. Token), damit sie nie im Klartext in `job_runs` landen. */
export function hashKey(value: string, secret: string): string {
  return createHash('sha256').update(value + secret).digest('hex').slice(0, 16);
}

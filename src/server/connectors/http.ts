import 'server-only';

import { ConnectorError, RateLimited, type PullContext } from './types';

const MAX_RETRY_WAIT_MS = 10_000;
const MAX_RETRIES = 3;

/** Kurzer, bereinigter Grund aus einer 400-Antwort (Lexware `IssueList`/`message`, Stripe `error.message`). Nie der Schlüssel. */
async function reason(res: Response, secrets: string[]): Promise<string> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return '';
  }
  const b = (body ?? {}) as { IssueList?: { source?: string; i18nKey?: string }[]; message?: string; error?: { message?: string } };
  const raw = b.IssueList?.length
    ? b.IssueList.map((i) => [i.source, i.i18nKey].filter(Boolean).join(' ')).join('; ')
    : (b.message ?? b.error?.message ?? '');
  const clean = secrets.reduce((t, k) => t.split(k).join('***'), String(raw)).replace(/[^\p{L}\p{N} .,:;_\-/*]/gu, '').trim().slice(0, 160);
  return clean ? ` (${clean})` : '';
}

export function createApiClient(o: {
  label: string;
  baseUrl: string;
  key: string;
  fetch: typeof fetch;
  sleep: PullContext['sleep'];
  now: () => number;
  minIntervalMs: number;
  headers?: Record<string, string>;
  /** Vollständiger Authorization-Wert (z. B. Qonto `login:secret`); Standard `Bearer ${key}`. */
  authorization?: string;
}): { getJson(pathAndQuery: string): Promise<unknown>; postForm(path: string, body: string, idempotencyKey?: string): Promise<unknown> } {
  let lastAt: number | null = null;
  // Alles, was nie in einer Meldung landen darf: ganzer Wert und (bei `login:secret`) beide Teile.
  const secrets = [...new Set([o.key, o.authorization ?? '', ...o.key.split(':'), ...(o.authorization ?? '').split(':')])].filter((k) => k.length >= 3).sort((a, b) => b.length - a.length);

  async function send(pathAndQuery: string, post?: { body: string; idempotencyKey?: string }): Promise<Response> {
    if (lastAt !== null && o.minIntervalMs > 0) {
      const wait = o.minIntervalMs - (o.now() - lastAt);
      if (wait > 0) await o.sleep(wait);
    }
    lastAt = o.now();
    try {
      const headers = {
        accept: 'application/json', ...o.headers, authorization: o.authorization ?? `Bearer ${o.key}`,
        ...(post ? { 'content-type': 'application/x-www-form-urlencoded', ...(post.idempotencyKey ? { 'idempotency-key': post.idempotencyKey } : {}) } : {}),
      };
      return await o.fetch(`${o.baseUrl}${pathAndQuery}`, post ? { method: 'POST', headers, body: post.body } : { headers });
    } catch {
      throw new ConnectorError(`${o.label}: keine Verbindung`); // Originalfehler kann den Schlüssel enthalten
    }
  }

  async function request(pathAndQuery: string, post?: { body: string; idempotencyKey?: string }): Promise<unknown> {
      const path = pathAndQuery.split('?')[0];
      let res = await send(pathAndQuery, post);
      for (let attempt = 0; res.status === 429; attempt++) {
        if (attempt >= MAX_RETRIES) throw new RateLimited(`${o.label}: gedrosselt bei ${path}`);
        const h = res.headers.get('retry-after');
        const s = h ? Number(h) : NaN;
        await o.sleep(Number.isFinite(s) && s > 0 ? Math.min(s * 1000, MAX_RETRY_WAIT_MS) : 1000 * 2 ** attempt);
        res = await send(pathAndQuery, post); // gleicher Body und gleicher Idempotency-Key
      }
      if (!res.ok) {
        const hint = res.status === 401 || res.status === 403 ? ' (Schlüssel prüfen)' : res.status === 400 ? await reason(res, secrets) : '';
        throw new ConnectorError(`${o.label}: HTTP ${res.status} bei ${path}${hint}`);
      }
      try {
        return await res.json();
      } catch {
        throw new ConnectorError(`${o.label}: ungültige Antwort bei ${path}`);
      }
  }

  return {
    getJson: (pathAndQuery) => request(pathAndQuery),
    postForm: (path, body, idempotencyKey) => request(path, { body, idempotencyKey }),
  };
}

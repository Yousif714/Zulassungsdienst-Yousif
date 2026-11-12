import 'server-only';

import { ConnectorError, type PullContext } from './types';

const MAX_RETRY_WAIT_MS = 10_000;

export function createApiClient(o: {
  label: string;
  baseUrl: string;
  key: string;
  fetch: typeof fetch;
  sleep: PullContext['sleep'];
  now: () => number;
  minIntervalMs: number;
  headers?: Record<string, string>;
}): { getJson(pathAndQuery: string): Promise<unknown> } {
  let lastAt: number | null = null;

  async function send(pathAndQuery: string): Promise<Response> {
    if (lastAt !== null && o.minIntervalMs > 0) {
      const wait = o.minIntervalMs - (o.now() - lastAt);
      if (wait > 0) await o.sleep(wait);
    }
    lastAt = o.now();
    try {
      return await o.fetch(`${o.baseUrl}${pathAndQuery}`, { headers: { accept: 'application/json', ...o.headers, authorization: `Bearer ${o.key}` } });
    } catch {
      throw new ConnectorError(`${o.label}: keine Verbindung`); // Originalfehler kann den Schlüssel enthalten
    }
  }

  return {
    async getJson(pathAndQuery) {
      const path = pathAndQuery.split('?')[0];
      let res = await send(pathAndQuery);
      if (res.status === 429) {
        const s = Number(res.headers.get('retry-after'));
        await o.sleep(Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, MAX_RETRY_WAIT_MS) : 1000);
        res = await send(pathAndQuery);
      }
      if (!res.ok) throw new ConnectorError(`${o.label}: HTTP ${res.status} bei ${path}${res.status === 401 || res.status === 403 ? ' (Schlüssel prüfen)' : ''}`);
      try {
        return await res.json();
      } catch {
        throw new ConnectorError(`${o.label}: ungültige Antwort bei ${path}`);
      }
    },
  };
}

// Reine Test-Naht ohne Geheimnisse (bewusst ohne 'server-only': auch von Test-Routen nutzbar).

export interface FixtureRequest { method: string; path: string; body: string; idempotencyKey: string | null }

/** Treffer: `METHOD pfad+query`, `METHOD pfad`, dann Pfad+Query, dann Pfad, sonst 404. `calls` protokolliert Pfad+Query, `requests` Methode, Body und Idempotency-Key. */
export function fixtureFetch(
  routes: Record<string, unknown>,
  opts: { status?: Record<string, number>; calls?: string[]; requests?: FixtureRequest[] } = {},
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const full = `${url.pathname}${url.search}`;
    const method = (init?.method ?? 'GET').toUpperCase();
    opts.calls?.push(full);
    opts.requests?.push({ method, path: full, body: typeof init?.body === 'string' ? init.body : '', idempotencyKey: new Headers(init?.headers).get('idempotency-key') });
    const status = opts.status?.[`${method} ${full}`] ?? opts.status?.[`${method} ${url.pathname}`] ?? opts.status?.[full] ?? opts.status?.[url.pathname];
    if (status && status !== 200) return new Response('{}', { status });
    const candidates = [`${method} ${full}`, `${method} ${url.pathname}`, full, url.pathname];
    const key = candidates.find((c) => c in routes);
    if (key === undefined) return new Response('{}', { status: 404 });
    return Response.json(routes[key]);
  }) as typeof fetch;
}

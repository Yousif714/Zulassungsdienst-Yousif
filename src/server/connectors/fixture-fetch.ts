// Reine Test-Naht ohne Geheimnisse (bewusst ohne 'server-only': auch von Test-Routen nutzbar).

/** Treffer: Pfad+Query exakt, sonst Pfad, sonst 404. `calls` protokolliert Pfad+Query jeder Anfrage. */
export function fixtureFetch(routes: Record<string, unknown>, opts: { status?: Record<string, number>; calls?: string[] } = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const full = `${url.pathname}${url.search}`;
    opts.calls?.push(full);
    const status = opts.status?.[full] ?? opts.status?.[url.pathname];
    if (status && status !== 200) return new Response('{}', { status });
    const key = full in routes ? full : url.pathname in routes ? url.pathname : null;
    if (key === null) return new Response('{}', { status: 404 });
    return Response.json(routes[key]);
  }) as typeof fetch;
}

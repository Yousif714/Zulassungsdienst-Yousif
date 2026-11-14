export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [k: string]: FormValue };

/** Stripe-Formularkodierung: a[b][0][c]=…; null/undefined entfallen, Werte URL-kodiert. */
export function encodeForm(v: Record<string, FormValue>): string {
  const parts: string[] = [];
  const walk = (key: string, val: FormValue): void => {
    if (val === null || val === undefined) return;
    if (Array.isArray(val)) val.forEach((x, i) => walk(`${key}[${i}]`, x));
    else if (typeof val === 'object') for (const [k, x] of Object.entries(val)) walk(`${key}[${k}]`, x);
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
  };
  for (const [k, x] of Object.entries(v)) walk(k, x);
  return parts.join('&');
}

/** Kleine XML-Helfer ohne Abhängigkeiten (Regex, für flache Bankdateien wie CAMT.053 und XLSX). */

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

/** Entities in einem Durchlauf dekodieren (kein Doppeldekodieren). */
export function decodeXml(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|quot|apos|amp));/gi, (m, h?: string, d?: string, n?: string) =>
    h ? String.fromCodePoint(parseInt(h, 16)) : d ? String.fromCodePoint(Number(d)) : (ENTITIES[n!.toLowerCase()] ?? m),
  );
}

/** Namespace-Präfixe der Tags entfernen (`<ns:Ntry>` → `<Ntry>`). Attribute bleiben. */
export function stripNamespaces(xml: string): string {
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1');
}

/** Inhalt aller `<tag …>…</tag>` (gleichnamig verschachtelt wird nicht unterstützt). */
export function elements(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

/** Text des ersten Elements entlang des Pfads: Tags entfernt, Entities dekodiert, getrimmt. */
export function childText(xml: string, path: string[]): string | undefined {
  let cur: string | undefined = xml;
  for (const tag of path) {
    cur = elements(cur, tag)[0];
    if (cur === undefined) return undefined;
  }
  return decodeXml(cur.replace(/<[^>]*>/g, '')).trim();
}

/** Attributwert des ersten `<tag …>`. */
export function attrOf(xml: string, tag: string, name: string): string | undefined {
  const open = new RegExp(`<${tag}(\\s[^>]*)?/?>`).exec(xml);
  if (!open?.[1]) return undefined;
  const m = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`).exec(open[1]);
  return m ? decodeXml(m[1] ?? m[2]) : undefined;
}

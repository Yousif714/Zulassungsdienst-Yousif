import type { PortalMember } from '../types';

/**
 * Mitgliederliste aus dem Portal (kopierter Text, CSV oder bereits extrahierte
 * Tabellenzeilen aus einer XLSX-Datei) in Einträge mit E-Mail und Name wandeln.
 * Rein: kein I/O. Das Entpacken der XLSX-Datei liegt in `src/data/xlsx.ts`.
 */

/**
 * Ein Mitglied der Liste. Die Zusatzfelder sind nur gesetzt, wenn die Quelle sie
 * liefert (Tabellen mit passenden Spalten); Freitext enthält nur `email` und `name`.
 */
export interface PortalListEntry {
  /** Kleingeschrieben; bei mehreren E-Mails die erste (Hauptadresse, externalId). */
  email: string;
  /** `''`, wenn unbekannt. */
  name: string;
  /** Alle E-Mails des Mitglieds, `emails[0] === email`. Fehlt der Wert, gilt `[email]`. */
  emails?: string[];
  /** ISO-Datum `YYYY-MM-DD`: frühestes Datum aus „Beigetreten“. */
  joinedOn?: string | null;
  /** Originaltext aus „Beigetreten“ (z. B. `06.11.2026 / 01.08.2026`); nur wenn nicht leer. */
  joinedText?: string;
  /** ISO-Datum, wenn „Zuletzt aktiv“ genau ein Datum enthält, sonst `null`. */
  lastActiveOn?: string | null;
  /** Originaltext aus „Zuletzt aktiv“; nur wenn nicht leer. */
  lastActiveText?: string;
}

export interface PortalListPreview {
  entries: PortalListEntry[];
  duplicates: number;
  withoutEmail: string[];
}

const EMAIL_SOURCE = `[^\\s<>()\\[\\],;:"']+@[^\\s<>()\\[\\],;:"']+\\.[a-z]{2,}`;
const EMAIL_RE = new RegExp(EMAIL_SOURCE, 'gi');
const EMAIL_FULL_RE = new RegExp(`^${EMAIL_SOURCE}$`, 'i');

export function isPortalEmail(s: string): boolean {
  return EMAIL_FULL_RE.test(s);
}

/** Alle Adressen des Mitglieds (Hauptadresse zuerst). */
export function entryEmails(e: PortalListEntry): string[] {
  return e.emails ?? [e.email];
}

/** Trimmt, schreibt E-Mails klein, lässt ungültige weg, führt Duplikate zusammen (erster nicht leerer Name gewinnt). */
export function normalizePortalEntries(raw: PortalListEntry[]): PortalListEntry[] {
  const out: PortalListEntry[] = [];
  /** Jede bekannte Adresse → Eintrag, der sie führt. */
  const owner = new Map<string, PortalListEntry>();
  for (const r of raw) {
    const all: string[] = [];
    for (const e of entryEmails(r)) {
      const m = e.trim().toLowerCase();
      if (isPortalEmail(m) && !all.includes(m)) all.push(m);
    }
    if (all.length === 0) continue;
    // Teilen zwei Einträge irgendeine Adresse, sind sie dasselbe Mitglied (Union).
    const hits = new Set<PortalListEntry>();
    for (const e of all) {
      const h = owner.get(e);
      if (h) hits.add(h);
    }
    const name = r.name.trim();
    let target: PortalListEntry;
    if (hits.size === 0) {
      target = { email: all[0], name };
      copyExtras(target, r);
      out.push(target);
    } else {
      const ordered = out.filter((x) => hits.has(x));
      target = ordered[0];
      if (!target.name && name) target.name = name;
      copyExtras(target, r);
      for (const other of ordered.slice(1)) {
        if (!target.name && other.name) target.name = other.name;
        copyExtras(target, other);
        target.emails = [...new Set([...entryEmails(target), ...entryEmails(other)])];
        out.splice(out.indexOf(other), 1);
      }
    }
    const merged = [...new Set([...entryEmails(target), ...all])];
    if (merged.length > 1) target.emails = merged;
    for (const e of merged) owner.set(e, target);
  }
  return out;
}

/** Übernimmt Zusatzfelder, die am Ziel noch fehlen. */
function copyExtras(to: PortalListEntry, from: PortalListEntry): void {
  if (to.joinedOn === undefined && from.joinedOn !== undefined) to.joinedOn = from.joinedOn;
  if (to.joinedText === undefined && from.joinedText !== undefined) to.joinedText = from.joinedText;
  if (to.lastActiveOn === undefined && from.lastActiveOn !== undefined) to.lastActiveOn = from.lastActiveOn;
  if (to.lastActiveText === undefined && from.lastActiveText !== undefined) to.lastActiveText = from.lastActiveText;
}

/** Entfernt das BOM, dekodiert UTF-8 strikt und fällt sonst auf Windows-1252 zurück. */
export function decodeListFile(bytes: Uint8Array): string {
  let b = bytes;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

// ---------------------------------------------------------------------------
// Zusammenführen

const memberEmails = (m: PortalMember): string[] => m.emails ?? [m.email];

/**
 * Führt die (bereits normalisierte) Liste in die bekannten Mitglieder ein. Nichts wird gelöscht:
 * Fehlende behalten ihren Stand (`lastSeenInListAt`) und werden nur gezählt. Ein Eintrag gehört zu
 * einem bekannten Mitglied, wenn sie irgendeine Adresse teilen; die ID bleibt.
 */
export function mergePortalList(existing: PortalMember[], entries: PortalListEntry[], at: string, newId: () => string): { items: PortalMember[]; added: number; missing: number } {
  const items = [...existing];
  const touched = new Set<string>();
  let added = 0;
  for (const e of entries) {
    const mails = entryEmails(e);
    // Passt der Eintrag zu mehreren Mitgliedern, bleiben sie getrennt (IDs und Verträge hängen daran):
    // aktualisiert wird nur das Mitglied mit der Hauptadresse (sonst das erste); keine Adresse wandert.
    const hits = items.map((m, i) => (memberEmails(m).some((x) => mails.includes(x)) ? i : -1)).filter((i) => i >= 0);
    const idx = hits.find((i) => memberEmails(items[i]).includes(e.email)) ?? hits[0] ?? -1;
    const old = idx >= 0 ? items[idx] : undefined;
    for (const i of hits) touched.add(items[i].id);
    const foreign = new Set(hits.filter((i) => i !== idx).flatMap((i) => memberEmails(items[i])));
    const all = [...new Set([...(old ? memberEmails(old) : []), ...mails.filter((x) => !foreign.has(x))])];
    const next: PortalMember = {
      id: old?.id ?? newId(),
      connectionId: 'portal_nexus',
      externalId: old?.externalId ?? all[0],
      email: old?.email ?? all[0],
      name: e.name || old?.name || (old?.email ?? all[0]).split('@')[0],
      firstSeenAt: old?.firstSeenAt ?? at,
      lastSeenInListAt: at,
    };
    if (all.length > 1) next.emails = all;
    const joinedOn = e.joinedOn !== undefined ? e.joinedOn : old?.joinedOn;
    const joinedText = e.joinedText ?? old?.joinedText;
    const lastActiveOn = e.lastActiveOn !== undefined ? e.lastActiveOn : old?.lastActiveOn;
    const lastActiveText = e.lastActiveText ?? old?.lastActiveText;
    if (joinedOn !== undefined) next.joinedOn = joinedOn;
    if (joinedText !== undefined) next.joinedText = joinedText;
    if (lastActiveOn !== undefined) next.lastActiveOn = lastActiveOn;
    if (lastActiveText !== undefined) next.lastActiveText = lastActiveText;
    if (old) items[idx] = next;
    else {
      items.push(next);
      added++;
    }
    touched.add(next.id);
  }
  return { items, added, missing: items.filter((m) => !touched.has(m.id)).length };
}

// ---------------------------------------------------------------------------
// Einlesen

/** Erkennt Kopfzeile (CSV) bzw. Freitext und liefert die Vorschau. */
export function parsePortalList(text: string): PortalListPreview {
  const rows = splitCsv(text);
  if (hasHeader(rows)) return parseTable(rows);
  return parseFreeText(text);
}

/** Bereits extrahierte Tabellenzeilen (z. B. aus XLSX). Ohne erkennbare Kopfzeile wie Freitext. */
export function parsePortalRows(rows: string[][]): PortalListPreview {
  if (hasHeader(rows)) return parseTable(rows);
  return parseFreeText(rows.map((r) => r.join('\t')).join('\n'));
}

function parseFreeText(text: string): PortalListPreview {
  const lines = text.split(/\r?\n/);
  const raw: PortalListEntry[] = [];
  const withoutEmail: string[] = [];
  /** Index in `withoutEmail`, wenn die vorherige Zeile unverbrauchte Zeile ohne E-Mail ist. */
  let pending = -1;
  const edge = /^[\s<>\-|,;:\t]+|[\s<>\-|,;:\t]+$/g;
  for (const line of lines) {
    if (!line.trim()) {
      pending = -1;
      continue;
    }
    const matches = [...line.matchAll(EMAIL_RE)];
    if (matches.length === 0) {
      withoutEmail.push(line.trim().replace(/\s+/g, ' '));
      pending = withoutEmail.length - 1;
      continue;
    }
    let name = line.slice(0, matches[0].index).replace(edge, '');
    if (!name && pending >= 0) {
      name = withoutEmail[pending];
      withoutEmail.splice(pending, 1);
    }
    pending = -1;
    raw.push({ email: matches[0][0], name });
    for (const extra of matches.slice(1)) raw.push({ email: extra[0], name: '' });
  }
  const entries = normalizePortalEntries(raw);
  return { entries, duplicates: raw.length - entries.length, withoutEmail };
}

const EMAIL_HEADERS = ['email', 'e-mail', 'e-mail-adresse', 'e-mail-adresse(n)', 'e-mail-adressen'];
const NAME_HEADERS = ['name', 'vollständiger name', 'mitglied'];

function headerIndex(header: string[], names: string[]): number {
  return header.findIndex((h) => names.includes(h.trim().toLowerCase()));
}

function firstNonEmpty(rows: string[][]): number {
  return rows.findIndex((r) => r.some((c) => c.trim() !== ''));
}

function hasHeader(rows: string[][]): boolean {
  const i = firstNonEmpty(rows);
  return i >= 0 && headerIndex(rows[i], EMAIL_HEADERS) >= 0;
}

function parseTable(rows: string[][]): PortalListPreview {
  const start = firstNonEmpty(rows);
  const header = rows[start];
  const iMail = headerIndex(header, EMAIL_HEADERS);
  const iName = headerIndex(header, NAME_HEADERS);
  const iFirst = headerIndex(header, ['vorname']);
  const iLast = headerIndex(header, ['nachname']);
  const iJoined = headerIndex(header, ['beigetreten']);
  const iActive = headerIndex(header, ['zuletzt aktiv']);
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');

  const raw: PortalListEntry[] = [];
  const withoutEmail: string[] = [];
  for (const r of rows.slice(start + 1)) {
    if (!r.some((c) => c.trim() !== '')) continue;
    const emails = [...cell(r, iMail).matchAll(EMAIL_RE)].map((m) => m[0]);
    if (emails.length === 0) {
      withoutEmail.push(r.map((c) => c.trim()).filter(Boolean).join(' '));
      continue;
    }
    const name = iName >= 0 ? cell(r, iName) : [cell(r, iFirst), cell(r, iLast)].filter(Boolean).join(' ');
    const entry: PortalListEntry = { email: emails[0], name };
    if (emails.length > 1) entry.emails = emails;
    if (iJoined >= 0) {
      const text = cell(r, iJoined);
      entry.joinedOn = earliest(parseDates(text));
      if (text) entry.joinedText = text;
    }
    if (iActive >= 0) {
      const text = cell(r, iActive);
      const dates = parseDates(text);
      entry.lastActiveOn = dates.length === 1 ? dates[0] : null;
      if (text) entry.lastActiveText = text;
    }
    raw.push(entry);
  }
  const entries = normalizePortalEntries(raw);
  return { entries, duplicates: raw.length - entries.length, withoutEmail };
}

/** Alle gültigen `dd.mm.yyyy` im Text als ISO-Daten. */
function parseDates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) continue;
    out.push(`${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

function earliest(dates: string[]): string | null {
  return dates.length ? [...dates].sort()[0] : null;
}

/** CSV zerlegen: Trennzeichen = häufigstes aus `;` `,` Tab in der ersten nicht leeren Zeile; `"…"` mit `""`. */
export function splitCsv(text: string): string[][] {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const delim = [';', ',', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ';');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

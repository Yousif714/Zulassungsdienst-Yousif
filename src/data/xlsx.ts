/**
 * Minimaler XLSX-Leser ohne Abhängigkeiten (Browser und Node 18+): entpackt die ZIP-Datei
 * (Central Directory, gespeicherte und deflate-Einträge über DecompressionStream),
 * liest sharedStrings, Styles (für Datumszellen) und das erste Tabellenblatt.
 * Liefert Textzeilen für `parsePortalRows` aus `src/domain/import/portal-list.ts`.
 * Kein Zip64, keine Verschlüsselung.
 */

const td = new TextDecoder('utf-8');

/** XML lesen: BOM weg, Namespace-Präfixe der Tags (`<x:row>` → `<row>`) entfernen. Attribute bleiben. */
function xmlText(bytes: Uint8Array): string {
  return td.decode(bytes).replace(/^\uFEFF/, '').replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1');
}

/** Obergrenze für die entpackte Gesamtgröße (Schutz vor Zip-Bomben). */
export const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024;
const TOO_BIG = 'Die Datei ist entpackt zu groß (über 20 MB). Bitte nur die Mitgliederliste exportieren.';

/** Entpackt mit Budget: bricht beim Überschreiten ab, statt alles in den Speicher zu laden. */
async function inflateRaw(data: Uint8Array, budget: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > budget) {
      await reader.cancel().catch(() => undefined);
      throw new Error(TOO_BIG);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Alle Dateien des Archivs: Name → Rohbytes (entpackt). */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Keine gültige XLSX-Datei (ZIP-Verzeichnis fehlt).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Beschädigtes ZIP-Verzeichnis.');
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const dataStart = localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    if (method !== 0 && method !== 8) throw new Error(`Nicht unterstütztes ZIP-Verfahren ${method}.`);
    const data = method === 0 ? raw : await inflateRaw(raw, MAX_UNZIPPED_BYTES - total);
    total += data.length;
    if (total > MAX_UNZIPPED_BYTES) throw new Error(TOO_BIG);
    files.set(name, data);
  }
  return files;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

/** Entities in einem Durchlauf dekodieren (kein Doppeldekodieren). */
function decodeXml(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|quot|apos|amp));/gi, (m, h?: string, d?: string, n?: string) =>
    h ? String.fromCodePoint(parseInt(h, 16)) : d ? String.fromCodePoint(Number(d)) : (ENTITIES[n!.toLowerCase()] ?? m),
  );
}

/** Text aller `<t>`-Elemente (ohne Phonetik-Hinweise). */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += decodeXml(m[1] ?? '');
  return out;
}

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`));
  return m ? decodeXml(m[1] ?? m[2]) : undefined;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOf(m[1] ?? ''));
}

/** Pro Zellformat-Index (`s`): ist es ein Datumsformat? */
function dateStyles(xml: string | undefined): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const id = Number(attr(m[1], 'numFmtId'));
    custom.set(id, attr(m[1], 'formatCode') ?? '');
  }
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return [...cellXfs.matchAll(/<xf\b([^>]*?)\/?>/g)].map((m) => {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
    const code = custom.get(id);
    return code !== undefined && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
  });
}

/** Excel-Seriennummer → `dd.mm.yyyy` (1900-Datumssystem). */
export function excelSerialToDate(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function firstSheetPath(files: Map<string, Uint8Array>): string {
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const sheet = xmlText(wb).match(/<sheet\b[^>]*>/)?.[0];
    const rid = sheet ? attr(sheet, 'r:id') : undefined;
    if (rid) {
      for (const m of xmlText(rels).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
        if (attr(m[1], 'Id') !== rid) continue;
        const target = attr(m[1], 'Target');
        if (!target) break;
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
        if (files.has(path)) return path;
      }
    }
  }
  return 'xl/worksheets/sheet1.xml';
}

/** Zeilen des ersten Tabellenblatts als Text (Lücken = `''`, Datumszellen als `dd.mm.yyyy`). */
export async function readXlsxRows(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes);
  const sheetBytes = files.get(firstSheetPath(files));
  if (!sheetBytes) throw new Error('Kein Tabellenblatt in der XLSX-Datei gefunden.');
  const get = (name: string) => (files.has(name) ? xmlText(files.get(name)!) : undefined);
  const strings = sharedStrings(get('xl/sharedStrings.xml'));
  const dates = dateStyles(get('xl/styles.xml'));
  const sheet = xmlText(sheetBytes);
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = attr(cm[1], 't') ?? 'n';
      const body = cm[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = '';
      if (type === 'inlineStr') text = textOf(body);
      else if (type === 's') text = v !== undefined ? (strings[Number(v)] ?? '') : '';
      else if (type === 'str') text = v !== undefined ? decodeXml(v) : '';
      else if (type === 'b' || type === 'e') text = '';
      else if (v !== undefined) {
        const style = Number(attr(cm[1], 's') ?? -1);
        const num = Number(v);
        text = dates[style] && Number.isFinite(num) ? excelSerialToDate(num) : v.trim();
      }
      while (row.length < col) row.push('');
      row[col] = text.trim();
    }
    rows.push(row);
  }
  return rows;
}

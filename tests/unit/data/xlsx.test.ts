import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { excelSerialToDate, readXlsxRows } from '@/data/xlsx';
import { parsePortalRows } from '@/domain/import/portal-list';

/** Baut ein ZIP aus Name → Inhalt (deflate oder gespeichert; CRC wird vom Leser nicht geprüft). */
function zip(files: Record<string, string>, stored: string[] = []): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8');
    const method = stored.includes(name) ? 0 : 8;
    const data = method === 0 ? raw : deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, dir, end]));
}

describe('readXlsxRows', () => {
  test('synthetische Beispieldatei (deflate, Inline-Strings) → portalRows', async () => {
    const rows = await readXlsxRows(new Uint8Array(readFileSync('tests/fixtures/portal/mitglieder-beispiel.xlsx')));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual(['Mitglied', 'E-Mail-Adresse(n)', 'Beigetreten', 'Zuletzt aktiv']);
    expect(rows[1]).toEqual(['Ayşe Öztürk', 'ayse.oeztuerk@example.de', '04.08.2026', '12.11.2026']);
    expect(rows[3][2]).toBe('06.11.2026 / 01.08.2026');
    const r = parsePortalRows(rows);
    expect(r.entries.map((e) => [e.email, e.emails?.length ?? 1, e.joinedOn])).toEqual([
      ['ayse.oeztuerk@example.de', 1, '2026-08-04'],
      ['max@example.de', 2, '2026-08-10'],
      ['calvin.beispiel@example.de', 1, '2026-08-01'],
      ['lena@example.de', 1, '2026-09-15'],
    ]);
    expect(r.withoutEmail).toEqual(['Kein Mail Person 01.09.2026 02.09.2026']);
  });

  test('sharedStrings, gespeicherte Einträge, Datumsseriennummern, Lücken, Rels-Pfad', async () => {
    const bytes = zip(
      {
        'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="A" sheetId="1" r:id="rId9"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId9" Type="t" Target="worksheets/data.xml"/></Relationships>',
        'xl/sharedStrings.xml':
          '<sst><si><t>Mitglied</t></si><si><t>E-Mail</t></si><si><t>Beigetreten</t></si><si><r><t>Tom </t></r><r><t>&amp; Jerry</t></r></si><si><t>tj@x.de</t></si></sst>',
        'xl/styles.xml':
          '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>',
        'xl/worksheets/data.xml':
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>12345</v></c><c r="D2" s="1"><v>46000</v></c><c r="E2" s="2"><v>46001.5</v></c></row></sheetData></worksheet>',
      },
      ['xl/sharedStrings.xml', 'xl/worksheets/data.xml'],
    );
    expect(await readXlsxRows(bytes)).toEqual([
      ['Mitglied', 'E-Mail', '', 'Beigetreten'],
      ['Tom & Jerry', 'tj@x.de', '12345', '09.12.2025', '10.12.2025'],
    ]);
  });

  test('Portal-Export: x:-Präfix, t="str", absolute Targets, BOM in Rels, &amp;', async () => {
    const rows = await readXlsxRows(new Uint8Array(readFileSync('tests/fixtures/portal/mitglieder-portal-export.xlsx')));
    expect(rows).toEqual([
      ['Mitglied', 'E-Mail-Adresse(n)', 'Beigetreten', 'Zuletzt aktiv'],
      ['Ayşe Öztürk', 'ayse.oeztuerk@example.de', '04.08.2026', '12.11.2026'],
      ['Max Mustermann', 'max@example.de; m.mustermann@firma-example.de', '10.08.2026', '01.11.2026'],
      ['Calvin Beispiel', 'Calvin.Beispiel@Example.DE', '06.11.2026 / 01.08.2026', 'nie'],
      ['Dr. Lena Muster & Co', 'lena@example.de', '15.09.2026', '13.11.2026'],
    ]);
    const r = parsePortalRows(rows);
    expect(r.entries).toHaveLength(4);
    expect(r.entries[1].emails).toEqual(['max@example.de', 'm.mustermann@firma-example.de']);
    expect(r.entries[2]).toMatchObject({ joinedOn: '2026-08-01', lastActiveOn: null, lastActiveText: 'nie' });
    expect(r.entries[3].name).toBe('Dr. Lena Muster & Co');
  });

  test('Einzelquote-Attribute, selbstschließende Zellen, Entities ohne Doppeldekodierung', async () => {
    const bytes = zip({
      'xl/worksheets/sheet1.xml':
        "<worksheet><sheetData><row r='1'><c r='B1' t='inlineStr'><is><t>&#38;lt; &lt;b&gt;</t></is></c><c r='C1'/><c r='D1' t='str'><v>x</v></c></row></sheetData></worksheet>",
    });
    expect(await readXlsxRows(bytes)).toEqual([['', '&lt; <b>', '', 'x']]);
  });

  test('kein ZIP → Fehler', async () => {
    await expect(readXlsxRows(new Uint8Array([1, 2, 3]))).rejects.toThrow(/XLSX/);
  });

  test('excelSerialToDate', () => {
    expect(excelSerialToDate(45292)).toBe('01.01.2024');
  });
});

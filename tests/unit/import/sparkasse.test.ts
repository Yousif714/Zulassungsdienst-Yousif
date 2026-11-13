import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodeListFile } from '@/domain/import/portal-list';
import { unzip } from '@/data/xlsx';
import { fnv1a64, parseCamt053, parseDeAmountCents, parseDeDate, parseDotAmountCents, parseSparkasse, parseSparkasseCsv, statementKey } from '@/domain/import/sparkasse';
import { childText, stripNamespaces } from '@/domain/import/xml';
import { zip } from '../zip';

const csv = readFileSync('tests/fixtures/sparkasse/umsaetze-beispiel.csv', 'utf8');
const header = csv.split('\n')[0] + '\n';
const line = (d: string, text: string, ref: string, name: string, amount: string, o: { cur?: string; info?: string } = {}) =>
  `"DE00360501050000009999";"${d}";"${d}";"${text}";"${ref}";"";"";"";"";"";"";"${name}";"DE00100000000000000001";"XXXXDEXXXXX";"${amount}";"${o.cur ?? 'EUR'}";"${o.info ?? 'Umsatz gebucht'}"\n`;
const row = line('03.11.26', 'GUTSCHR. UEBERWEISUNG', 'RE-Z-2026-290', 'Max Mustermann', '10,00');
const otherDayRow = line('04.11.26', 'GUTSCHR. UEBERWEISUNG', 'RE-Z-2026-291', 'Max Mustermann', '20,00');

test('FNV-1a 64 Testvektoren', () => {
  expect(fnv1a64('')).toBe('cbf29ce484222325');
  expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
});
test.each([['1.234,56', 123456], ['-12,00', -1200], ['0,5', 50], ['99', 9900], ['1,234', null], ['abc', null]])('Betrag %s → %s', (s, c) =>
  expect(parseDeAmountCents(s)).toBe(c));
test.each([['03.11.26', '2026-11-03'], ['03.11.2026', '2026-11-03'], ['31.02.26', null]])('Datum %s → %s', (s, d) =>
  expect(parseDeDate(s)).toBe(d));

test('Beispieldatei: 4 Eingänge, 1 Ausgabe übersprungen, Zeitraum, Konto', () => {
  const r = parseSparkasseCsv(csv)!;
  expect(r.format).toBe('csv');
  expect(r.payments.map((p) => p.amountCents)).toEqual([64000, 9900, 8900, 5000]);
  expect(r.payments[0]).toMatchObject({ company: 'zulassung', source: 'bank', connectionId: 'bank_sparkasse', kind: 'incoming', bookedOn: '2026-11-03',
    payerName: 'Autohaus Mueller GmbH', iban: 'DE00100000000000000001', reference: 'RE-Z-2026-290 RE-Z-2026-295' });
  expect(r.payments[0].externalId).toMatch(/^spk-[0-9a-f]{16}$/);
  expect(r.skipped).toEqual([{ reason: 'expense', count: 1 }]);
  expect([r.from, r.to, r.account]).toEqual(['2026-11-03', '2026-11-11', 'DE00360501050000009999']);
});

test('Rückbuchung (Buchungstext RETOURE) wird negativ übernommen', () => {
  const r = parseSparkasseCsv(header + line('05.11.26', 'RETOURE', 'RE-Z-2026-290', 'Autohaus Mueller GmbH', '-640,00'))!;
  expect(r.payments).toHaveLength(1);
  expect(r.payments[0]).toMatchObject({ amountCents: -64000, kind: 'incoming' });
  expect(r.skipped).toEqual([]);
});

test('vorgemerkt, Fremdwährung, vor Importbeginn werden gezählt, nicht übernommen', () => {
  const r = parseSparkasseCsv(header
    + line('05.11.26', 'GUTSCHR.', 'a', 'Max Mustermann', '5,00', { info: 'Umsatz vorgemerkt' })
    + line('05.11.26', 'GUTSCHR.', 'b', 'Max Mustermann', '5,00', { cur: 'USD' })
    + line('05.05.26', 'GUTSCHR.', 'c', 'Max Mustermann', '5,00')
    + line('xx', 'GUTSCHR.', 'd', 'Max Mustermann', '5,00'))!;
  expect(r.payments).toEqual([]);
  expect(r.skipped).toEqual([{ reason: 'pending', count: 1 }, { reason: 'currency', count: 1 }, { reason: 'before_since', count: 1 }, { reason: 'unreadable', count: 1 }]);
  expect([r.from, r.to]).toEqual(['2026-05-05', '2026-11-05']);
});

test('Windows-1252: Umlaute im Namen bleiben erhalten', () => {
  const enc = new TextEncoder();
  const body = line('03.11.26', 'GUTSCHR.', 'x', 'Autohaus Müller', '5,00');
  const bytes = new Uint8Array([...enc.encode(header), ...[...body].map((c) => c.charCodeAt(0))]);
  expect(parseSparkasseCsv(decodeListFile(bytes))!.payments[0].payerName).toBe('Autohaus Müller');
});

test('gleiche Zeilen → laufende Nummer 0 und 1, verschiedene Schlüssel, stabil', () => {
  const a = parseSparkasseCsv(header + row + row)!.payments;
  const b = parseSparkasseCsv(header + row + row + otherDayRow)!.payments;
  expect(new Set(a.map((p) => p.externalId)).size).toBe(2);
  expect(b.slice(0, 2).map((p) => p.externalId)).toEqual(a.map((p) => p.externalId));
});

test('Zweck mit anderem Leerraum/Großschreibung → gleicher Schlüssel', () =>
  expect(statementKey({ bookedOn: '2026-11-03', amountCents: 100, iban: 'de00 1000', reference: 'RE-Z 1' }, 0))
    .toBe(statementKey({ bookedOn: '2026-11-03', amountCents: 100, iban: 'DE001000', reference: 're-z1' }, 0)));

test('unbekannte Kopfzeile → null', () => expect(parseSparkasseCsv('Datum;Betrag\n01.11.26;5,00')).toBeNull());

// ---------------------------------------------------------------------------
// CAMT.053

const xml = readFileSync('tests/fixtures/sparkasse/auszug-beispiel.xml', 'utf8');
const NS = 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.08';
const doc = (entries: string, iban = 'DE00360501050000009999') =>
  `<Document xmlns="${NS}"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>${iban}</IBAN></Id></Acct>${entries}</Stmt></BkToCstmrStmt></Document>`;
const ntry = (o: { amt?: string; ind?: 'CRDT' | 'DBIT'; sts?: string; ccy?: string; date?: string; extra?: string; tx?: string; party?: string; ref?: string } = {}) => {
  const amt = o.amt ?? '10.00', ind = o.ind ?? 'CRDT', ccy = o.ccy ?? 'EUR';
  const tx = o.tx ?? `<TxDtls><RltdPties><Dbtr><Nm>Max Mustermann</Nm></Dbtr><DbtrAcct><Id><IBAN>DE00100000000000000001</IBAN></Id></DbtrAcct></RltdPties><RmtInf><Ustrd>${o.ref ?? 'RE-Z-2026-290'}</Ustrd></RmtInf></TxDtls>`;
  return `<Ntry><Amt Ccy="${ccy}">${amt}</Amt><CdtDbtInd>${ind}</CdtDbtInd>${o.extra ?? ''}<Sts>${o.sts ?? 'BOOK'}</Sts><BookgDt><Dt>${o.date ?? '2026-11-03'}</Dt></BookgDt><NtryDtls>${tx}</NtryDtls></Ntry>`;
};

test('Betrag mit Punkt → Cent', () => {
  expect(parseDotAmountCents('640.00')).toBe(64000);
  expect(parseDotAmountCents('0.5')).toBe(50);
  expect(parseDotAmountCents('1,5')).toBeNull();
  expect(parseDotAmountCents('abc')).toBeNull();
});
test('CSV und CAMT derselben Buchungen → gleiche externalIds', () =>
  expect(parseCamt053(xml)!.payments.map((p) => p.externalId)).toEqual(parseSparkasseCsv(csv)!.payments.map((p) => p.externalId)));
test('CAMT: Beträge, Ausgabe übersprungen, Konto, Zeitraum, Gegenpartei', () => {
  const r = parseCamt053(xml)!;
  expect(r.format).toBe('camt');
  expect(r.payments.map((p) => p.amountCents)).toEqual([64000, 9900, 8900, 5000]);
  expect(r.payments[0]).toMatchObject({ company: 'zulassung', source: 'bank', connectionId: 'bank_sparkasse', kind: 'incoming', bookedOn: '2026-11-03',
    payerName: 'Autohaus Mueller GmbH', iban: 'DE00100000000000000001', reference: 'RE-Z-2026-290 RE-Z-2026-295' });
  expect(r.payments[1].payerName).toBe('Autohaus Krause');
  expect(r.skipped).toEqual([{ reason: 'expense', count: 1 }]);
  expect(r.account).toBe('DE00360501050000009999');
  expect([r.from, r.to]).toEqual(['2026-11-03', '2026-11-11']);
});
test('Sammelbuchung: ein Ntry mit zwei TxDtls → zwei Zahlungen mit TxDtls-Beträgen', () => {
  const tx = (amt: string, ref: string) => `<TxDtls><Amt Ccy="EUR">${amt}</Amt><RltdPties><Dbtr><Nm>Max Mustermann</Nm></Dbtr></RltdPties><RmtInf><Ustrd>${ref}</Ustrd></RmtInf></TxDtls>`;
  const r = parseCamt053(doc(ntry({ amt: '150.00', tx: tx('100.00', 'RE-1') + tx('50.00', 'RE-2') })))!;
  expect(r.payments.map((p) => p.amountCents)).toEqual([10000, 5000]);
  expect(r.payments.map((p) => p.reference)).toEqual(['RE-1', 'RE-2']);
  expect(new Set(r.payments.map((p) => p.externalId)).size).toBe(2);
});
test('Sammelbuchung ohne TxDtls-Beträge → unreadable', () => {
  const tx = '<TxDtls><RmtInf><Ustrd>A</Ustrd></RmtInf></TxDtls><TxDtls><RmtInf><Ustrd>B</Ustrd></RmtInf></TxDtls>';
  const r = parseCamt053(doc(ntry({ amt: '150.00', tx })))!;
  expect(r.payments).toEqual([]);
  expect(r.skipped).toEqual([{ reason: 'unreadable', count: 2 }]);
});
const dbitTx = '<TxDtls><RltdPties><Cdtr><Pty><Nm>Autohaus Mueller GmbH</Nm></Pty></Cdtr><CdtrAcct><Id><IBAN>DE00100000000000000001</IBAN></Id></CdtrAcct></RltdPties><RmtInf><Ustrd>RE-Z-2026-290</Ustrd></RmtInf></TxDtls>';
test('RvslInd=true auf DBIT → Rückbuchung negativ, Gegenpartei = Cdtr', () => {
  const r = parseCamt053(doc(ntry({ amt: '640.00', ind: 'DBIT', extra: '<RvslInd>true</RvslInd>', tx: dbitTx })))!;
  expect(r.payments).toHaveLength(1);
  expect(r.payments[0]).toMatchObject({ amountCents: -64000, kind: 'incoming', iban: 'DE00100000000000000001', payerName: 'Autohaus Mueller GmbH' });
  expect(r.skipped).toEqual([]);
});
test('Rückgabe-Bankcode (SubFmlyCd RRTN) auf DBIT → Rückbuchung; Prtry-Code mit + ebenso', () => {
  const code = (c: string) => `<BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>${c}</SubFmlyCd></Fmly></Domn></BkTxCd>`;
  const a = parseCamt053(doc(ntry({ amt: '10.00', ind: 'DBIT', extra: code('RRTN'), tx: dbitTx })))!;
  expect(a.payments.map((p) => p.amountCents)).toEqual([-1000]);
  const b = parseCamt053(doc(ntry({ amt: '10.00', ind: 'DBIT', extra: '<BkTxCd><Prtry><Cd>NSTO+109+0000</Cd></Prtry></BkTxCd>', tx: dbitTx })))!;
  expect(b.payments.map((p) => p.amountCents)).toEqual([-1000]);
  const c = parseCamt053(doc(ntry({ amt: '10.00', ind: 'DBIT', extra: code('ESCT'), tx: dbitTx })))!;
  expect(c.payments).toEqual([]);
  expect(c.skipped).toEqual([{ reason: 'expense', count: 1 }]);
});
test('Sts PDNG → pending gezählt', () => {
  const r = parseCamt053(doc(ntry({ sts: 'PDNG' })))!;
  expect(r.payments).toEqual([]);
  expect(r.skipped).toEqual([{ reason: 'pending', count: 1 }]);
});
test('Sts mit Cd-Kindelement (camt.053.001.08) wird gelesen', () => {
  const r = parseCamt053(doc(ntry({ sts: '<Cd>BOOK</Cd>' })))!;
  expect(r.payments).toHaveLength(1);
});
test('CAMT: Fremdwährung, vor Importbeginn, ValDt als Ersatz', () => {
  const r = parseCamt053(doc(ntry({ ccy: 'USD' }) + ntry({ date: '2026-05-31' })))!;
  expect(r.payments).toEqual([]);
  expect(r.skipped).toEqual([{ reason: 'currency', count: 1 }, { reason: 'before_since', count: 1 }]);
  const v = parseCamt053(doc(ntry().replace('<BookgDt><Dt>2026-11-03</Dt></BookgDt>', '<ValDt><Dt>2026-11-04</Dt></ValDt>')))!;
  expect(v.payments[0].bookedOn).toBe('2026-11-04');
  const t = parseCamt053(doc(ntry().replace('<Dt>2026-11-03</Dt>', '<DtTm>2026-11-03T12:30:00+01:00</DtTm>')))!;
  expect(t.payments[0].bookedOn).toBe('2026-11-03');
});
test('CAMT: gleiche Buchung zweimal → laufende Nummer, verschiedene Schlüssel', () => {
  const r = parseCamt053(doc(ntry() + ntry()))!;
  expect(new Set(r.payments.map((p) => p.externalId)).size).toBe(2);
});
test('Betrag 0 wird in CAMT übersprungen und gezählt', () => {
  const r = parseCamt053(doc(ntry({ amt: '0.00' }) + ntry()))!;
  expect(r.payments).toHaveLength(1);
  expect(r.skipped).toEqual([{ reason: 'zero', count: 1 }]);
});
test('Betrag 0,00 / -0,00 wird in CSV übersprungen und gezählt (kein -0)', () => {
  const r = parseSparkasseCsv(header + line('03.11.26', 'GUTSCHR. UEBERWEISUNG', 'A', 'Max Mustermann', '0,00') + line('03.11.26', 'RETOURE', 'B', 'Max Mustermann', '-0,00') + row)!;
  expect(r.payments.map((p) => p.amountCents)).toEqual([1000]);
  expect(r.skipped).toEqual([{ reason: 'zero', count: 2 }]);
  expect(Object.is(parseDeAmountCents('-0,00'), -0)).toBe(false);
});
test('keine CAMT-Datei → null', () => {
  expect(parseCamt053('<html><body/></html>')).toBeNull();
  expect(parseCamt053('<Document><Other/></Document>')).toBeNull();
});

const otherDayXml = doc(ntry({ date: '2026-11-12', amt: '20.00', ref: 'RE-Z-2026-291' }));
test('ZIP mit zwei XMLs → zusammengeführt', async () => {
  const files = [...(await unzip(zip({ 'a.xml': xml, 'b.xml': otherDayXml })))].map(([name, bytes]) => ({ name, bytes }));
  const r = parseSparkasse(files);
  expect(r.ok && r.payments.length).toBe(5);
  if (r.ok) {
    expect([r.from, r.to, r.account, r.format]).toEqual(['2026-11-03', '2026-11-12', 'DE00360501050000009999', 'camt']);
    expect(r.skipped).toEqual([{ reason: 'expense', count: 1 }]);
  }
});
test('parseSparkasse: CSV-Bytes (auch Windows-1252) und XML-Bytes', () => {
  const enc = new TextEncoder();
  const c = parseSparkasse([{ name: 'u.csv', bytes: enc.encode(csv) }]);
  expect(c.ok && c.format).toBe('csv');
  const x = parseSparkasse([{ name: 'a.xml', bytes: enc.encode('\uFEFF\n  ' + xml) }]);
  expect(x.ok && x.format).toBe('camt');
});
test('falsche Datei → verständlicher Fehler', () => {
  expect(parseSparkasse([{ name: 'x.pdf', bytes: new TextEncoder().encode('%PDF-1.4') }])).toEqual({ ok: false, error: 'Das ist kein Sparkassen-Auszug (CAMT oder CSV).' });
  expect(parseSparkasse([])).toEqual({ ok: false, error: 'Das ist kein Sparkassen-Auszug (CAMT oder CSV).' });
  expect(parseSparkasse([{ name: 'a.xml', bytes: new TextEncoder().encode(xml) }, { name: 'x.pdf', bytes: new TextEncoder().encode('%PDF') }]).ok).toBe(false);
});
test('xml-Helfer: Namespaces, Entities', () => {
  expect(childText(stripNamespaces('<a:X><a:Y>A &amp; B</a:Y></a:X>'), ['X', 'Y'])).toBe('A & B');
});

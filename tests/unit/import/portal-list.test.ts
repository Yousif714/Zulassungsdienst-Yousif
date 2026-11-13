import { describe, expect, test } from 'vitest';
import {
  decodeListFile,
  entryEmails,
  isPortalEmail,
  normalizePortalEntries,
  parsePortalList,
  parsePortalRows,
} from '@/domain/import/portal-list';
import { portalListCsv, portalListText } from '../../fixtures';

describe('parsePortalList', () => {
  test('kopierte Admin-Seite: Name in der Zeile, davor oder leer; Duplikat zusammengeführt; Füllzeilen gelistet', () => {
    expect(parsePortalList(portalListText)).toEqual({
      entries: [
        { email: 'ayse@example.de', name: 'Ayşe Öztürk' },
        { email: 'murat@example.de', name: 'Murat Demir' },
        { email: 'nina@example.de', name: 'Nina Hahn' },
        { email: 'neu@example.de', name: 'Paula Neu' },
        { email: 'team@nexusnetzwerk.de', name: '' },
      ],
      duplicates: 1,
      withoutEmail: ['Mitglieder', 'Name E-Mail Beigetreten', 'Bearbeiten'],
    });
  });
  test('CSV mit ; und Anführungszeichen', () => {
    expect(parsePortalList(portalListCsv)).toEqual({
      entries: [
        { email: 'ayse@example.de', name: 'Öztürk, Ayşe' },
        { email: 'lena.neu@example.de', name: 'Lena Neu' },
        { email: 'ohne-name@example.de', name: '' },
      ],
      duplicates: 0,
      withoutEmail: ['Kein Mail'],
    });
  });
  test('CSV mit , und Vorname/Nachname', () => {
    expect(parsePortalList('Vorname,Nachname,email\nAnna,Beispiel,ANNA@x.de\n').entries).toEqual([
      { email: 'anna@x.de', name: 'Anna Beispiel' },
    ]);
  });
  test('CSV: Kopfzeilen ohne Beachtung der Schreibweise, Mitglied/E-Mail-Adresse(n), Windows-Zeilenenden', () => {
    const csv = 'MITGLIED;E-Mail-Adresse(n);Beigetreten\r\nAnna;"a@x.de; b@x.de";03.02.2026\r\n';
    expect(parsePortalList(csv).entries).toEqual([
      { email: 'a@x.de', name: 'Anna', emails: ['a@x.de', 'b@x.de'], joinedOn: '2026-02-03', joinedText: '03.02.2026' },
    ]);
  });
  test('leerer Text → nichts erkannt', () => {
    expect(parsePortalList('  \n')).toEqual({ entries: [], duplicates: 0, withoutEmail: [] });
  });
});

describe('parsePortalRows (XLSX-Zeilen)', () => {
  const header = ['Mitglied', 'E-Mail-Adresse(n)', 'Beigetreten', 'Zuletzt aktiv'];
  test('mehrere E-Mails, Wiedereintritt, Freitext, Zeile ohne E-Mail', () => {
    const r = parsePortalRows([
      header,
      ['Ayşe Öztürk', 'ayse@example.de', '04.08.2026', '12.11.2026'],
      ['Max Mustermann', 'max@example.de; m.mustermann@firma-example.de', '10.08.2026', '01.11.2026'],
      ['Calvin Beispiel', 'Calvin.Beispiel@Example.DE', '06.11.2026 / 01.08.2026', 'nie'],
      ['Kein Mail Person', '', '01.09.2026', '02.09.2026'],
      ['', '', '', ''],
    ]);
    expect(r.duplicates).toBe(0);
    expect(r.withoutEmail).toEqual(['Kein Mail Person 01.09.2026 02.09.2026']);
    expect(r.entries).toEqual([
      { email: 'ayse@example.de', name: 'Ayşe Öztürk', joinedOn: '2026-08-04', joinedText: '04.08.2026', lastActiveOn: '2026-11-12', lastActiveText: '12.11.2026' },
      {
        email: 'max@example.de', name: 'Max Mustermann', emails: ['max@example.de', 'm.mustermann@firma-example.de'],
        joinedOn: '2026-08-10', joinedText: '10.08.2026', lastActiveOn: '2026-11-01', lastActiveText: '01.11.2026',
      },
      { email: 'calvin.beispiel@example.de', name: 'Calvin Beispiel', joinedOn: '2026-08-01', joinedText: '06.11.2026 / 01.08.2026', lastActiveOn: null, lastActiveText: 'nie' },
    ]);
  });
  test('Zeilen ohne Kopfzeile werden wie Freitext gelesen', () => {
    expect(parsePortalRows([['Nina Hahn', 'nina@example.de']]).entries).toEqual([{ email: 'nina@example.de', name: 'Nina Hahn' }]);
  });
  test('doppelte Zeilen: erste gewinnt, Zähler und Adressen zusammengeführt', () => {
    const r = parsePortalRows([header, ['', 'a@x.de', '', ''], ['Anna', 'A@x.de; b@x.de', '', '']]);
    expect(r.duplicates).toBe(1);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ email: 'a@x.de', name: 'Anna', emails: ['a@x.de', 'b@x.de'] });
  });
});

describe('Hilfsfunktionen', () => {
  test('normalizePortalEntries: ungültige raus, klein, Duplikate', () => {
    expect(
      normalizePortalEntries([
        { email: ' A@B.de ', name: '' },
        { email: 'a@b.de', name: 'A' },
        { email: 'kaputt', name: 'X' },
      ]),
    ).toEqual([{ email: 'a@b.de', name: 'A' }]);
  });
  test('isPortalEmail und entryEmails', () => {
    expect(isPortalEmail('a@b.de')).toBe(true);
    expect(isPortalEmail('a@b')).toBe(false);
    expect(entryEmails({ email: 'a@b.de', name: '' })).toEqual(['a@b.de']);
    expect(entryEmails({ email: 'a@b.de', name: '', emails: ['a@b.de', 'c@d.de'] })).toEqual(['a@b.de', 'c@d.de']);
  });
  test('decodeListFile: UTF-8 mit BOM und Windows-1252', () => {
    expect(decodeListFile(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    expect(decodeListFile(new Uint8Array([0xd6, 0x7a, 0x74, 0xfc, 0x72, 0x6b]))).toBe('Öztürk');
  });
});

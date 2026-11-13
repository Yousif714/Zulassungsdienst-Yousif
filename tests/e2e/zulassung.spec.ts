import { expect, test } from '@playwright/test';

import { formatEuro } from '@/domain/money';

test('Abnahme 7: erledigt, nicht abgerechnet → Rechnung zuordnen', async ({ page }) => {
  await page.goto('/zulassung?reset=1');
  await expect(page.getByTestId('kpi-not-invoiced')).toHaveText('1');
  await page.goto('/zulassung/auftraege/j-mueller-1');
  await page.getByTestId('invoice-candidate-i-z-311').getByRole('button', { name: 'Zuordnen' }).click();
  await expect(page.getByTestId('job-rest')).toHaveText(formatEuro(0));
  await page.goto('/zulassung'); await expect(page.getByTestId('kpi-not-invoiced')).toHaveText('0');
});

test('Abnahme 11: Verbindung gestört → Datenstand zu alt', async ({ page }) => {
  await page.goto('/verbindungen?reset=1');
  await page.getByTestId('conn-lexware_zulassung').getByRole('button', { name: 'Störung simulieren' }).click();
  // Die MoneyCard bettet einen eigenen StaleNotice ein, daher auf die Karte eingrenzen.
  await page.goto('/zulassung'); await expect(page.getByTestId('money-card-zulassung').getByTestId('stale-notice')).toContainText('Datenstand zu alt');
  await expect(page.getByTestId('kpi-not-invoiced')).toHaveText('–');
});

test('Verbindungen: Stand in Minuten, Wieder verbinden macht die Quelle frisch', async ({ page }) => {
  await page.goto('/verbindungen?reset=1');
  const conn = page.getByTestId('conn-lexware_zulassung');
  await expect(conn).toContainText('Lexware Zulassungsdienst');
  await expect(conn).toContainText('Zulassungsdienst');
  await expect(conn).toContainText('Stand vor 10 Min.');
  await conn.getByRole('button', { name: 'Störung simulieren' }).click();
  await expect(conn).toContainText('Störung');
  await conn.getByRole('button', { name: 'Wieder verbinden' }).click();
  await expect(conn).toContainText('Stand vor 0 Min.');
  await page.goto('/zulassung');
  await expect(page.getByTestId('money-card-zulassung')).toBeVisible();
  await expect(page.getByTestId('stale-notice')).toHaveCount(0);
  await expect(page.getByTestId('kpi-not-invoiced')).toHaveText('1');
});

test('Übersicht: Tageszahlen, Aufträge nach Status, Kundenliste', async ({ page }) => {
  await page.goto('/zulassung?reset=1');
  await expect(page.getByTestId('kpi-done-today')).toHaveText('0');
  await expect(page.getByTestId('kpi-open')).toHaveText('0');
  await expect(page.getByTestId('kpi-waiting')).toHaveText('1');
  await expect(page.getByTestId('money-card-zulassung')).toBeVisible();
  await expect(page.getByTestId('jobs-waiting_customer').getByTestId('job-row-j-schmidt-1')).toBeVisible();
  await expect(page.getByTestId('jobs-done').getByTestId('job-row-j-mueller-1')).toBeVisible();
  await page.getByTestId('customer-row-d-mueller').click();
  await expect(page).toHaveURL(/\/zulassung\/kunden\/d-mueller/);
});

test('Auftrag: Status umschalten zählt in den Tageszahlen', async ({ page }) => {
  await page.goto('/zulassung/auftraege/j-schmidt-1?reset=1');
  await expect(page.getByTestId('job-price')).toHaveText(formatEuro(8900));
  await expect(page.getByRole('radio', { name: 'wartet auf Kunde' })).toBeChecked();
  await page.getByRole('radio', { name: 'erledigt' }).check();
  await expect(page.getByRole('radio', { name: 'erledigt' })).toBeChecked();
  await page.getByTestId('last-message').click();
  await expect(page).toHaveURL(/\/nachrichten\/t-schmidt/);
  await page.goto('/zulassung');
  await expect(page.getByTestId('kpi-done-today')).toHaveText('1');
  await expect(page.getByTestId('kpi-waiting')).toHaveText('0');
  await expect(page.getByTestId('kpi-not-invoiced')).toHaveText('2');
});

test('Auftrag: Rechnungsentwurf vorbereiten (Demo) einmalig', async ({ page }) => {
  await page.goto('/zulassung/auftraege/j-mueller-1?reset=1');
  await expect(page.getByTestId('job-rest')).toHaveText(formatEuro(8900));
  const prepare = page.getByRole('button', { name: 'Rechnungsentwurf vorbereiten (Demo)' });
  await prepare.click();
  await expect(page.getByTestId('invoice-draft-status')).toContainText('Entwurf angelegt');
  await expect(page.getByTestId('invoice-draft-status')).toContainText(formatEuro(8900));
  await expect(prepare).toBeDisabled();
  const drafts = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('nexus-demo-v1')!) as { actions: { id: string; type: string; status: string; payload: unknown }[] };
    return s.actions.filter((a) => a.type === 'create_invoice_draft');
  });
  expect(drafts).toEqual([{ ...drafts[0], id: 'invoice-draft-j-mueller-1', status: 'draft',
    payload: { jobId: 'j-mueller-1', contactId: 'd-mueller', amountCents: 8900, text: 'Umschreibung BOT-MK 456' } }]);
});

test('Kunde: Fahrzeuge, Aufträge, offene Rechnungen, letzte Nachrichten', async ({ page }) => {
  await page.goto('/zulassung/kunden/d-mueller?reset=1');
  await expect(page.getByTestId('vehicles')).toContainText('BOT-MK 456');
  await expect(page.getByTestId('invoice-i-z-290')).toContainText(formatEuro(39000));
  await expect(page.getByTestId('invoice-i-z-290')).toContainText('überfällig');
  await expect(page.getByTestId('invoice-i-z-311')).toContainText('offen');
  await page.getByTestId('job-row-j-mueller-1').click();
  await expect(page).toHaveURL(/\/zulassung\/auftraege\/j-mueller-1/);

  await page.goto('/zulassung/kunden/d-schmidt');
  await page.getByTestId('message-row-t-schmidt').click();
  await expect(page).toHaveURL(/\/nachrichten\/t-schmidt/);
});

test('Sparkasse: Auszug hochladen → Zusammenfassung → Vorschlag bestätigen → Kundenseite bezahlt', async ({ page }) => {
  await page.goto('/zulassung/zuordnen?reset=1');
  await page.getByLabel('Kontoauszug-Datei').setInputFiles('tests/fixtures/sparkasse/umsaetze-beispiel.csv');
  const preview = page.getByTestId('statement-preview');
  await expect(preview).toContainText('4 Buchungen · 4 neu · 0 schon vorhanden');
  await expect(preview).toContainText('Zeitraum 03.11.–11.11. · Konto DE00 … 9999');
  await expect(preview).toContainText('übersprungen: 1 Ausgabe');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('statement-summary')).toHaveText('4 neu · 2 automatisch zugeordnet · 1 zum Bestätigen · 1 ohne Treffer');
  await page.getByRole('button', { name: 'Ja, gehört zu Rechnung RE-Z-2026-311 (Zahlung von AUTOHAUS MUELLER GMBH)' }).click();
  await page.goto('/zulassung/kunden/d-mueller');
  await expect(page.getByTestId('customer-invoices')).toContainText('Keine offenen Rechnungen.');
  await expect(page.getByTestId('customer-payments')).toContainText('RE-Z-2026-311');
  await expect(page.getByTestId('customer-payments')).toContainText('RE-Z-2026-290');
  await page.goto('/zulassung/kunden/d-krause');
  await expect(page.getByTestId('customer-payments')).toContainText('in Lexware schon bezahlt');
});

test('Sparkasse: gleicher Auszug als CAMT → nichts neu; falsche Datei → Fehler', async ({ page }) => {
  await page.goto('/zulassung/zuordnen?reset=1');
  const input = page.getByLabel('Kontoauszug-Datei');
  await input.setInputFiles('tests/fixtures/sparkasse/umsaetze-beispiel.csv');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('statement-summary')).toContainText('4 neu');
  await input.setInputFiles('tests/fixtures/sparkasse/auszug-beispiel.xml');
  await expect(page.getByTestId('statement-preview')).toContainText('4 Buchungen · 0 neu · 4 schon vorhanden');
  await expect(page.getByRole('button', { name: 'Übernehmen', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stand übernehmen' }).click();
  await expect(page.getByTestId('statement-summary')).toContainText('0 neu');
  await input.setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
  await expect(page.getByTestId('statement-upload').getByRole('alert')).toHaveText('Das ist kein Sparkassen-Auszug (CAMT oder CSV).');
  await expect(page.getByTestId('statement-preview')).toHaveCount(0);
});

test('Sparkasse: Übersicht zeigt Zeile „Zahlungen zuordnen“ mit Anzahl offener Zahlungen', async ({ page }) => {
  await page.goto('/zulassung?reset=1');
  await expect(page.getByTestId('zulassung-match-row')).toContainText('Zahlungen zuordnen');
  await expect(page.getByTestId('zulassung-match-row')).toContainText('0');
  await page.getByTestId('zulassung-match-row').click();
  await expect(page).toHaveURL(/\/zulassung\/zuordnen$/);
  await expect(page.getByText('Keine offenen Zahlungen.')).toBeVisible();
  await page.getByLabel('Kontoauszug-Datei').setInputFiles('tests/fixtures/sparkasse/umsaetze-beispiel.csv');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('statement-summary')).toContainText('4 neu');
  await page.goto('/zulassung');
  await expect(page.getByTestId('zulassung-match-row')).toContainText('2');
});

test('Verbindungen: Sparkasse zeigt Auszugsstand und Upload-Knopf', async ({ page }) => {
  await page.goto('/verbindungen?reset=1');
  const conn = page.getByTestId('conn-bank_sparkasse');
  await expect(conn).toContainText('Zulassungsdienst · Noch kein Auszug');
  await expect(conn.getByRole('button', { name: 'Störung simulieren' })).toHaveCount(0);
  await conn.getByRole('link', { name: 'Auszug hochladen' }).click();
  await expect(page).toHaveURL(/\/zulassung\/zuordnen$/);
  await page.getByLabel('Kontoauszug-Datei').setInputFiles('tests/fixtures/sparkasse/umsaetze-beispiel.csv');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('statement-summary')).toContainText('4 neu');
  await page.goto('/verbindungen');
  await expect(page.getByTestId('conn-bank_sparkasse')).toContainText('Auszug bis 11.11. · hochgeladen heute');
});

const SPK_HEADER = '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';
const spkCsv = (row: { date: string; reference: string; payer: string; iban: string; amount: string }) => ({
  name: 'umsaetze.csv', mimeType: 'text/csv',
  buffer: Buffer.from(`${SPK_HEADER}\n"DE00360501050000009999";"${row.date}";"${row.date}";"GUTSCHR. UEBERWEISUNG";"${row.reference}";"";"";"";"";"";"";"${row.payer}";"${row.iban}";"XXXXDEXXXXX";"${row.amount}";"EUR";"Umsatz gebucht"\n`),
});

test('Sparkasse: Sammelzahlung mit Überzahlung → „Ja, so aufteilen“ → Rest sichtbar', async ({ page }) => {
  await page.goto('/zulassung/zuordnen?reset=1');
  await page.getByLabel('Kontoauszug-Datei').setInputFiles(spkCsv({ date: '10.11.26', reference: 'RE-Z-2026-290 RE-Z-2026-295', payer: 'Autohaus Mueller GmbH', iban: 'DE00100000000000000007', amount: '700,00' }));
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('statement-summary')).toHaveText('1 neu · 0 automatisch zugeordnet · 1 zum Bestätigen · 0 ohne Treffer');
  const card = page.locator('[data-testid^="match-"]');
  await expect(card).toContainText('Aufteilen: RE-Z-2026-290 390,00 € · RE-Z-2026-295 250,00 €');
  await expect(card).toContainText('Rest 60,00 € bleibt nicht zugeordnet');
  await page.getByRole('button', { name: 'Ja, so aufteilen (Zahlung von Autohaus Mueller GmbH)' }).click();
  await expect(page.getByText('Keine offenen Zahlungen.')).toBeVisible();
  const rests = page.getByTestId('payment-rests');
  await expect(rests).toContainText('Nicht zugeordnete Reste');
  await expect(rests).toContainText('Autohaus Mueller GmbH');
  await expect(rests).toContainText('10.11.2026');
  await expect(rests).toContainText('Rest 60,00 €');
  await expect(rests.getByRole('button')).toHaveCount(0);
  await page.goto('/zulassung/kunden/d-mueller');
  await expect(page.getByTestId('customer-payments')).toContainText('RE-Z-2026-290');
  await expect(page.getByTestId('customer-payments')).toContainText('RE-Z-2026-295');
});

test('Sparkasse: ohne Treffer → „alle offenen Rechnungen“ eines Kunden wählen', async ({ page }) => {
  await page.goto('/zulassung/zuordnen?reset=1');
  await page.getByLabel('Kontoauszug-Datei').setInputFiles(spkCsv({ date: '11.11.26', reference: 'Sammelzahlung', payer: 'Max Mustermann', iban: 'DE00100000000000000009', amount: '800,00' }));
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('statement-summary')).toHaveText('1 neu · 0 automatisch zugeordnet · 0 zum Bestätigen · 1 ohne Treffer');
  const card = page.locator('[data-testid^="match-"]');
  const select = page.getByLabel('Ziel für Zahlung von Max Mustermann wählen');
  await expect(select.locator('option').first()).toHaveText('Rechnung oder Kunde wählen …');
  await select.selectOption({ label: 'Kunde Autohaus Müller · alle offenen Rechnungen (3) · 729,00 €' });
  await expect(card).toContainText('Aufteilen: RE-Z-2026-290 390,00 € · RE-Z-2026-295 250,00 € · RE-Z-2026-311 89,00 €');
  await expect(card).toContainText('Rest 71,00 € bleibt nicht zugeordnet');
  await expect(page.getByRole('button', { name: 'Keine Kundenzahlung (Zahlung von Max Mustermann)' })).toBeVisible();
  await page.getByRole('button', { name: 'Zuordnen (Zahlung von Max Mustermann)' }).click();
  await expect(page.getByTestId('payment-rests')).toContainText('Rest 71,00 €');
  await page.goto('/zulassung/kunden/d-mueller');
  await expect(page.getByTestId('customer-invoices')).toContainText('Keine offenen Rechnungen.');
});

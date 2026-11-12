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

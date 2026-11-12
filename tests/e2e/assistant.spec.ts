import { expect, test } from '@playwright/test';

const QUESTIONS = ['Wer ist bei NEXUS überfällig?', 'Was ist heute noch offen?', 'Was fehlt für SEELE?', 'Was ist mit dem Auftrag von Autohaus Schmidt?', 'Wie viel Geld kommt diesen Monat noch rein?'];

test('Abnahme 8: fünf Chat-Fragen mit Links', async ({ page }) => {
  await page.goto('/chat?reset=1');
  for (const q of QUESTIONS) {
    await page.getByRole('button', { name: q }).click();
    const last = page.getByTestId('chat-answer').last();
    await expect(last).not.toContainText('kann die Demo noch nicht');
    await expect(last.getByRole('link').first()).toBeVisible();
  }
  await expect(page.getByTestId('chat-answer')).toHaveCount(5);
});

test('Chat: freie Frage und Link-Chip führt zur Seite', async ({ page }) => {
  await page.goto('/chat?reset=1');
  await page.getByTestId('chat-input').fill('Wer ist überfällig?');
  await page.getByTestId('chat-send').click();
  const last = page.getByTestId('chat-answer').last();
  await expect(last).toContainText('Mehmet Kaya');
  await last.getByRole('link', { name: 'Mehmet Kaya' }).click();
  await expect(page).toHaveURL(/\/nexus\/mitglieder\/mc-kaya/);
});

test('Abnahme 9: gebrochene Zusage', async ({ page }) => {
  await page.goto('/?reset=1');
  const demir = page.getByText(/Herr Demir.*Rechnung/);
  await expect(page.getByTestId('all-insights-link')).toBeVisible();
  if ((await demir.count()) === 0) {
    await page.getByTestId('all-insights-link').click();
    await expect(page).toHaveURL(/\/hinweise/);
  }
  await expect(demir.first()).toBeVisible(); // auf Heute oder über „Alle Hinweise“
});

test('Alle Hinweise: nach Priorität gruppiert, Zahl stimmt mit Heute überein', async ({ page }) => {
  await page.goto('/?reset=1');
  const label = await page.getByTestId('all-insights-link').innerText();
  const n = Number(/\((\d+)\)/.exec(label)![1]);
  await page.getByTestId('all-insights-link').click();
  await expect(page).toHaveURL(/\/hinweise/);
  // Next behält die vorige Seite versteckt im DOM: nur die Gruppen dieser Seite zählen.
  await expect(page.locator('[data-testid^="insights-"] [data-testid="insight-row"]')).toHaveCount(n);
  await expect(page.getByTestId('insights-now').getByTestId('insight-row').first()).toBeVisible();
  await expect(page.locator('[data-key="commit:c-demir"]')).toBeVisible();
});

test('Abnahme 10: WhatsApp-Assistent', async ({ page }) => {
  await page.goto('/assistent?reset=1');
  await page.getByRole('button', { name: 'Morgenbriefing auslösen' }).click();
  await expect(page.getByTestId('wa-msg').last()).toContainText('Guten Morgen');
  await expect(page.getByTestId('wa-msg').last()).toContainText('WhatsApp-Vorlage');
  await page.getByTestId('wa-input').fill('Wer ist überfällig?'); await page.getByTestId('wa-send').click();
  await expect(page.getByTestId('wa-msg').last()).toContainText('Mehmet Kaya');
  await page.getByTestId('wa-input').fill('Schick Kaya die Erinnerung'); await page.getByTestId('wa-send').click();
  await page.getByTestId('wa-msg').last().getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('wa-msg').last()).toContainText('Gesendet (Demo)');
  await page.getByTestId('wa-msg').nth(-2).getByRole('button', { name: 'Senden' }).click(); // derselbe, nun alte Knopf
  await expect(page.getByTestId('wa-msg').last()).toContainText('nicht mehr gültig');
  await page.getByRole('button', { name: 'Nachricht von fremder Nummer simulieren' }).click();
  await expect(page.getByTestId('wa-ignored').last()).toContainText('ignoriert');
  // Nach der eigenen Nachricht ist das 24-Std.-Fenster offen: freie WhatsApp-Nachricht statt Vorlage.
  await page.getByRole('button', { name: 'Abendrückblick auslösen' }).click();
  await expect(page.getByTestId('wa-msg').last()).toContainText('Guten Abend');
  await expect(page.getByTestId('wa-msg').last()).toContainText('Zustellweg: WhatsApp');
  await expect(page.getByTestId('wa-msg').last()).not.toContainText('WhatsApp-Vorlage');
  await page.goto('/protokoll');
  await expect(page.getByText('Freigegeben (WhatsApp): Erinnerung an Mehmet Kaya')).toBeVisible();
});

test('WhatsApp-Assistent: Doppelklick auf Senden sendet nur einmal', async ({ page }) => {
  await page.goto('/assistent?reset=1');
  await page.getByTestId('wa-input').fill('Schick Kaya die Erinnerung'); await page.getByTestId('wa-send').click();
  // Zwei Klicks im selben Takt, bevor React neu zeichnet: beide sehen denselben (veralteten) Seitenstand.
  await page.getByTestId('wa-msg').last().getByRole('button', { name: 'Senden' }).evaluate((el: HTMLElement) => { el.click(); el.click(); });
  await expect(page.getByTestId('wa-msg').last()).toContainText('nicht mehr gültig');
  await expect(page.getByTestId('wa-msg').filter({ hasText: 'Gesendet (Demo)' })).toHaveCount(1);
  await page.getByTestId('wa-msg').nth(-3).getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('wa-msg').last()).toContainText('Ich habe nichts gesendet.');
  await expect(page.getByTestId('wa-msg').filter({ hasText: 'Gesendet (Demo)' })).toHaveCount(1);
});

test('Verbindungen: Anleitung für Phase 2 je Verbindung', async ({ page }) => {
  await page.goto('/verbindungen?reset=1');
  const bank = page.getByTestId('conn-bank');
  await expect(bank).toContainText('Stand vor 10 Min.');
  await page.getByTestId('conn-help-bank').getByText('So verbindest du das (Phase 2)').click();
  await expect(page.getByTestId('conn-help-bank')).toContainText('CAMT');
  await expect(page.getByText('So verbindest du das (Phase 2)')).toHaveCount(10);
});

test('Protokoll: jeder Eintrag, neueste zuerst, mit Demo-Etikett', async ({ page }) => {
  await page.goto('/einstellungen?reset=1');
  await page.getByRole('switch', { name: /Briefings/ }).uncheck();
  await page.goto('/protokoll');
  const first = page.getByTestId('audit-row').first();
  await expect(first).toContainText('Einstellungen geändert: Briefings');
  await expect(first).toContainText('Inhaber');
  await expect(first.getByTestId('demo-badge')).toBeVisible();
});

test('Einstellungen: Schwelle, Nummer, Coach-Tipps, Demo zurücksetzen', async ({ page }) => {
  await page.goto('/?reset=1');
  await page.getByTestId('coach-tip').getByRole('button', { name: 'Nicht mehr vorschlagen' }).click();
  await page.goto('/einstellungen');
  await page.getByLabel('Antwortzeit-Schwelle (Stunden)').fill('5');
  await page.getByLabel('Antwortzeit-Schwelle (Stunden)').blur();
  await page.getByLabel('Inhaber-Nummer').fill('+49 151 2222222');
  await page.getByLabel('Inhaber-Nummer').blur();
  await expect(page.getByRole('button', { name: /Coach-Tipps zurücksetzen \(1\)/ })).toBeEnabled();
  await page.getByRole('button', { name: /Coach-Tipps zurücksetzen/ }).click();
  await expect(page.getByRole('button', { name: /Coach-Tipps zurücksetzen \(0\)/ })).toBeDisabled();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nexus-demo-v1')!).settings);
  expect(stored).toMatchObject({ replyThresholdHours: 5, ownerPhone: '+49 151 2222222', suppressedCoachKeys: [] });
  await page.getByRole('button', { name: 'Demo zurücksetzen' }).click();
  await expect(page.getByLabel('Antwortzeit-Schwelle (Stunden)')).toHaveValue('2');
  await expect(page.getByLabel('Inhaber-Nummer')).toHaveValue('+491510000000');
});

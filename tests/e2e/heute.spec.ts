import { expect, test } from '@playwright/test';

test('Abnahme 1: wartender Kunde → Antwort senden → Protokoll, Hinweis zu', async ({ page }) => {
  await page.goto('/?reset=1');
  const rows = page.getByTestId('insight-row'); expect(await rows.count()).toBeLessThanOrEqual(3);
  await page.locator('[data-key="reply:m-schmidt-in-1"]').click();
  await expect(page).toHaveURL(/\/nachrichten\/t-schmidt/);
  await expect(page.getByTestId('draft-text')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByText('Gesendet (Demo)')).toBeVisible();
  await page.goto('/protokoll'); await expect(page.getByText(/Autohaus Schmidt/).first()).toBeVisible();
  await page.goto('/'); await expect(page.locator('[data-key="reply:m-schmidt-in-1"]')).toHaveCount(0);
});

test('ActionSheet: Fokus beim Ändern und Live-Region nach dem Senden', async ({ page }) => {
  await page.goto('/nachrichten/t-schmidt?reset=1');
  await expect(page.getByTestId('draft-text')).not.toBeEmpty();
  const status = page.getByTestId('action-status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toBeEmpty();
  const aendern = page.getByRole('button', { name: 'Ändern' });
  await aendern.click();
  await expect(page.getByTestId('draft-editor')).toBeFocused();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(aendern).toBeFocused();
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(status).toContainText('Gesendet (Demo)');
  await expect(status).toBeFocused();
});

test('Antwort-Hinweis abhaken → Kunde verschwindet auch aus „Nachrichten“', async ({ page }) => {
  await page.goto('/?reset=1');
  const row = page.locator('[data-key="reply:m-schmidt-in-1"]');
  const replies = page.getByTestId('replies');
  await expect(replies.getByText('Autohaus Schmidt')).toBeVisible();
  await row.getByRole('button', { name: /^Erledigt:/ }).click();
  await expect(row).toHaveCount(0);
  await expect(replies.getByText('Autohaus Schmidt')).toHaveCount(0);
});

/** Wischt eine Zeile waagerecht von `from` nach `to` (Anteile der Breite). */
async function swipe(page: import('@playwright/test').Page, row: import('@playwright/test').Locator, from: number, to: number) {
  const box = (await row.boundingBox())!;
  const y = box.y + Math.min(30, box.height / 2);
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, y + 2, { steps: 8 });
  await page.mouse.up();
}

test('Hinweis wischen: nach links erledigt, nach rechts später – beides im Protokoll', async ({ page }) => {
  await page.goto('/?reset=1');
  const done = page.locator('[data-key="reply:m-schmidt-in-1"]');
  await swipe(page, done, 0.85, 0.15);
  await expect(done).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/); // Wischen öffnet den Link nicht

  const row = page.getByTestId('top-insights').getByTestId('insight-row').first();
  const key = await row.getAttribute('data-key');
  await swipe(page, row, 0.3, 0.95);
  await expect(page.locator(`[data-key="${key}"]`)).toHaveCount(0);

  await page.goto('/protokoll');
  await expect(page.getByTestId('audit-row').nth(1)).toContainText('Hinweis erledigt: Autohaus Schmidt');
  await expect(page.getByTestId('audit-row').first()).toContainText('Hinweis zurückgestellt');
});

test('Hinweis: kurzes Wischen springt zurück; „Zurückstellen“ per Tastatur', async ({ page }) => {
  await page.goto('/?reset=1');
  const row = page.locator('[data-key="reply:m-schmidt-in-1"]');
  await swipe(page, row, 0.6, 0.5);
  await expect(row).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  const later = row.getByRole('button', { name: /^Zurückstellen/ });
  await later.focus();
  await expect(later).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(row).toHaveCount(0);
});

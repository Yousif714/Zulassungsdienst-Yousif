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

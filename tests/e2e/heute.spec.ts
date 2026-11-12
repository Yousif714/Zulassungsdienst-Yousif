import { expect, test } from '@playwright/test';

test('Abnahme 1: wartender Kunde → Antwort senden → Protokoll, Hinweis zu', async ({ page }) => {
  await page.goto('/?reset=1');
  const rows = page.getByTestId('insight-row'); expect(await rows.count()).toBeLessThanOrEqual(3);
  await page.locator('[data-key="reply:m-schmidt-in-1"]').click();
  await expect(page).toHaveURL(/\/nachrichten\/t-schmidt/);
  await expect(page.getByTestId('draft-text')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByText('Gesendet (Demo)')).toBeVisible();
  await page.goto('/protokoll'); await expect(page.getByText(/Autohaus Schmidt/)).toBeVisible();
  await page.goto('/'); await expect(page.locator('[data-key="reply:m-schmidt-in-1"]')).toHaveCount(0);
});

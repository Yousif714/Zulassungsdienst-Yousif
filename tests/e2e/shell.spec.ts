import { expect, test } from '@playwright/test';

test('mobil: drei Tabs unten', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto('/');
  for (const t of ['Heute', 'NEXUS', 'Zulassungsdienst']) await expect(page.getByTestId('tab-bar').getByText(t, { exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-button')).toBeVisible();
});

test('desktop: Seitenleiste', async ({ page, isMobile }) => {
  test.skip(isMobile);
  await page.goto('/');
  await expect(page.getByTestId('sidebar')).toBeVisible();
});

test('Manifest erreichbar', async ({ request }) => expect((await request.get('/manifest.webmanifest')).ok()).toBe(true));

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

test('Service Worker wird registriert', async ({ page, isMobile }) => {
  test.skip(isMobile);
  await page.goto('/');
  await page.waitForLoadState('load');
  await expect
    .poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration())), { timeout: 10_000 })
    .toBe(true);
});

test('mobil: Mehr-Menü als Disclosure', async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto('/');
  const trigger = page.getByTestId('more-button');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('more-menu').getByRole('link', { name: 'Protokoll' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('more-menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByTestId('more-protokoll').click();
  await expect(page).toHaveURL(/\/protokoll$/);
});

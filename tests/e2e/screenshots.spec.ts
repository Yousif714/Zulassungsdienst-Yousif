import { expect, test, type Page } from '@playwright/test';

// Bildschirmfotos für die Übergabe (docs/vorschau/screenshots/<projekt>-<seite>.png).
// Nur mit SCREENSHOTS=1, damit der normale E2E-Lauf die Bilder nicht neu schreibt:
//   SCREENSHOTS=1 npm run e2e -- tests/e2e/screenshots.spec.ts
test.skip(!process.env.SCREENSHOTS, 'Nur mit SCREENSHOTS=1');
test.use({ deviceScaleFactor: 2 });

type Shot = { name: string; path: string; prepare?: (page: Page) => Promise<void> };

const SHOTS: Shot[] = [
  { name: 'heute', path: '/', prepare: async (page) => { await expect(page.getByTestId('top-insights')).toBeVisible(); } },
  { name: 'nexus', path: '/nexus', prepare: async (page) => { await expect(page.getByTestId('money-card-nexus')).toBeVisible(); } },
  { name: 'mitglied-kaya', path: '/nexus/mitglieder/mc-kaya', prepare: async (page) => { await expect(page.getByTestId('arrears')).toBeVisible(); } },
  { name: 'uebernahme', path: '/nexus/mitglieder/mc-kaya/uebernahme', prepare: async (page) => { await expect(page.getByTestId('rate-amounts')).not.toBeEmpty(); } },
  { name: 'zuordnen', path: '/nexus/zuordnen', prepare: async (page) => { await expect(page.getByTestId('match-p-yilmaz-1')).toBeVisible(); } },
  {
    name: 'seele-call', path: '/nexus/calls/call-seele',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Folientexte vorbereiten' }).click();
      await expect(page.getByTestId('slide')).toHaveCount(10);
    },
  },
  { name: 'zulassung', path: '/zulassung', prepare: async (page) => { await expect(page.getByTestId('money-card-zulassung')).toBeVisible(); } },
  { name: 'auftrag-mueller', path: '/zulassung/auftraege/j-mueller-1', prepare: async (page) => { await expect(page.getByTestId('job-rest')).toBeVisible(); } },
  {
    name: 'chat', path: '/chat',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Wer ist bei NEXUS überfällig?' }).click();
      await expect(page.getByTestId('chat-answer').last().getByRole('link').first()).toBeVisible();
    },
  },
  {
    name: 'assistent', path: '/assistent',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Morgenbriefing auslösen' }).click();
      await expect(page.getByTestId('wa-msg').last()).toContainText('Guten Morgen');
      await page.getByTestId('wa-input').fill('Wer ist überfällig?');
      await page.getByTestId('wa-send').click();
      await expect(page.getByTestId('wa-msg').last().getByRole('link', { name: 'Mehmet Kaya' })).toBeVisible();
    },
  },
];

async function shoot(page: Page, project: string, shot: Shot) {
  await page.goto(`${shot.path}?reset=1`);
  await shot.prepare?.(page);
  await expect(page.locator('[data-shown]')).toHaveCount(0); // Hochzählen der Beträge abgeschlossen
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `docs/vorschau/screenshots/${project}-${shot.name}.png`, animations: 'disabled' });
}

for (const shot of SHOTS) {
  test(`Bildschirmfoto ${shot.name}`, async ({ page }, info) => {
    await shoot(page, info.project.name, shot);
  });
}

test.describe('Dunkelmodus', () => {
  test.use({ colorScheme: 'dark' });
  test('Bildschirmfoto heute-dunkel', async ({ page }, info) => {
    await shoot(page, info.project.name, { ...SHOTS[0], name: 'heute-dunkel' });
  });
});

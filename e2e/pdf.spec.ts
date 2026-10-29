import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test('views PDFs offline with text, search, outline, links, zoom, and isolation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/');
  // Load the application once, then forbid every non-local request.
  const remoteRequests: string[] = [];
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:1420') return route.continue();
    remoteRequests.push(route.request().url());
    return route.abort();
  });
  await page
    .getByLabel('Import selected files')
    .setInputFiles(['e2e/fixtures/paged.pdf', 'e2e/fixtures/linked.md']);
  // Folder selection preserves the existing alphabetical auto-open convention.
  if (!(await page.getByRole('button', { name: 'paged.pdf', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer', exact: true }).click();
  await page.getByRole('button', { name: 'paged.pdf', exact: true }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#page-count')).toHaveText('of 2');
  await expect(frame.locator('.textLayer').first()).toContainText('Searchable needle.');
  await expect(page.locator('.trust-button')).toContainText('PDF preview · scripts disabled');
  await expect(page.locator('.preview-pane')).toHaveAttribute('aria-busy', 'false');
  const pdfFrame = page.frames().find((frame) => frame.parentFrame());
  expect(
    await pdfFrame!.evaluate(() => {
      try {
        return !!parent.document;
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  expect(await pdfFrame!.evaluate(() => '__PAPYRI_HOST_TOKEN__' in window)).toBe(false);

  await page.getByRole('button', { name: 'Search document', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find in document', exact: true }).fill('needle');
  await expect(frame.locator('#match-count')).toHaveText('2 matches');
  await expect(frame.locator('.textLayer .highlight').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close search' }).click();

  await frame.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(frame.getByRole('spinbutton', { name: 'Page number' })).toHaveValue('2');
  await frame.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(frame.getByRole('spinbutton', { name: 'Page number' })).toHaveValue('1');
  await frame.getByRole('link', { name: 'Internal destination' }).click();
  await expect(frame.getByRole('spinbutton', { name: 'Page number' })).toHaveValue('2');

  await page.getByRole('button', { name: 'Fit document to width' }).click();
  const canvas = frame.locator('.page').first();
  const fitted = await canvas.evaluate((element) => element.getBoundingClientRect().width);
  const viewport = await frame
    .locator('#viewer-container')
    .evaluate((element) => element.clientWidth);
  expect(fitted).toBeLessThanOrEqual(viewport);
  const unscaledFixtureWidth = 480;
  const zoomControl = page.getByRole('button', { name: /^Reset document zoom/ });
  const zoomPercent = async () => Number((await zoomControl.textContent())!.replace('%', ''));
  const percentRoundingTolerance = 1;
  await expect
    .poll(async () => Math.abs((await zoomPercent()) - (fitted / unscaledFixtureWidth) * 100))
    .toBeLessThanOrEqual(percentRoundingTolerance);
  const fittedZoom = await zoomPercent();
  await page.keyboard.press('Control++');
  await expect(page.getByRole('button', { name: /^Reset document zoom/ })).toHaveText(
    `${fittedZoom + 10}%`,
  );
  await expect
    .poll(() => canvas.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(fitted);
  await expect(page.getByRole('button', { name: 'Fit document to width' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'latte');
  await expect(frame.locator('canvas').first()).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact!),
    ),
  ).toEqual([]);
  await frame.getByRole('spinbutton', { name: 'Page number' }).fill('1');
  await frame.getByRole('spinbutton', { name: 'Page number' }).press('Enter');
  await frame.getByRole('link', { name: '/linked.md', exact: true }).click();
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Linked Markdown' }),
  ).toBeVisible();
  await expect(page.frameLocator('iframe').locator('html')).toHaveCSS('font-size', '16px');
  await page.frameLocator('iframe').getByRole('link', { name: 'Back to PDF' }).click();
  await expect(
    page.frameLocator('iframe').getByRole('spinbutton', { name: 'Page number' }),
  ).toHaveValue('2');
  expect(remoteRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('keeps PDF JavaScript disabled and unlocks password-protected documents', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles('e2e/fixtures/scripted.pdf');
  await expect(page.frameLocator('iframe').locator('.textLayer').first()).toContainText(
    'PDF fixture',
  );
  expect(
    await page
      .frames()
      .find((frame) => frame.parentFrame())!
      .evaluate(() => '__pdfScriptRan' in globalThis),
  ).toBe(false);
  expect(dialogs).toEqual([]);

  await page.getByLabel('Import selected files').setInputFiles('e2e/fixtures/protected.pdf');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByLabel('This PDF requires a password')).toBeVisible();
  await frame.getByLabel('This PDF requires a password').fill('wrong');
  await frame.getByRole('button', { name: 'Unlock PDF' }).click();
  await expect(frame.getByLabel('Incorrect password. Try again.')).toBeVisible();
  await frame.getByLabel('Incorrect password. Try again.').fill('papyri-test-password');
  await frame.getByRole('button', { name: 'Unlock PDF' }).click();
  await expect(frame.locator('#page-count')).toHaveText('of 2');
  await expect(frame.locator('.textLayer').first()).toContainText('PDF fixture');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'papyri-test-password',
  );
});

test('reports invalid PDFs and browser Typst limitations without executing source', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<script>parent.bad=true</script>'),
  });
  await expect(page.getByRole('alert')).toContainText('PDF');
  expect(await page.evaluate(() => 'bad' in window)).toBe(false);
  await page.getByLabel('Import selected files').setInputFiles({
    name: 'document.typ',
    mimeType: 'text/plain',
    buffer: await readFile('e2e/fixtures/paged.typ'),
  });
  await expect(page.getByRole('alert')).toContainText('requires the Linux app');
  await expect(page.locator('.tab-select')).toHaveCount(0);
});

test('keeps a long PDF responsive and limits rendered page canvases', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles('e2e/fixtures/many-pages.pdf');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reading preferences' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#page-count')).toHaveText('of 200');
  await expect(frame.locator('.textLayer').first()).toContainText('PDF fixture');
  expect(await frame.locator('canvas').count()).toBeLessThanOrEqual(12);
  await frame.getByRole('spinbutton', { name: 'Page number' }).fill('200');
  await frame.getByRole('spinbutton', { name: 'Page number' }).press('Enter');
  await expect(frame.locator('.page[data-page-number="200"] .textLayer')).toContainText(
    'PDF fixture',
  );
  expect(await frame.locator('canvas').count()).toBeLessThanOrEqual(12);
});

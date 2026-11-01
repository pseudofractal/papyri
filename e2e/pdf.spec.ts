import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

function pdfWithBundledResource(kind: 'cmap' | 'symbol' = 'cmap'): Buffer {
  const content =
    kind === 'symbol'
      ? 'BT /F1 20 Tf 50 700 Td (ABC) Tj ET'
      : 'BT /F1 20 Tf 50 700 Td <65E5672C> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ...(kind === 'symbol'
      ? ['<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>']
      : [
          '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>',
          '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> /FontDescriptor 7 0 R /DW 1000 >>',
          '<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
        ]),
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('loads only bundled CMaps requested by a PDF while offline', async ({ page }) => {
  const resources: string[] = [];
  const external: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:1420') {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname.includes('/pdf-resources/')) resources.push(url.pathname);
    return route.continue();
  });
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles({
    name: 'cmap.pdf',
    mimeType: 'application/pdf',
    buffer: pdfWithBundledResource(),
  });
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('.textLayer').first()).toContainText('日本');
  await expect
    .poll(() => resources.some((name) => name.endsWith('/UniJIS-UCS2-H.bcmap')))
    .toBe(true);
  const rejected = await frame.locator('body').evaluate(
    () =>
      new Promise<string>((resolve) => {
        const channel = JSON.parse(document.getElementById('payload')!.textContent!).channel;
        const request = 999_999;
        window.addEventListener('message', function receive(event) {
          if (
            event.source !== parent ||
            event.data?.type !== 'pdf-resource-result' ||
            event.data.request !== request
          )
            return;
          window.removeEventListener('message', receive);
          resolve(String(event.data.error));
        });
        parent.postMessage(
          { type: 'pdf-resource-request', name: '../secret', request, channel },
          '*',
        );
      }),
  );
  expect(rejected).toContain('not bundled');
  expect(resources.every((name) => !name.includes('secret'))).toBe(true);
  expect(external).toEqual([]);
});

test('loads bundled standard fonts requested by a PDF', async ({ page }) => {
  const resources: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes('/pdf-resources/')) resources.push(url.pathname);
  });
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles({
    name: 'symbol.pdf',
    mimeType: 'application/pdf',
    buffer: pdfWithBundledResource('symbol'),
  });
  await expect(page.frameLocator('iframe').locator('canvas').first()).toBeVisible();
  await expect.poll(() => resources.some((name) => name.endsWith('/FoxitSymbol.pfb'))).toBe(true);
});

test('does not load bundled resources for the self-contained showcase PDF', async ({ page }) => {
  const resourceRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes('/pdf-resources/') || pathname.endsWith('/pdf-resources.json'))
      resourceRequests.push(pathname);
  });
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles('examples/showcase/sample.pdf');
  await expect(page.frameLocator('iframe').locator('.textLayer').first()).toContainText('PDF');
  expect(resourceRequests).toEqual([]);
});

test('reports a missing PDF resource and retries it', async ({ page }) => {
  let attempts = 0;
  await page.route('**/pdf-resources.json', async (route) => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles({
    name: 'cmap.pdf',
    mimeType: 'application/pdf',
    buffer: pdfWithBundledResource(),
  });
  await expect(page.getByRole('alert')).toContainText('503');
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await expect(page.frameLocator('iframe').locator('.textLayer').first()).toContainText('日本');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('retries a PDF preview after a transient renderer failure', async ({ page }) => {
  let requests = 0;
  await page.route('**/pdf.js', async (route) => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles('e2e/fixtures/paged.pdf');
  await expect(page.getByRole('alert')).toContainText('503');
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await expect(page.frameLocator('iframe').locator('#page-count')).toHaveText('of 2');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(requests).toBe(2);
});

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
  await expect(page.locator('.tab-select')).toHaveCount(1);
  await expect(page.frameLocator('iframe').locator('pre code')).toContainText('#set');
  await expect(page.frameLocator('iframe').locator('pre code .hljs-keyword').first()).toBeVisible();
  await page.getByLabel('Import selected files').setInputFiles({
    name: 'document.tex',
    mimeType: 'text/plain',
    buffer: Buffer.from('\\section{Hello}\n<script>parent.bad=true</script>'),
  });
  await expect(page.getByRole('alert')).toContainText('requires the Linux app');
  const latex = page.frameLocator('iframe').locator('pre code');
  await expect(latex).toContainText('\\section{Hello}');
  await expect(latex.locator('span').first()).toBeVisible();
  expect(await page.evaluate(() => 'bad' in window)).toBe(false);
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

test('scrolling a PDF keeps the current preview and position', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(['e2e/fixtures/many-pages.pdf', 'e2e/fixtures/linked.md']);
  if (!(await page.getByRole('button', { name: 'many-pages.pdf', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer', exact: true }).click();
  await page.getByRole('button', { name: 'many-pages.pdf', exact: true }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#page-count')).toHaveText('of 200');
  const viewer = frame.locator('#viewer-container');
  await viewer.evaluate((element) => {
    element.dataset.scrollRegression = 'original-preview';
    element.scrollTop = 1500;
  });
  await expect.poll(() => viewer.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
  await page.waitForTimeout(750);
  await expect(viewer).toHaveAttribute('data-scroll-regression', 'original-preview');
  await expect.poll(() => viewer.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
  await expect(page.locator('.preview-pane')).toHaveAttribute('aria-busy', 'false');
  await page.locator('.tab-select').filter({ hasText: 'linked.md' }).click();
  await expect(frame.getByRole('heading', { name: 'Linked Markdown' })).toBeVisible();
  await page.locator('.tab-select').filter({ hasText: 'many-pages.pdf' }).click();
  await expect(frame.locator('#page-count')).toHaveText('of 200');
  await expect.poll(() => viewer.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
  await viewer.evaluate((element) => (element.scrollTop = 3500));
  await page.locator('.tab-select').filter({ hasText: 'linked.md' }).click();
  await page.locator('.tab-select').filter({ hasText: 'many-pages.pdf' }).click();
  await expect(frame.locator('#page-count')).toHaveText('of 200');
  await expect.poll(() => viewer.evaluate((element) => element.scrollTop)).toBe(3500);
});

test('opens the command palette while the PDF preview has focus', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles('e2e/fixtures/paged.pdf');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#page-count')).toHaveText('of 2');
  await frame.locator('#viewer-container').press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search files and commands' })).toBeFocused();
  await page.keyboard.press('Escape');
});

test('navigates PDF pages through the command palette', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles('e2e/fixtures/paged.pdf');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#page-count')).toHaveText('of 2');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await search.fill('>last pdf');
  await dialog.getByRole('option', { name: /Last PDF page/ }).click();
  await expect(frame.getByRole('spinbutton', { name: 'Page number' })).toHaveValue('2');
  await page.getByRole('button', { name: 'Open command palette' }).click();
  await search.fill('>go to pdf page');
  await dialog.getByRole('option', { name: /Go to PDF page/ }).click();
  await expect(search).toHaveValue('#');
  await search.fill('#1');
  await search.press('Enter');
  await expect(frame.getByRole('spinbutton', { name: 'Page number' })).toHaveValue('1');
});

test('preserves independent positions when the same PDF is shown in both panes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles('e2e/fixtures/many-pages.pdf');
  await expect(page.frameLocator('iframe').locator('#page-count')).toHaveText('of 200');
  await page.getByRole('button', { name: 'Toggle split view' }).click();
  const first = page.frameLocator('iframe').nth(0).locator('#viewer-container');
  const second = page.frameLocator('iframe').nth(1).locator('#viewer-container');
  await expect(page.frameLocator('iframe').nth(1).locator('#page-count')).toHaveText('of 200');
  await first.evaluate((element) => (element.scrollTop = 2200));
  await second.evaluate((element) => (element.scrollTop = 6000));
  await expect.poll(() => first.evaluate((element) => element.scrollTop)).toBe(2200);
  await expect.poll(() => second.evaluate((element) => element.scrollTop)).toBe(6000);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: /Allow network resources/ }).check();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.frameLocator('iframe').nth(0).locator('#page-count')).toHaveText('of 200');
  await expect(page.frameLocator('iframe').nth(1).locator('#page-count')).toHaveText('of 200');
  await expect.poll(() => first.evaluate((element) => element.scrollTop)).toBe(2200);
  await expect.poll(() => second.evaluate((element) => element.scrollTop)).toBe(6000);
});

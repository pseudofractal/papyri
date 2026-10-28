import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const markdownFile = (text: string, name = 'sample.md') => ({
  name,
  mimeType: 'text/markdown',
  buffer: Buffer.from(text),
});

async function boundedDialog(page: Page) {
  const panel = page.locator('dialog[open] .modal-box');
  await expect(panel).toBeVisible();
  let diagnostic = '';
  try {
    await expect
      .poll(async () => {
        const measurement = await panel.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const viewport = window.visualViewport;
          const width = Math.min(innerWidth, viewport?.width ?? innerWidth);
          const height = Math.min(innerHeight, viewport?.height ?? innerHeight);
          const left = viewport?.offsetLeft ?? 0;
          const top = viewport?.offsetTop ?? 0;
          const boundsTolerancePx = 2;
          const contentTolerancePx = 1;
          const expectedWidth = width * 0.75;
          const maximumHeight = height * 0.8;
          const horizontalInset = (width - expectedWidth) / 2;
          const verticalInset = (height - maximumHeight) / 2;
          const expectedBounds = {
            width: expectedWidth,
            maximumHeight,
            left: left + horizontalInset,
            right: left + width - horizontalInset,
            top: top + verticalInset,
            bottom: top + height - verticalInset,
          };
          return {
            withinBounds:
              Math.abs(bounds.width - expectedBounds.width) <= boundsTolerancePx &&
              bounds.height <= expectedBounds.maximumHeight + boundsTolerancePx &&
              bounds.left >= expectedBounds.left - boundsTolerancePx &&
              bounds.right <= expectedBounds.right + boundsTolerancePx &&
              bounds.top >= expectedBounds.top - boundsTolerancePx &&
              bounds.bottom <= expectedBounds.bottom + boundsTolerancePx,
            contentFits: element.scrollWidth <= element.clientWidth + contentTolerancePx,
            title: element.querySelector('h2')?.textContent,
            bounds: bounds.toJSON(),
            expectedBounds,
            viewport: { width, height, left, top },
            content: { scroll: element.scrollWidth, client: element.clientWidth },
            overflowing: [...element.querySelectorAll('*')]
              .filter((child) => child.getBoundingClientRect().right > bounds.right)
              .map((child) => ({ tag: child.tagName, class: child.className })),
          };
        });
        diagnostic = JSON.stringify(measurement);
        return measurement;
      })
      .toMatchObject({ withinBounds: true, contentFits: true });
  } catch (error) {
    throw new Error(`Dialog layout: ${diagnostic}`, { cause: error });
  }
  return panel;
}

test('bounds floating panels to the viewport and wraps controls at every UI zoom', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (let index = 0; index < 8; index++)
    await page.getByRole('button', { name: 'Add delimiter pair' }).click();
  await page
    .locator('.settings-panel > p')
    .first()
    .evaluate((element) => {
      element.textContent += ` ${'long-unbroken-content'.repeat(30)}`;
    });
  for (const viewport of [
    { width: 1280, height: 860 },
    { width: 1920, height: 1100 },
    { width: 640, height: 480 },
    { width: 390, height: 640 },
    { width: 320, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    for (const zoom of [50, 100, 140, 200]) {
      await page.evaluate((value) => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '0', ctrlKey: true, altKey: true }),
        );
        for (let step = 0; step < Math.abs(value - 100) / 10; step++)
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: value < 100 ? '-' : '+',
              ctrlKey: true,
              altKey: true,
            }),
          );
      }, zoom);
      await expect(page.locator('html')).toHaveCSS('zoom', String(zoom / 100));
      const panel = await boundedDialog(page);
      const scrolls = await panel.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      );
      await page.getByRole('button', { name: 'Apply preferences' }).scrollIntoViewIfNeeded();
      if (scrolls) expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await page
        .getByRole('button', { name: 'Close settings', exact: true })
        .scrollIntoViewIfNeeded();
      expect(await panel.evaluate((element) => element.scrollTop)).toBeLessThan(5);
    }
  }
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  for (const open of [
    'Keyboard shortcuts and help',
    'Safe preview: trust current document for scripts',
  ]) {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.keyboard.press('Control+Alt+0');
    await expect(page.locator('html')).toHaveCSS('zoom', '1');
    await page.getByRole('button', { name: open, exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.setViewportSize({ width: 320, height: 480 });
    await page.evaluate(() => {
      for (let step = 0; step < 10; step++)
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '+', ctrlKey: true, altKey: true }),
        );
    });
    await boundedDialog(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }
});
test('uses the shared monochrome mark and themes host dialogs', async ({ page }) => {
  await page.goto('/');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'mdview' })).toBeVisible();
  const brand = page.locator('.brand-mark .app-logo');
  await expect(brand).toBeVisible();
  const mask = await brand.evaluate((element) => getComputedStyle(element).maskImage);
  expect(mask).not.toBe('none');
  await page.locator('.brand').evaluate((element) => {
    element.style.color = 'rgb(35, 150, 120)';
  });
  await expect(brand).toHaveCSS('background-color', 'rgb(35, 150, 120)');
  const favicon = await page.locator('link[rel="icon"]').evaluate(async (element) => {
    const response = await fetch((element as HTMLLinkElement).href);
    return { ok: response.ok, source: await response.text() };
  });
  expect(favicon.ok).toBe(true);
  expect(favicon.source).toContain('M43 36H29V92H43M85 36H99V92H85');
  expect(favicon.source).not.toContain('#cba6f7');
  await page.getByRole('button', { name: 'Close welcome.md', exact: true }).click();
  const emptyMark = page.locator('.empty-icon .app-logo');
  await expect(emptyMark).toBeVisible();
  expect(await emptyMark.evaluate((element) => getComputedStyle(element).maskImage)).toBe(mask);
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.locator('.settings-panel');
  await expect(panel).toHaveCSS('background-color', 'rgb(239, 241, 245)');
  await expect(panel).toHaveCSS('color', 'rgb(76, 79, 105)');
  await expect(page.getByLabel('Opening delimiter 1', { exact: true })).toHaveCSS(
    'background-color',
    'rgb(230, 233, 239)',
  );
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
  await page.evaluate(() =>
    document.documentElement.style.setProperty('--color-primary', '#157e75'),
  );
  await expect(page.getByRole('button', { name: 'Apply preferences' })).toHaveCSS(
    'background-color',
    'rgb(21, 126, 117)',
  );
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Keyboard shortcuts and help' }).click();
  await expect(page.locator('dialog .modal-box')).toHaveCSS(
    'background-color',
    'rgb(239, 241, 245)',
  );
});

test('keeps long document names within the toolbar', async ({ page }) => {
  await page.goto('/');
  const filename = `${'geometry-'.repeat(24)}notes.md`;
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(markdownFile('# Long filename', filename));
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Long filename' }),
  ).toBeVisible();
  const path = page.locator('.document-path');
  await expect(path.locator('strong')).toHaveAttribute('title', `/${filename}`);
  expect(
    await path.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const toolbar = element.parentElement!.getBoundingClientRect();
      return bounds.right <= toolbar.right && getComputedStyle(element).overflowX === 'hidden';
    }),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reads, navigates, searches, splits and renders offline diagrams', async ({ page }) => {
  await page.goto('/');
  const frame = page.frameLocator('iframe').first();
  await expect(frame.getByRole('heading', { name: 'mdview' })).toBeVisible();
  await expect(frame.locator('.katex')).toBeVisible();
  await frame.getByRole('button', { name: 'Render mermaid diagram' }).click();
  await expect(frame.locator('.diagram svg')).toBeVisible();
  await frame.getByRole('link', { name: 'format gallery' }).click();
  await expect(frame.getByRole('heading', { name: 'Format gallery' })).toBeVisible();
  await frame.getByRole('button', { name: 'Render dot diagram' }).click();
  await expect(frame.locator('.diagram svg').first()).toBeVisible();
  await frame.getByRole('button', { name: 'Render vega-lite diagram' }).click();
  await expect(frame.locator('.vega-embed svg')).toBeVisible();
  await page.getByRole('button', { name: 'Search document' }).click();
  await page.getByRole('textbox', { name: 'Find in document' }).fill('Graphviz');
  await expect(frame.locator('mark[data-search]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Toggle split view' }).click();
  await expect(page.locator('iframe')).toHaveCount(2);
});
test('imports read-only files and enforces script and host isolation', async ({ page }) => {
  await page.goto('/');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'mdview' })).toBeVisible();
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      markdownFile(
        '# Security\n\n<img src="https://example.invalid/leak">\n\n<script>document.body.dataset.executed="yes"; try { parent.document.body.dataset.escaped="yes" } catch { document.body.dataset.isolated="yes" } parent.postMessage({type:"navigate",href:"/stolen.md"},"*");</script>',
      ),
    );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Security' })).toBeVisible();
  expect(await frame.locator('body').getAttribute('data-executed')).toBeNull();
  expect(await page.locator('body').getAttribute('data-escaped')).toBeNull();
  await page
    .getByRole('button', { name: 'Safe preview: trust current document for scripts' })
    .click();
  await page.getByRole('button', { name: 'Enable scripts for this document', exact: true }).click();
  await expect(frame.locator('body')).toHaveAttribute('data-executed', 'yes');
  await expect(frame.locator('body')).toHaveAttribute('data-isolated', 'yes');
  await expect(
    page
      .getByRole('group', { name: 'Open documents' })
      .getByRole('button', { name: 'sample.md', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('body').getAttribute('data-escaped')).toBeNull();
});
test('validates and persists math preferences', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Disable math', exact: true }).click();
  await page.getByRole('button', { name: 'Add delimiter pair' }).click();
  await page.getByRole('button', { name: 'Apply preferences' }).click();
  await expect(page.getByRole('alert')).toContainText('nonempty');
  await page.getByLabel('Opening delimiter 1', { exact: true }).fill('%%');
  await page.getByLabel('Closing delimiter 1', { exact: true }).fill('%%');
  await page.getByLabel('Math mode 1', { exact: true }).selectOption('display');
  await page.getByRole('button', { name: 'Apply preferences' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Opening delimiter 1', { exact: true })).toHaveValue('%%');
  await expect(page.getByLabel('Math mode 1', { exact: true })).toHaveValue('display');
});
test('has no serious accessibility violations in the host shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'mdview' })).toBeVisible();
  const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
});

test('pages large directories and keeps controls available during large-file parsing', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'mdview' })).toBeVisible();
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      Array.from({ length: 1000 }, (_, index) =>
        markdownFile('# Small document', `note-${String(index).padStart(4, '0')}.md`),
      ),
    );
  await page.getByRole('button', { name: 'Toggle explorer' }).click();
  if (!(await page.getByRole('complementary', { name: 'File explorer' }).isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer' }).click();
  const explorer = page.getByRole('complementary', { name: 'File explorer' });
  await expect(explorer.locator('.file-row')).toHaveCount(200);
  await explorer.getByRole('button', { name: /Show 200 more/ }).click();
  await expect(explorer.locator('.file-row')).toHaveCount(400);
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      markdownFile(
        '# Large document\n\n' + 'A paragraph with **bold** and `code`.\n\n'.repeat(28_000),
        'large.md',
      ),
    );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Reading preferences' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Large document' }),
  ).toBeVisible();
});

test('revokes old frame messages while disabling document scripts', async ({ page }) => {
  await page.goto('/');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'mdview' })).toBeVisible();
  const attack =
    '# Trust boundary\n\n<script>document.body.dataset.running="yes";setInterval(()=>parent.postMessage({type:"navigate",href:"/target.md",channel:JSON.parse(document.getElementById("payload").textContent).channel},"*"),1);</script>';
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles([
      markdownFile(attack, 'attack.md'),
      markdownFile('# Unexpected navigation', 'target.md'),
    ]);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Trust boundary' })).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt++) {
    await page
      .getByRole('button', { name: 'Safe preview: trust current document for scripts' })
      .click();
    await page
      .getByRole('button', { name: 'Enable scripts for this document', exact: true })
      .click();
    await expect(frame.locator('body')).toHaveAttribute('data-running', 'yes');
    await page.getByRole('button', { name: 'Scripts enabled: disable document scripts' }).click();
    await expect(frame.locator('body')).not.toHaveAttribute('data-running');
    await expect(frame.getByRole('heading', { name: 'Trust boundary' })).toBeVisible();
    await expect(
      page
        .getByRole('group', { name: 'Open documents' })
        .getByRole('button', { name: 'attack.md', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  }
});

test('updates document theme and independent zoom without rebuilding the preview', async ({
  page,
}) => {
  let workers = 0;
  page.on('worker', () => workers++);
  await page.goto('/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'mdview' })).toBeVisible();
  await frame.locator('html').evaluate((node) => (node.dataset.session = 'preserved'));
  const initialWorkers = workers;
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'latte');
  await expect(frame.locator('html')).toHaveAttribute('data-session', 'preserved');
  await page.getByRole('button', { name: 'Zoom in document', exact: true }).click();
  await expect(page.getByRole('button', { name: /Reset document zoom/ })).toHaveText('110%');
  await expect
    .poll(() =>
      frame.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    )
    .toBeCloseTo(17.6);
  await frame.getByRole('heading', { name: 'mdview' }).click();
  await page.keyboard.press('Control+Shift+Equal');
  await expect(page.getByRole('button', { name: /Reset document zoom/ })).toHaveText('120%');
  await page.keyboard.press('Control+0');
  await expect(page.getByRole('button', { name: /Reset document zoom/ })).toHaveText('100%');
  await frame.locator('html').evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Unidentified',
        code: 'NumpadAdd',
        ctrlKey: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByRole('button', { name: /Reset document zoom/ })).toHaveText('110%');
  await expect
    .poll(() =>
      frame
        .locator('p')
        .first()
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    )
    .toBeCloseTo(17.6);
  await page.keyboard.press('Control+0');

  await page.keyboard.press('Control+Alt+Equal');
  await expect
    .poll(() => page.locator('html').evaluate((node) => Number(node.style.zoom)))
    .toBeCloseTo(1.1);
  await expect
    .poll(() =>
      frame.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    )
    .toBeCloseTo(16);
  await expect(frame.locator('html')).toHaveAttribute('data-session', 'preserved');
  expect(workers).toBe(initialWorkers);
  expect(await frame.locator('html').evaluate((node) => node.style.zoom)).toBe('');
  await expect
    .poll(() =>
      page
        .locator('.app-shell')
        .evaluate((node) => Math.round(node.getBoundingClientRect().height)),
    )
    .toBe(page.viewportSize()!.height);
  await page.keyboard.press('Control+Alt+0');
  await expect.poll(() => page.locator('html').evaluate((node) => Number(node.style.zoom))).toBe(1);
});

test('resizes the explorer by mouse and keyboard and persists its width', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Narrow layouts use an overlay explorer.');
  await page.goto('/');
  const explorer = page.getByRole('complementary', { name: 'File explorer' });
  const divider = page.getByRole('separator', { name: 'Resize explorer' });
  await expect(explorer).toBeVisible();
  const bounds = (await divider.boundingBox())!;
  const initialWidth = (await explorer.boundingBox())!.width;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 150);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 140, bounds.y + 150, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await explorer.boundingBox())!.width)
    .toBeCloseTo(initialWidth + 140, 0);
  await divider.press('ArrowLeft');
  const savedWidth = initialWidth + 140 - 16;
  await expect.poll(async () => (await explorer.boundingBox())!.width).toBeCloseTo(savedWidth, 0);
  await page.reload();
  await expect.poll(async () => (await explorer.boundingBox())!.width).toBeCloseTo(savedWidth, 0);
});

test('renders multiline display delimiters and navigates numbered citations and equations', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'mdview' })).toBeVisible();
  const equation = String.raw`[ \begin{bmatrix}Y_a&I\ O&J_R\end{bmatrix} \begin{bmatrix}\mathbf A\\mathbf B\end{bmatrix}

\begin{bmatrix}\kappa^2\mathbf e_0\\mathbf0\end{bmatrix}. \tag{7} ]`;
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      markdownFile(
        '# Numbers\n\nSee (7) and [1].\n\n' +
          'A paragraph.\n\n'.repeat(35) +
          equation +
          '\n\n$$a^2$$\n\n\\[b^2\\]\n\n## References\n\n[1] An example source.',
      ),
    );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Numbers', exact: true })).toBeVisible();
  await expect(frame.locator('.katex-display')).toHaveCount(3);
  await frame.getByRole('link', { name: '(7)', exact: true }).click();
  await expect(frame.locator('#equation-7')).toBeInViewport();
  await frame.locator('body').evaluate(() => window.scrollTo(0, 0));
  await frame.getByRole('link', { name: '[1]', exact: true }).click();
  await expect(frame.locator('#reference-1')).toBeInViewport();
});

test('defers diagram libraries and prevents document IDs from replacing the runtime', async ({
  page,
}) => {
  await page.goto('/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'mdview' })).toBeVisible();
  expect(
    await frame
      .locator('body')
      .evaluate(() => typeof (window as unknown as { mdviewDiagrams?: unknown }).mdviewDiagrams),
  ).toBe('undefined');
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      markdownFile(
        '# Deferred\n\n<div id="diagram-runtime">document.body.dataset.injected="yes"</div>\n\n```mermaid\nflowchart LR\nA --> B\n```',
      ),
    );
  await expect(frame.getByRole('heading', { name: 'Deferred', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Render mermaid diagram' }).click();
  await expect(frame.locator('.diagram svg')).toBeVisible();
  expect(await frame.locator('body').getAttribute('data-injected')).toBeNull();
});

test('cycles open tabs from the host and document and wraps in both directions', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles([
      markdownFile('# Alpha\n\n[Beta](./beta.md)', 'alpha.md'),
      markdownFile('# Beta\n\n[Gamma](./gamma.md)', 'beta.md'),
      markdownFile('# Gamma', 'gamma.md'),
    ]);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('link', { name: 'Beta', exact: true }).click();
  await frame.getByRole('link', { name: 'Gamma', exact: true }).click();
  await frame.getByRole('heading', { name: 'Gamma', exact: true }).click();
  await page.keyboard.press('Control+Tab');
  await expect(frame.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
  await page.keyboard.press('Control+Shift+Tab');
  await expect(frame.getByRole('heading', { name: 'Gamma', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle table of contents' }).focus();
  await page.keyboard.press('Control+Shift+Tab');
  await expect(frame.getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
  await page.keyboard.press('Control+Tab');
  await expect(frame.getByRole('heading', { name: 'Gamma', exact: true })).toBeVisible();
});

test('fits the reading column to width and changes font size without raster scaling', async ({
  page,
}) => {
  await page.goto('/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'mdview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fit document to width', exact: true }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-fit-width', 'true');
  await expect
    .poll(() =>
      frame
        .locator('main')
        .evaluate((node) => Math.abs(node.getBoundingClientRect().width - window.innerWidth)),
    )
    .toBeLessThan(2);
  await frame.getByRole('heading', { name: 'mdview', exact: true }).click();
  await page.keyboard.press('Control+Equal');
  await expect(frame.locator('html')).toHaveAttribute('data-fit-width', 'false');
  await page.keyboard.press('Control+Equal');
  await expect(frame.locator('html')).toHaveAttribute('data-fit-width', 'true');
  await page.keyboard.press('Control+Shift+Equal');
  await expect
    .poll(() =>
      frame.locator('main').evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    )
    .toBeCloseTo(17.6);
  expect(await frame.locator('html').evaluate((node) => node.style.zoom)).toBe('');
  await page.reload();
  await expect(frame.locator('html')).toHaveAttribute('data-fit-width', 'true');
  await expect
    .poll(() =>
      frame.locator('main').evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    )
    .toBeCloseTo(17.6);
});

test('keeps loading surfaces themed and conceals unpainted document frames', async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const observed: { pending: boolean; color: string }[] = [];
    (window as unknown as { frameStarts: typeof observed }).frameStarts = observed;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLIFrameElement)) continue;
          observed.push({
            pending: node.classList.contains('pending'),
            color: getComputedStyle(node.parentElement!).backgroundColor,
          });
        }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'mdview', exact: true })).toBeVisible();
  await expect(frame.locator('html')).toHaveCSS('background-color', 'rgb(30, 30, 46)');
  await frame.getByRole('link', { name: 'format gallery' }).click();
  await expect(frame.getByRole('heading', { name: 'Format gallery', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await frame.getByRole('link', { name: 'Back to welcome' }).click();
  await expect(frame.getByRole('heading', { name: 'mdview', exact: true })).toBeVisible();
  await expect(frame.locator('html')).toHaveCSS('background-color', 'rgb(239, 241, 245)');
  const starts = await page.evaluate(
    () => (window as unknown as { frameStarts: { pending: boolean; color: string }[] }).frameStarts,
  );
  expect(starts).toHaveLength(3);
  expect(starts.every((start) => start.pending)).toBe(true);
  expect(starts.map((start) => start.color)).toEqual([
    'rgb(30, 30, 46)',
    'rgb(30, 30, 46)',
    'rgb(239, 241, 245)',
  ]);
});

test('uses Catppuccin diagram defaults, preserves authored colors and expands scrollable vectors', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles([
      markdownFile(
        '# Diagrams\n\n```mermaid\nflowchart LR\n' +
          Array.from(
            { length: 14 },
            (_, index) => `N${index}[Node ${index}] --> N${index + 1}[Node ${index + 1}]`,
          ).join('\n') +
          '\n```\n\n```mermaid\nflowchart LR\nA[Custom] --> B[Default]\nstyle A fill:#ff0000,color:#ffffff\n```' +
          '\n\n```dot\ndigraph { A [URL="./target.md"]; A -> B; B [fillcolor="#ff0000"]; }\n```' +
          '\n\n```vega-lite\n{"data":{"values":[{"x":"A","y":2}]},"mark":"bar","encoding":{"x":{"field":"x","type":"nominal"},"y":{"field":"y","type":"quantitative"}}}\n```',
      ),
      markdownFile('# Diagram link target', 'target.md'),
    ]);
  await page.getByRole('button', { name: 'Toggle split view', exact: true }).click();
  const frame = page.frameLocator('iframe').first();
  const render = frame.getByRole('button', { name: 'Render mermaid diagram', exact: true });
  await render.first().click();
  const diagrams = frame.locator('section.diagram');
  const first = diagrams.nth(0);
  await expect(first.locator('svg')).toBeVisible();
  await expect(first.locator('.node rect').first()).toHaveCSS('fill', 'rgb(49, 50, 68)');
  await expect
    .poll(() =>
      first.locator('.diagram-viewport').evaluate((node) => node.scrollWidth > node.clientWidth),
    )
    .toBe(true);
  await first.getByRole('button', { name: 'Expand diagram', exact: true }).click();
  const dialog = frame.getByRole('dialog', { name: 'mermaid diagram', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.preview-pane').first()).toHaveClass(/expanded/);
  await expect
    .poll(async () => (await page.locator('iframe').first().boundingBox())!.width)
    .toBeGreaterThan(page.viewportSize()!.width - 5);
  await expect
    .poll(() =>
      dialog.locator('.diagram-viewport').evaluate((node) => node.scrollWidth > node.clientWidth),
    )
    .toBe(true);
  await dialog.locator('.diagram-viewport').focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => dialog.locator('.diagram-viewport').evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  await page.keyboard.press('Control+Alt+Equal');
  await expect
    .poll(async () => (await page.locator('iframe').first().boundingBox())!.width)
    .toBeGreaterThan(page.viewportSize()!.width - 5);
  await expect
    .poll(() =>
      dialog.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return (
          bounds.right <= window.innerWidth + 1 &&
          bounds.bottom <= window.innerHeight + 1 &&
          Math.abs(bounds.width - window.innerWidth * 0.75) <= 1 &&
          Math.abs(bounds.height - window.innerHeight * 0.8) <= 1
        );
      }),
    )
    .toBe(true);
  await page.keyboard.press('Control+Alt+0');
  await dialog.getByRole('button', { name: 'Close diagram', exact: true }).click();
  await expect(page.locator('.preview-pane').first()).not.toHaveClass(/expanded/);
  await expect(first.locator('svg')).toBeVisible();
  await first.getByRole('button', { name: 'Expand diagram', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await diagrams
    .nth(1)
    .getByRole('button', { name: 'Render mermaid diagram', exact: true })
    .click();
  await expect(diagrams.nth(1).locator('.node rect').first()).toHaveCSS('fill', 'rgb(255, 0, 0)');
  await diagrams.nth(2).getByRole('button', { name: 'Render dot diagram', exact: true }).click();
  await expect(diagrams.nth(2).locator('.node ellipse').nth(0)).toHaveAttribute('fill', '#313244');
  await expect(diagrams.nth(2).locator('.node ellipse').nth(1)).toHaveAttribute('fill', '#ff0000');
  await diagrams
    .nth(3)
    .getByRole('button', { name: 'Render vega-lite diagram', exact: true })
    .click();
  await expect(diagrams.nth(3).locator('.mark-rect.role-mark path').first()).toHaveAttribute(
    'fill',
    '#cba6f7',
  );
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await first.getByRole('button', { name: 'Update diagram theme', exact: true }).click();
  await expect(first.locator('.node rect').first()).toHaveCSS('fill', 'rgb(204, 208, 218)');
  await diagrams.nth(2).getByRole('button', { name: 'Expand diagram', exact: true }).click();
  await frame.locator('.diagram-dialog a').first().click();
  await expect(
    frame.getByRole('heading', { name: 'Diagram link target', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.preview-pane.expanded')).toHaveCount(0);
});

test('keeps fitted content inside the pane while wide blocks scroll locally', async ({ page }) => {
  await page.goto('/');
  const wideExpression = String.raw`\begin{bmatrix}${Array.from({ length: 60 }, (_, index) => `x_{${index}}`).join(' & ')}\end{bmatrix}`;
  const source = [
    '# Width regression',
    'A long paragraph with ' + 'words that should wrap naturally. '.repeat(40),
    String.raw`Inline math: \( ${wideExpression} \) followed by text.`,
    `$$\n${wideExpression}\n$$`,
    '```text\n' + 'wide code '.repeat(100) + '\n```',
    '| Column | Value |\n| --- | --- |\n| Example | ' + 'unbreakable'.repeat(100) + ' |',
    '```mermaid\nflowchart LR\n' +
      Array.from({ length: 15 }, (_, index) => `A${index} --> A${index + 1}`).join('\n') +
      '\n```',
  ].join('\n\n');
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(markdownFile(source));
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Width regression' })).toBeVisible();
  await expect(frame.locator('.math > .katex')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fit document to width', exact: true }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-fit-width', 'true');
  await frame.getByRole('button', { name: 'Render mermaid diagram' }).click();
  await expect(frame.locator('.diagram svg')).toBeVisible();
  const overflow = () =>
    frame.locator('html').evaluate((root) => ({
      viewport: window.innerWidth,
      page: root.scrollWidth,
      overflowing: [...document.querySelectorAll('main > *')]
        .filter((node) => node.getBoundingClientRect().right > window.innerWidth)
        .map((node) => node.tagName),
    }));
  expect(await overflow()).toMatchObject({ page: (await overflow()).viewport, overflowing: [] });
  await frame.getByRole('heading', { name: 'Width regression' }).click();
  for (let index = 0; index < 5; index++) await page.keyboard.press('Control+Shift+Equal');
  await expect(page.getByRole('button', { name: /Reset document zoom/ })).toHaveText('150%');
  expect(await overflow()).toMatchObject({ page: (await overflow()).viewport, overflowing: [] });
  const diagram = frame.locator('.diagram-viewport');
  expect(await diagram.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  const inlineMath = frame.locator('.math');
  expect(await inlineMath.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await inlineMath.evaluate((node) => (node.scrollLeft = 100));
  expect(await inlineMath.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('Control+Alt+Equal');
  await expect.poll(() => page.locator('html').evaluate((node) => node.style.zoom)).toBe('1.1');
  expect(await overflow()).toMatchObject({ page: (await overflow()).viewport, overflowing: [] });
  await page.getByRole('button', { name: 'Toggle split view' }).click();
  await expect(page.locator('iframe')).toHaveCount(2);
  for (const index of [0, 1]) {
    const pane = page.frameLocator('iframe').nth(index);
    await expect(pane.getByRole('heading', { name: 'Width regression' })).toBeVisible();
    expect(await pane.locator('html').evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(
      0,
    );
  }
});

test('tracks the actual pane viewport as UI zoom, panels and window size change', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      markdownFile(
        [
          '# Dynamic width',
          'Geometry dimensions and coordinate conversions. '.repeat(30),
          String.raw`Lengths use \(x_{mm}=1000x_m\), and inclined axes use \(L=|s|\sqrt{1+g^2}\).`,
          '~~~sh\ncommand --input ' + 'models/geometry/'.repeat(30) + 'input.json\n~~~',
        ].join('\n\n'),
      ),
    );
  const frame = page.frameLocator('iframe').first();
  await expect(frame.getByRole('heading', { name: 'Dynamic width' })).toBeVisible();
  await frame.locator('html').evaluate((node) => (node.dataset.session = 'preserved'));
  await page.getByRole('button', { name: 'Fit document to width', exact: true }).click();
  const originalCode = await frame.locator('pre code').textContent();
  async function expectFits(index = 0) {
    const pane = page.frameLocator('iframe').nth(index);
    await expect
      .poll(() =>
        pane
          .locator('main')
          .evaluate((node) => node.getBoundingClientRect().right - window.innerWidth),
      )
      .toBeLessThanOrEqual(1);
    const bounds = await page.locator('iframe').nth(index).boundingBox();
    expect(bounds).not.toBeNull();
    const contentWidth = await pane
      .locator('main')
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(contentWidth).toBeLessThanOrEqual(bounds!.width + 1);
    await expect(pane.locator('html')).toHaveAttribute('data-fit-width', 'true');
    expect(
      await pane.locator('pre').evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await pane
        .locator('.math')
        .evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)),
    ).toBe(true);
    expect(await pane.locator('pre code').textContent()).toBe(originalCode);
  }
  for (const steps of [-5, 5, 10]) {
    await page.keyboard.press('Control+Alt+0');
    for (let step = 0; step < Math.abs(steps); step++)
      await page.keyboard.press(steps < 0 ? 'Control+Alt+Minus' : 'Control+Alt+Equal');
    await expectFits();
  }
  for (const name of ['Toggle table of contents', 'Toggle explorer', 'Toggle split view']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expectFits();
  }
  await expectFits(1);
  for (const width of [900, 640, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expectFits();
    await expectFits(1);
  }
  await expect(frame.locator('html')).toHaveAttribute('data-session', 'preserved');
});

test('preserves Mermaid node and edge labels with SVG-only sanitization', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      markdownFile(
        '# Labels\n\n```mermaid\n%%{init: {"htmlLabels": true}}%%\nflowchart LR\nA[Open document] -->|Next step| B[Read preview]\n```',
      ),
    );
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Render mermaid diagram', exact: true }).click();
  const output = frame.locator('.diagram-output');
  await expect(output.locator('.node').first()).toContainText('Open document');
  await expect(output.locator('.node').nth(1)).toContainText('Read preview');
  await expect(output.locator('.edgeLabel').first()).toContainText('Next step');
  await expect(output.locator('foreignObject')).toHaveCount(0);
  expect(
    await output
      .locator('text')
      .evaluateAll((labels) =>
        labels.every((label) => (label as SVGTextElement).getBBox().width > 0),
      ),
  ).toBe(true);
});

test('search preserves SVG and mathematics while highlighting prose and code', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      markdownFile(
        '# Search\n\nNeedle in prose.\n\n`Needle in code`\n\n' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="5" y="40">Needle</text></svg>\n\n' +
          String.raw`\(\text{Needle}\)`,
      ),
    );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  const svg = frame.locator('svg');
  const math = frame.locator('.katex');
  const originalSvg = await svg.innerHTML();
  const originalMath = await math.innerHTML();
  const originalWidth = await svg
    .locator('text')
    .evaluate((node) => (node as SVGTextElement).getBBox().width);
  await page.getByRole('button', { name: 'Search document', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find in document', exact: true }).fill('Needle');
  await expect(frame.locator('mark[data-search]')).toHaveCount(2);
  expect(await svg.innerHTML()).toBe(originalSvg);
  expect(await math.innerHTML()).toBe(originalMath);
  expect(
    await svg.locator('text').evaluate((node) => (node as SVGTextElement).getBBox().width),
  ).toBe(originalWidth);
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await expect(frame.locator('mark[data-search]')).toHaveCount(0);
  expect(await svg.innerHTML()).toBe(originalSvg);
});

test('consumes heading navigation and restores tab scroll positions', async ({ page }) => {
  await page.goto('/');
  const paragraphs = 'A paragraph.\n\n'.repeat(50);
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles([
      markdownFile(
        '# Alpha\n\n[Beta](./beta.md)\n\n' + paragraphs + '## Shared\n\n' + paragraphs,
        'alpha.md',
      ),
      markdownFile('# Beta\n\n' + paragraphs + '## Shared\n\n' + paragraphs, 'beta.md'),
    ]);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('link', { name: 'Beta', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
  await page.locator('.tab-select').filter({ hasText: 'alpha.md' }).click();
  await expect(frame.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
  const outline = page.getByRole('complementary', { name: 'Table of contents' });
  if (!(await outline.isVisible()))
    await page.getByRole('button', { name: 'Toggle table of contents', exact: true }).click();
  for (let click = 0; click < 2; click++) {
    await page.locator('.outline-link').filter({ hasText: 'Shared' }).click();
    await expect.poll(() => frame.locator('html').evaluate(() => scrollY)).toBeGreaterThan(500);
    await page.evaluate(() => {
      (window as unknown as { scrollRecorded: boolean }).scrollRecorded = false;
      const listener = (event: MessageEvent) => {
        if (
          event.source === document.querySelector('iframe')?.contentWindow &&
          event.data?.type === 'scroll' &&
          event.data.y === 0
        ) {
          (window as unknown as { scrollRecorded: boolean }).scrollRecorded = true;
          window.removeEventListener('message', listener);
        }
      };
      window.addEventListener('message', listener);
    });
    await frame.locator('html').evaluate(() => scrollTo(0, 0));
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { scrollRecorded: boolean }).scrollRecorded),
      )
      .toBe(true);
  }
  await page.locator('.tab-select').filter({ hasText: 'beta.md' }).click();
  await expect(frame.getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
  await expect.poll(() => frame.locator('html').evaluate(() => scrollY)).toBe(0);
  await page.locator('.tab-select').filter({ hasText: 'alpha.md' }).click();
  await expect(frame.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
  await expect.poll(() => frame.locator('html').evaluate(() => scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: /Allow network resources/ }).check();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('iframe')).not.toHaveClass(/pending/);
  await expect.poll(() => frame.locator('html').evaluate(() => scrollY)).toBe(0);
});

test('keeps generated reference targets distinct from headings and authored HTML IDs', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      markdownFile(
        '# Equation 7\n\n# Reference 1\n\n' +
          '<div id="equation-7-1">Authored equation ID</div>\n\n<div id="reference-1-1">Authored reference ID</div>\n\n' +
          'See (7), [1], and [2].\n\n' +
          'Paragraph.\n\n'.repeat(30) +
          '$$x \\tag{7}$$\n\n[1] Author one.\n\n## References\n\n2. Author two.',
      ),
    );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Equation 7', exact: true })).toBeVisible();
  expect(
    await frame.locator('[id]').evaluateAll((nodes) => {
      const ids = nodes.map((node) => node.id);
      return ids.length === new Set(ids).size;
    }),
  ).toBe(true);
  await expect(frame.getByRole('heading', { name: 'Equation 7', exact: true })).toHaveAttribute(
    'id',
    'equation-7',
  );
  await expect(frame.getByRole('link', { name: '(7)', exact: true })).toHaveAttribute(
    'href',
    '#equation-7-2',
  );
  await expect(frame.getByRole('link', { name: '[1]', exact: true })).toHaveAttribute(
    'href',
    '#reference-1-2',
  );
  await expect(frame.getByRole('link', { name: '[2]', exact: true })).toHaveAttribute(
    'href',
    '#reference-2',
  );
  await frame.getByRole('link', { name: '(7)', exact: true }).click();
  await expect(frame.locator('.equation-target')).toBeInViewport();
  await frame.locator('html').evaluate(() => scrollTo(0, 0));
  await frame.getByRole('link', { name: '[1]', exact: true }).click();
  await expect(frame.locator('p#reference-1-2')).toBeInViewport();
});

test('uses readable syntax colors in both document themes', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(
      markdownFile(
        '# Code\n\n```json\n{"property": 1, "enabled": true, "text": "example"}\n```\n\n```html\n<div class="example">Text</div>\n```\n\n```js\n// Comment\nconst example = Math.max(1, 2);\n```\n\n```diff\n+ added\n- deleted\n```',
      ),
    );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Code', exact: true })).toBeVisible();
  for (const theme of ['mocha', 'latte']) {
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
    const contrast = await frame.locator('pre [class^="hljs-"]').evaluateAll((tokens) => {
      function luminance(color: string) {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      return tokens
        .filter((token) => token.textContent?.trim())
        .map((token) => {
          let background = token;
          while (getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)')
            background = background.parentElement!;
          const light = luminance(getComputedStyle(background).backgroundColor);
          const dark = luminance(getComputedStyle(token).color);
          return {
            token: token.className,
            ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
          };
        });
    });
    expect(contrast.length).toBeGreaterThan(10);
    expect(contrast.filter((token) => token.ratio < 4.5)).toEqual([]);
    if (theme === 'mocha')
      await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click();
  }
});

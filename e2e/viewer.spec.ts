import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
const markdownFile = (text: string, name = 'sample.md') => ({
  name,
  mimeType: 'text/markdown',
  buffer: Buffer.from(text),
});
async function openSettingsTab(page: Page, tab: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Reading preferences' })
    .getByRole('tab', { name: tab, exact: true })
    .click();
}

async function openCommandPalette(page: Page) {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
}

async function ensureExplorer(page: Page) {
  if (!(await page.getByRole('complementary', { name: 'File explorer' }).isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer' }).click();
}

async function toggleTheme(page: Page) {
  const current = await page.locator('.app-shell').getAttribute('data-theme');
  const command = current === 'latte' ? 'Use dark theme' : 'Use light theme';
  await openCommandPalette(page);
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  await search.fill(`>${command}`);
  await dialog.getByRole('option', { name: command, exact: false }).click();
  await expect(dialog).toHaveCount(0);
}

for (const mode of ['pointer', 'keyboard'] as const) {
  test(`prepares Markdown on ${mode} file selection`, async ({ page }) => {
    await page.goto('/');
    await expect(
      page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' }),
    ).toBeVisible();
    await page.evaluate(() => {
      const original = window.Worker;
      (window as unknown as { parserWorkers: number }).parserWorkers = 0;
      window.Worker = new Proxy(original, {
        construct(target, args) {
          (window as unknown as { parserWorkers: number }).parserWorkers++;
          return Reflect.construct(target, args);
        },
      });
    });
    if (!(await page.getByRole('complementary', { name: 'File explorer' }).isVisible()))
      await page.getByRole('button', { name: 'Toggle explorer' }).click();
    const file = page.locator('.file-row').filter({ hasText: 'gallery.md' });
    if (mode === 'pointer') await file.dispatchEvent('pointerenter', { pointerType: 'mouse' });
    else await file.focus();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { parserWorkers: number }).parserWorkers),
      )
      .toBe(1);
    await file.click();
    await expect(
      page.frameLocator('iframe').getByRole('heading', { name: 'Format gallery' }),
    ).toBeVisible();
  });
}

test('scrolls the preview when WebKit retargets wheel input to the host', async ({ page }) => {
  await page.goto('/');
  const frame = page.frameLocator('.preview-pane iframe');
  await expect(frame.getByRole('heading', { name: 'Papyri' })).toBeVisible();
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(markdownFile(`# Wheel document\n\n${'Paragraph.\n\n'.repeat(200)}`, 'wheel.md'));
  await expect(frame.getByRole('heading', { name: 'Wheel document' })).toBeVisible();
  const iframe = page.locator('.preview-pane iframe');
  const bounds = (await iframe.boundingBox())!;
  await iframe.dispatchEvent('wheel', {
    deltaY: 600,
    clientX: bounds.x + bounds.width / 2,
    clientY: bounds.y + bounds.height / 2,
    bubbles: true,
    cancelable: true,
  });
  await expect.poll(() => frame.locator('html').evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('loads the diagram runtime only on demand and retries a failed load', async ({ page }) => {
  let requests = 0;
  await page.route('**/diagrams.js', async (route) => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.goto('/');
  const frame = page.frameLocator('iframe');
  const render = frame.getByRole('button', { name: 'Render mermaid diagram' });
  await expect(render).toBeVisible();
  expect(requests).toBe(0);
  await render.click();
  await expect(frame.getByText(/Could not load bundled renderer/)).toBeVisible();
  await frame.getByRole('button', { name: 'Retry diagram' }).click();
  await expect(frame.locator('.diagram svg')).toBeVisible();
  expect(requests).toBe(2);
});

test('shows source editing controls only while a document is open', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Close welcome.md' }).click();
  const editSource = page.getByRole('button', { name: 'Edit source' });
  await expect(editSource).toHaveCount(0);
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles(markdownFile('# Notes\n', 'notes.md'));
  await expect(editSource).toBeVisible();
  await page.getByRole('button', { name: 'Close notes.md' }).click();
  await expect(editSource).toHaveCount(0);
});

test('uses Catppuccin file icons in tabs and the command palette', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import selected files', { exact: true }).setInputFiles([
    markdownFile('# Notes\n', 'notes.md'),
    {
      name: 'paper.tex',
      mimeType: 'text/x-tex',
      buffer: Buffer.from('\\documentclass{article}\n'),
    },
  ]);
  const tabs = page.getByRole('group', { name: 'Open documents' }).locator('.tab-select');
  await ensureExplorer(page);
  await page.locator('.file-row').filter({ hasText: 'paper.tex' }).click();
  await expect(tabs).toHaveCount(2);
  const markdownTab = tabs.filter({ hasText: 'notes.md' });
  const latexTab = tabs.filter({ hasText: 'paper.tex' });
  for (const tab of [markdownTab, latexTab]) {
    expect(
      await tab.locator('.file-type-icon svg path[stroke*="--vscode-ctp"]').count(),
    ).toBeGreaterThan(0);
  }
  const markdownStroke = await markdownTab
    .locator('.file-type-icon svg path')
    .first()
    .getAttribute('stroke');
  const latexStroke = await latexTab
    .locator('.file-type-icon svg path')
    .first()
    .getAttribute('stroke');
  expect(markdownStroke).not.toBe(latexStroke);

  await openCommandPalette(page);
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  await search.fill('notes');
  const fileOption = dialog.getByRole('option', { name: /notes\.md/ }).first();
  await expect(fileOption.locator('.file-type-icon svg')).toHaveCount(1);
});

test('reopens the most recent project when launched at home', async ({ page }) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce'),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'papyri.recentFolders',
      JSON.stringify({
        version: 1,
        folders: [{ path: '/work/project', lastFile: '/work/project/notes.md' }],
      }),
    );
    Object.defineProperty(window, '__PAPYRI_HOME__', { value: '/home/user' });
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === 'initial_path')
            return { path: '/home/user', directory: true, explicit: false };
          if (command === 'list_directory') {
            if (args.path === '/work/project')
              return [
                {
                  name: 'notes.md',
                  path: '/work/project/notes.md',
                  directory: false,
                  symlink: false,
                },
              ];
            return [];
          }
          if (command === 'read_document')
            return { text: '# Restored project\n\nNotes', stamp: '1' };
          if (command === 'document_stamp') return '1';
          if (command === 'declarative_preferences') return null;
          if (command === 'latex_engines' || command === 'typst_binary') return [];
          throw new Error(`Unexpected native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Restored project' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Open documents' })
      .locator('.tab-select')
      .filter({ hasText: 'notes.md' }),
  ).toBeVisible();
});

test('searches nested files and commands with the keyboard palette', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import selected folder').setInputFiles('examples/showcase');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  await expect(search).toBeFocused();
  await search.fill('ltx-sct');
  await expect(dialog.getByRole('option', { name: /latex-section\.tex/ })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(
    accessibility.violations.filter((item) => ['serious', 'critical'].includes(item.impact!)),
  ).toEqual([]);
  await search.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.frameLocator('iframe').locator('pre code')).toContainText('section');
  await page.frameLocator('iframe').locator('body').press('Control+k');
  await expect(search).toBeFocused();
  await search.fill('>sett');
  await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Reading preferences' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await openCommandPalette(page);
  await search.fill('>toggle');
  await search.press('ArrowDown');
  await expect(
    dialog.getByRole('listbox', { name: 'Search results' }).getByRole('option', { selected: true }),
  ).toHaveAttribute('id', 'palette-option-1');
  await search.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('navigates headings and tabs, remembers choices, and searches document text', async ({
  page,
}) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  const openPalette = () => openCommandPalette(page);
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Mathematics' }),
  ).toBeVisible();
  await openPalette();
  await search.fill('@math');
  await expect(
    dialog.getByRole('option', { name: /Mathematics/ }).locator('svg.lucide-list'),
  ).toHaveCount(1);
  await dialog.getByRole('option', { name: /Mathematics/ }).click();
  await expect
    .poll(() =>
      page
        .frameLocator('iframe')
        .locator('html')
        .evaluate(() => scrollY),
    )
    .toBeGreaterThan(100);
  await page.frameLocator('iframe').getByRole('link', { name: 'format gallery' }).click();
  await expect(page.locator('.tab-select')).toHaveCount(2);
  await openPalette();
  await search.fill('%welc');
  await expect(
    dialog.getByRole('option', { name: /welcome\.md/ }).locator('.file-type-icon svg'),
  ).toHaveCount(1);
  await dialog.getByRole('option', { name: /welcome\.md/ }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' })).toBeVisible();
  await openPalette();
  await expect(
    dialog.getByRole('listbox', { name: 'Search results' }).getByRole('option').first(),
  ).toContainText('welcome.md');
  await search.fill('?Gaussian integral');
  await expect(
    dialog.getByRole('option', { name: /welcome\.md:.*Gaussian integral/ }),
  ).toBeVisible();
  await expect(
    dialog
      .getByRole('option', { name: /welcome\.md:.*Gaussian integral/ })
      .locator('svg.lucide-file-search'),
  ).toHaveCount(1);
  await dialog.getByRole('option', { name: /welcome\.md:.*Gaussian integral/ }).click();
  await expect(page.getByRole('textbox', { name: 'Find in document' })).toHaveValue(
    'Gaussian integral',
  );
  await expect(page.frameLocator('iframe').locator('mark[data-search]').first()).toContainText(
    'Gaussian integral',
  );
});

test('changes the palette search scope and filters results by type', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import selected folder').setInputFiles('examples/showcase');
  if (!(await page.getByLabel('Directory path').isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer' }).click();
  await page.getByLabel('Directory path').fill('/showcase/parts');
  await page.getByLabel('Directory path').press('Enter');
  await openCommandPalette(page);
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  await search.fill('markdown.md');
  await expect(dialog.getByText('No matches.')).toBeVisible();
  await dialog.getByRole('radio', { name: 'Parent' }).click();
  await expect(dialog.getByRole('option', { name: /markdown\.md/ })).toBeVisible();
  await dialog.getByRole('radio', { name: 'Workspace' }).click();
  await expect(dialog.getByRole('option', { name: /markdown\.md/ })).toBeVisible();
  await search.fill('');
  await dialog.getByRole('button', { name: 'Commands' }).click();
  await expect(dialog.getByRole('button', { name: 'Commands' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByRole('option', { name: /Open settings/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Files' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('filters by result type, syncs prefixes, and corrects spelling', async ({ page }) => {
  await page.goto('/');
  await openCommandPalette(page);
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  await expect(dialog.getByRole('radio', { name: 'Folder' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(dialog.getByRole('button', { name: 'Commands' }).locator('kbd')).toHaveText('>');
  await expect(dialog.getByRole('button', { name: 'Pages' }).locator('kbd')).toHaveText('#');
  await dialog.getByRole('button', { name: 'Files' }).click();
  await expect(dialog.getByRole('button', { name: 'Files' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByRole('option', { name: /welcome\.md/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Open settings/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Commands' }).click();
  await expect(dialog.getByRole('option', { name: /Open settings/ })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /welcome\.md/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Files' }).click();
  await search.fill('@math');
  await expect(dialog.getByRole('button', { name: 'Headings' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByRole('option', { name: /Mathematics/ })).toBeVisible();
  await search.fill('');
  await dialog.getByRole('button', { name: 'Recent' }).click();
  await expect(dialog.getByRole('button', { name: 'Recent' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await search.fill('>settngs');
  const correction = dialog.getByRole('option', { name: /Did you mean .*settings/ });
  await expect(correction).toBeVisible();
  await correction.click();
  await expect(search).toHaveValue('>settings');
  await expect(dialog.getByRole('option', { name: /Open settings/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'All' }).click();
  await search.fill('recieve');
  const dictionaryCorrection = dialog.getByRole('option', { name: /Did you mean .*receive/ });
  await expect(dictionaryCorrection).toBeVisible({ timeout: 15_000 });
  await dictionaryCorrection.click();
  await expect(search).toHaveValue('receive');
});

test('shows recently opened folders and navigates back to them', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import selected folder').setInputFiles('examples/showcase');
  const pathInput = page.getByLabel('Directory path');
  if (!(await pathInput.isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer' }).click();
  await page.locator('.file-row').filter({ hasText: 'README.md' }).click();
  const frame = page.frameLocator('iframe');
  await expect(
    frame.getByRole('heading', { name: 'Papyri feature showcase', exact: true }),
  ).toBeVisible();
  if (!(await pathInput.isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer' }).click();
  await pathInput.fill('/showcase/parts');
  await pathInput.press('Enter');
  await expect(pathInput).toHaveValue('/showcase/parts');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  await search.fill('~');
  await expect(dialog.getByRole('button', { name: 'Recent' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const showcase = dialog.getByRole('option', { name: /^showcase/ });
  const parts = dialog.getByRole('option', { name: /^parts/ });
  await expect(showcase).toBeVisible();
  await expect(parts).toBeVisible();
  await showcase.click();
  await expect(dialog).toHaveCount(0);
  if (!(await pathInput.isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer' }).click();
  await expect(pathInput).toHaveValue('/showcase');
});

test('shows recent folders in a centered dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Import selected folder').setInputFiles('examples/showcase');
  if (!(await page.getByLabel('Directory path').isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer' }).click();
  await page.locator('.file-row').filter({ hasText: 'README.md' }).click();
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Papyri feature showcase' }),
  ).toBeVisible();
  if (!(await page.getByLabel('Directory path').isVisible()))
    await page.getByRole('button', { name: 'Toggle explorer' }).click();
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recent folders' });
  await expect(dialog).toBeVisible();
  const box = await dialog.locator('.recent-dialog').boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(20);
  expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(20);
  await dialog.getByRole('button', { name: 'Close recent folders' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /showcase/ })).toBeVisible();
  await dialog.getByRole('button', { name: /showcase/ }).click();
  await expect(dialog).toHaveCount(0);
});

test('keeps the palette within the viewport and gives commands distinct icons', async ({
  page,
}) => {
  await page.goto('/');
  for (const viewport of [
    { width: 1280, height: 860 },
    { width: 390, height: 640 },
    { width: 320, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    for (const zoom of [50, 100, 200]) {
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
      await openCommandPalette(page);
      const dialog = page.getByRole('dialog', { name: 'Command palette' });
      const panel = dialog.locator('.palette-panel');
      const bounds = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const view = window.visualViewport;
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          viewLeft: view?.offsetLeft ?? 0,
          viewTop: view?.offsetTop ?? 0,
          viewRight: (view?.offsetLeft ?? 0) + Math.min(innerWidth, view?.width ?? innerWidth),
          viewBottom: (view?.offsetTop ?? 0) + Math.min(innerHeight, view?.height ?? innerHeight),
          width: rect.width,
          height: rect.height,
        };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(bounds.viewLeft - 2);
      expect(bounds.top).toBeGreaterThanOrEqual(bounds.viewTop - 2);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewRight + 2);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewBottom + 2);
      const viewportWidth = bounds.viewRight - bounds.viewLeft;
      const viewportHeight = bounds.viewBottom - bounds.viewTop;
      const expectedWidth = Math.min(960, viewportWidth * 0.7);
      const expectedHeight = Math.min(760, viewportHeight * 0.6);
      expect(Math.abs(bounds.width - expectedWidth)).toBeLessThanOrEqual(2);
      expect(Math.abs(bounds.height - expectedHeight)).toBeLessThanOrEqual(2);
      expect(
        Math.abs((bounds.left + bounds.right) / 2 - (bounds.viewLeft + bounds.viewRight) / 2),
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs((bounds.top + bounds.bottom) / 2 - (bounds.viewTop + bounds.viewBottom) / 2),
      ).toBeLessThanOrEqual(2);
      const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
      await expect(search).toBeVisible();
      await search.fill('>');
      const options = dialog.getByRole('listbox', { name: 'Search results' }).getByRole('option');
      expect(await options.count()).toBeGreaterThan(10);
      expect(
        await options.evaluateAll((items) =>
          items.every((item) => item.querySelector('svg[aria-hidden="true"]')),
        ),
      ).toBe(true);
      await expect(
        dialog.getByRole('option', { name: /Open folder/ }).locator('svg.lucide-folder-open'),
      ).toHaveCount(1);
      await expect(
        dialog.getByRole('option', { name: /Open settings/ }).locator('svg.lucide-settings'),
      ).toHaveCount(1);
      await search.press('ArrowUp');
      await expect(
        dialog
          .getByRole('listbox', { name: 'Search results' })
          .getByRole('option', { selected: true }),
      ).toBeInViewport();
      await search.press('Escape');
    }
  }
});

test('configures palette bounds and document fonts from tabbed settings', async ({ page }) => {
  await page.goto('/');
  await openSettingsTab(page, 'Appearance');
  const dialog = page.getByRole('dialog', { name: 'Reading preferences' });
  const appearance = dialog.getByRole('tab', { name: 'Appearance', exact: true });
  const reading = dialog.getByRole('tab', { name: 'Reading', exact: true });
  await expect(appearance).toHaveAttribute('aria-selected', 'true');
  await appearance.focus();
  await page.keyboard.press('ArrowRight');
  await expect(reading).toHaveAttribute('aria-selected', 'true');
  await expect(reading).toBeFocused();

  const textFont = dialog.getByLabel('Markdown text font');
  await textFont.fill("'Noto Serif', Georgia, serif");
  await textFont.blur();
  const codeFont = dialog.getByLabel('Markdown code font');
  await codeFont.fill("'JetBrains Mono', ui-monospace, monospace");
  await codeFont.blur();
  const mathFont = dialog.getByLabel('Math font');
  await mathFont.fill("'STIX Two Math', serif");
  await mathFont.blur();
  const frame = page.frameLocator('iframe');
  await expect
    .poll(() => frame.locator('body').evaluate((element) => getComputedStyle(element).fontFamily))
    .toContain('Noto Serif');
  await expect
    .poll(() =>
      frame
        .locator('code')
        .first()
        .evaluate((element) => getComputedStyle(element).fontFamily),
    )
    .toContain('JetBrains Mono');
  await expect
    .poll(() =>
      frame
        .locator('.katex')
        .first()
        .evaluate((element) => getComputedStyle(element).fontFamily),
    )
    .toContain('STIX Two Math');

  await appearance.click();
  const interfaceFont = dialog.getByLabel('Interface font');
  await interfaceFont.fill('Georgia, serif');
  await interfaceFont.blur();
  await expect(page.locator('html')).toHaveCSS('font-family', /Georgia/);
  for (const [label, value] of [
    ['Command palette width percentage', '70'],
    ['Command palette height percentage', '70'],
    ['Command palette maximum width in pixels', '800'],
    ['Command palette maximum height in pixels', '600'],
  ] as const) {
    const input = dialog.getByLabel(label);
    await input.fill(value);
    await input.blur();
  }
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  await openCommandPalette(page);
  const palette = page.getByRole('dialog', { name: 'Command palette' }).locator('.palette-panel');
  const viewport = page.viewportSize()!;
  const box = await palette.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - Math.min(800, viewport.width * 0.7))).toBeLessThanOrEqual(2);
  expect(Math.abs(box!.height - Math.min(600, viewport.height * 0.7))).toBeLessThanOrEqual(2);
  await page.keyboard.press('Escape');

  await page.reload();
  await openSettingsTab(page, 'Reading');
  await expect(page.getByLabel('Markdown text font')).toHaveValue("'Noto Serif', Georgia, serif");
  await expect(page.getByLabel('Markdown code font')).toHaveValue(
    "'JetBrains Mono', ui-monospace, monospace",
  );
  await expect(page.getByLabel('Math font')).toHaveValue("'STIX Two Math', serif");
  await expect(page.locator('html')).toHaveCSS('font-family', /Georgia/);
});

test('runs contextual commands for tabs, zoom, appearance, and folders', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  const run = async (label: string) => {
    await openCommandPalette(page);
    await search.fill(`>${label}`);
    await dialog.getByRole('option', { name: label, exact: false }).click();
    await expect(dialog).toHaveCount(0);
  };
  await run('Zoom in document');
  await expect(page.getByRole('button', { name: /Reset document zoom/ })).toHaveText('110%');
  await run('Reset document zoom');
  await expect(page.getByRole('button', { name: /Reset document zoom/ })).toHaveText('100%');
  await run('Use light theme');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'latte');
  await run('Allow external resources');
  await openSettingsTab(page, 'Documents');
  await expect(page.getByLabel('Allow network resources')).toBeChecked();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await run('Block external resources');
  await openSettingsTab(page, 'Documents');
  await expect(page.getByLabel('Allow network resources')).not.toBeChecked();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.frameLocator('iframe').getByRole('link', { name: 'format gallery' }).click();
  await expect(page.locator('.tab-select')).toHaveCount(2);
  await run('Previous tab');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' })).toBeVisible();
  await run('Close other tabs');
  await expect(page.locator('.tab-select')).toHaveCount(1);
  await openCommandPalette(page);
  await search.fill('>next tab');
  await expect(dialog.getByRole('option', { name: /Next tab/ })).toHaveCount(0);
  await search.fill('>preferences');
  await expect(dialog.getByRole('option', { name: /Open settings/ })).toBeVisible();
  await search.press('Escape');
});

test('selects a LaTeX engine from the palette in the desktop app', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'initial_path') return { path: '/', directory: true };
          if (command === 'list_directory' || command === 'latex_engines') return [];
          if (command === 'typst_binary') return null;
          throw new Error(`Unexpected native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await openCommandPalette(page);
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await dialog.getByRole('combobox', { name: 'Search files and commands' }).fill('>xelatex');
  await dialog.getByRole('option', { name: 'Use xelatex for LaTeX' }).click();
  await openSettingsTab(page, 'Compilers');
  await expect(page.getByRole('combobox', { name: 'Engine' })).toHaveValue('xelatex');
});

test('retries a preview after a transient renderer failure', async ({ page }) => {
  let requests = 0;
  await page.route('**/renderer.js', async (route) => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('503');
  await page.getByRole('button', { name: 'Retry preview' }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(requests).toBe(2);
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
  await openSettingsTab(page, 'Documents');
  for (let index = 0; index < 8; index++)
    await page.getByRole('button', { name: 'Add delimiter pair' }).click();
  await page
    .locator('#settings-panel-documents > p')
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
      await expect(
        page.getByRole('button', { name: 'Close settings', exact: true }),
      ).toBeInViewport();
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
  await expect(page).toHaveTitle('Papyri');
  await expect(page.locator('.brand strong')).toHaveText('Papyri');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' })).toBeVisible();
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
  expect(favicon.source).toContain('M48 69V42M48 42L35 33M48 42V27M48 42L61 33');
  expect(favicon.source).not.toContain('#cba6f7');
  await page.getByRole('button', { name: 'Close welcome.md', exact: true }).click();
  const emptyMark = page.locator('.empty-icon .app-logo');
  await expect(emptyMark).toBeVisible();
  expect(await emptyMark.evaluate((element) => getComputedStyle(element).maskImage)).toBe(mask);
  await toggleTheme(page);
  await openSettingsTab(page, 'Documents');
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
  const tab = page.locator('.tab-select').filter({ hasText: 'notes.md' });
  await expect(tab).toHaveAttribute('title', `/${filename}`);
  expect(
    await page.locator('.app-header').evaluate((element) => {
      return element.scrollWidth <= element.clientWidth;
    }),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reads, navigates, searches, splits and renders offline diagrams', async ({ page }) => {
  await page.goto('/');
  const frame = page.frameLocator('iframe').first();
  await expect(frame.getByRole('heading', { name: 'Papyri' })).toBeVisible();
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
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' })).toBeVisible();
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
test('persists Typst and LaTeX compiler settings', async ({ page }) => {
  await page.goto('/');
  await openSettingsTab(page, 'Compilers');
  await page.getByLabel('Typst executable path').fill('/opt/typst/bin/typst');
  await page.getByLabel('Typst executable path').blur();
  await page.getByLabel('Markdown · Marksman executable path').fill('/opt/marksman');
  await page.getByLabel('Markdown · Marksman executable path').blur();
  await page.getByRole('combobox', { name: 'Engine' }).selectOption('xelatex');
  await page.getByLabel('xelatex executable path').fill('/opt/tex/bin/xelatex');
  await page.getByLabel('xelatex executable path').blur();
  await page.getByRole('button', { name: 'Apply preferences' }).click();
  await page.reload();
  await openSettingsTab(page, 'Compilers');
  await expect(page.getByLabel('Typst executable path')).toHaveValue('/opt/typst/bin/typst');
  await expect(page.getByLabel('Markdown · Marksman executable path')).toHaveValue('/opt/marksman');
  await expect(page.getByRole('combobox', { name: 'Engine' })).toHaveValue('xelatex');
  await expect(page.getByLabel('xelatex executable path')).toHaveValue('/opt/tex/bin/xelatex');
});

test('downloads managed tools and selects their paths', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === 'initial_path') return { path: '/project', directory: true };
          if (command === 'list_directory') return [];
          if (command === 'latex_engines') return [];
          if (command === 'typst_binary') return null;
          if (command === 'install_tool') return { path: `/managed/${args.name}`, version: 'v1' };
          if (command === 'manage_texlive')
            return {
              lualatex: '/managed/tex/lualatex',
              pdflatex: '/managed/tex/pdflatex',
              xelatex: '/managed/tex/xelatex',
            };
          throw new Error(`Unavailable native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await openSettingsTab(page, 'Compilers');
  await page.getByRole('button', { name: 'Download / update standalone tools' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Installed marksman v1' })).toBeVisible();
  await expect(page.getByLabel('Markdown · Marksman executable path')).toHaveValue(
    '/managed/marksman',
  );
  await expect(page.getByLabel('Typst · Tinymist executable path')).toHaveValue(
    '/managed/tinymist',
  );
  await expect(page.getByLabel('LaTeX · Texlab executable path')).toHaveValue('/managed/texlab');
  await expect(page.getByLabel('Typst executable path')).toHaveValue('/managed/typst');
  await page.getByRole('button', { name: 'Install managed TeX Live' }).click();
  await expect(page.getByLabel('lualatex executable path')).toHaveValue('/managed/tex/lualatex');
  await expect(page.getByLabel('pdflatex executable path')).toHaveValue('/managed/tex/pdflatex');
  await expect(page.getByLabel('xelatex executable path')).toHaveValue('/managed/tex/xelatex');
  await page.getByRole('button', { name: 'Update managed TeX Live' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'TeX Live is ready' })).toBeVisible();
});

test('validates and persists math preferences', async ({ page }) => {
  await page.goto('/');
  await openSettingsTab(page, 'Documents');
  await page.getByRole('button', { name: 'Disable math', exact: true }).click();
  await page.getByRole('button', { name: 'Add delimiter pair' }).click();
  await page.getByRole('button', { name: 'Apply preferences' }).click();
  await expect(page.getByRole('alert')).toContainText('nonempty');
  await page.getByLabel('Opening delimiter 1', { exact: true }).fill('%%');
  await page.getByLabel('Closing delimiter 1', { exact: true }).fill('%%');
  await page.getByLabel('Math mode 1', { exact: true }).selectOption('display');
  await page.getByRole('button', { name: 'Apply preferences' }).click();
  await page.reload();
  await openSettingsTab(page, 'Documents');
  await expect(page.getByLabel('Opening delimiter 1', { exact: true })).toHaveValue('%%');
  await expect(page.getByLabel('Math mode 1', { exact: true })).toHaveValue('display');
});
test('has no serious accessibility violations in the host shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' })).toBeVisible();
  const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
  expect(
    results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
});

test('pages large directories and keeps controls available during large-file parsing', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' })).toBeVisible();
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
  ).toBeVisible({ timeout: 30_000 });
});

test('revokes old frame messages while disabling document scripts', async ({ page }) => {
  await page.goto('/');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' })).toBeVisible();
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
  await expect(frame.getByRole('heading', { name: 'Papyri' })).toBeVisible();
  await frame.locator('html').evaluate((node) => (node.dataset.session = 'preserved'));
  const initialWorkers = workers;
  await toggleTheme(page);
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'latte');
  await expect(frame.locator('html')).toHaveAttribute('data-session', 'preserved');
  await page.getByRole('button', { name: 'Zoom in document', exact: true }).click();
  await expect(page.getByRole('button', { name: /Reset document zoom/ })).toHaveText('110%');
  await expect
    .poll(() =>
      frame.locator('html').evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    )
    .toBeCloseTo(17.6);
  await frame.getByRole('heading', { name: 'Papyri' }).click();
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
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Papyri' })).toBeVisible();
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
  await expect(frame.getByRole('heading', { name: 'Papyri' })).toBeVisible();
  expect(
    await frame
      .locator('body')
      .evaluate(() => typeof (window as unknown as { papyriDiagrams?: unknown }).papyriDiagrams),
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
  await page.getByRole('button', { name: 'Toggle right panel' }).focus();
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
  await expect(frame.getByRole('heading', { name: 'Papyri', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fit document to width', exact: true }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-fit-width', 'true');
  await expect
    .poll(() =>
      frame
        .locator('main')
        .evaluate((node) => Math.abs(node.getBoundingClientRect().width - window.innerWidth)),
    )
    .toBeLessThan(2);
  await frame.getByRole('heading', { name: 'Papyri', exact: true }).click();
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
  await expect(frame.getByRole('heading', { name: 'Papyri', exact: true })).toBeVisible();
  await expect(frame.locator('html')).toHaveCSS('background-color', 'rgb(30, 30, 46)');
  await frame.getByRole('link', { name: 'format gallery' }).click();
  await expect(frame.getByRole('heading', { name: 'Format gallery', exact: true })).toBeVisible();
  await toggleTheme(page);
  await frame.getByRole('link', { name: 'Back to welcome' }).click();
  await expect(frame.getByRole('heading', { name: 'Papyri', exact: true })).toBeVisible();
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
    .poll(async () =>
      Number(
        (await dialog.getByRole('button', { name: /Reset diagram zoom/ }).textContent())!.replace(
          '%',
          '',
        ),
      ),
    )
    .toBeLessThan(100);
  await dialog.getByRole('button', { name: /Reset diagram zoom/ }).click();
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
  const diagramViewport = dialog.locator('.diagram-viewport');
  await diagramViewport.evaluate((element) => (element.scrollLeft = 0));
  const area = (await diagramViewport.boundingBox())!;
  await page.mouse.move(area.x + area.width * 0.75, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.3, area.y + area.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() => diagramViewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(10);
  const focalBefore = await diagramViewport.evaluate(
    (element) => element.scrollLeft + element.clientWidth / 2,
  );
  await page.mouse.move(area.x + area.width * 0.5, area.y + area.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect(dialog.getByRole('button', { name: /Reset diagram zoom/ })).toHaveText('110%');
  await expect
    .poll(() => diagramViewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(10);
  const focalAfter = await diagramViewport.evaluate(
    (element) => (element.scrollLeft + element.clientWidth / 2) / 1.1,
  );
  expect(Math.abs(focalAfter - focalBefore)).toBeLessThan(5);
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
          bounds.width <= window.innerWidth * 0.9 + 1 &&
          bounds.height <= window.innerHeight * 0.9 + 1 &&
          Math.abs(bounds.left + bounds.width / 2 - window.innerWidth / 2) <= 2 &&
          Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2) <= 2
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
  await diagrams.nth(3).getByRole('button', { name: 'Expand diagram' }).click();
  const chart = frame.getByRole('dialog', { name: 'vega-lite diagram' });
  const chartSvg = chart.locator('svg').first();
  const chartWidth = (await chartSvg.boundingBox())!.width;
  await chart.getByRole('button', { name: 'Zoom in diagram' }).click();
  await expect.poll(async () => (await chartSvg.boundingBox())!.width).toBeGreaterThan(chartWidth);
  await chart.getByRole('button', { name: 'Close diagram' }).click();
  await toggleTheme(page);
  await first.getByRole('button', { name: 'Update diagram theme', exact: true }).click();
  await expect(first.locator('.node rect').first()).toHaveCSS('fill', 'rgb(204, 208, 218)');
  await diagrams.nth(2).getByRole('button', { name: 'Expand diagram', exact: true }).click();
  await frame.locator('.diagram-dialog a').first().click();
  await expect(
    frame.getByRole('heading', { name: 'Diagram link target', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.preview-pane.expanded')).toHaveCount(0);
});

test('sizes expanded diagrams to their content and provides local zoom controls', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile('# Small\n\n```dot\ndigraph { A -> B }\n```'));
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Render dot diagram' }).click();
  await frame.getByRole('button', { name: 'Expand diagram' }).click();
  const dialog = frame.getByRole('dialog', { name: 'dot diagram' });
  await expect
    .poll(() =>
      dialog.evaluate((element) => getComputedStyle(element, '::backdrop').backdropFilter),
    )
    .toBe('blur(6px)');
  await expect
    .poll(() =>
      dialog.evaluate((element) => getComputedStyle(element, '::backdrop').backgroundColor),
    )
    .toBe('rgba(0, 0, 0, 0.65)');
  const viewport = dialog.locator('.diagram-viewport');
  const svg = viewport.locator('svg').first();
  await expect(svg).toBeVisible();
  const before = await svg.boundingBox();
  const panel = await viewport.boundingBox();
  expect(panel!.width - before!.width).toBeLessThan(40);
  expect(panel!.height - before!.height).toBeLessThan(40);
  await dialog.getByRole('button', { name: 'Zoom in diagram' }).click();
  await expect(dialog.getByRole('button', { name: 'Reset diagram zoom' })).toHaveText('110%');
  await expect.poll(async () => (await svg.boundingBox())!.width).toBeGreaterThan(before!.width);
  await expect
    .poll(async () => (await viewport.boundingBox())!.width)
    .toBeGreaterThan(panel!.width);
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < 2 &&
          Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) < 2
        );
      }),
    )
    .toBe(true);
  await dialog.getByRole('button', { name: 'Zoom out diagram' }).click();
  await expect(dialog.getByRole('button', { name: 'Reset diagram zoom' })).toHaveText('100%');
  await dialog.getByRole('button', { name: 'Zoom out diagram' }).click();
  await expect.poll(async () => (await svg.boundingBox())!.width).toBeLessThan(before!.width);
  await dialog.getByRole('button', { name: 'Reset diagram zoom' }).click();
  await expect(dialog.getByRole('button', { name: 'Reset diagram zoom' })).toHaveText('100%');
  await dialog.getByRole('button', { name: 'Reset diagram zoom' }).press('+');
  await expect(dialog.getByRole('button', { name: 'Reset diagram zoom' })).toHaveText('110%');
  await dialog.getByRole('button', { name: 'Reset diagram zoom' }).press('-');
  await expect(dialog.getByRole('button', { name: 'Reset diagram zoom' })).toHaveText('100%');
  await dialog.getByRole('button', { name: 'Reset diagram zoom' }).press('0');
  await dialog.getByRole('button', { name: 'Close diagram' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(frame.getByRole('button', { name: 'Expand diagram' })).toBeFocused();
  await frame.getByRole('button', { name: 'Expand diagram' }).click();
  await expect(dialog.getByRole('button', { name: 'Reset diagram zoom' })).toHaveText('100%');
});

test('opens Markdown images and inline SVG with zoom and transparency support', async ({
  page,
}) => {
  await page.goto('/');
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1kAAAAASUVORK5CYII=';
  await page.getByLabel('Import selected files', { exact: true }).setInputFiles(
    markdownFile(
      `# Images

![Transparent pixel](${png})

<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200" viewBox="0 0 2000 1200"><rect x="10" y="10" width="1980" height="1180" fill="none" stroke="currentColor" stroke-width="8"/></svg>\n\n<img src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='80'%20height='40'%3E%3Crect%20width='80'%20height='40'%20fill='%2389b4fa'/%3E%3C/svg%3E" alt="Data vector">`,
    ),
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Images', exact: true })).toBeVisible();
  const imageFrames = frame.locator('.image-frame');
  await expect(imageFrames).toHaveCount(3);
  await expect(imageFrames.first().getByRole('button', { name: /Expand image/ })).toBeVisible();
  await imageFrames
    .first()
    .getByRole('button', { name: /Expand image/ })
    .click();
  const pngDialog = frame.getByRole('dialog', { name: 'image: Transparent pixel', exact: true });
  await expect(pngDialog).toBeVisible();
  await expect(page.locator('.preview-pane').first()).toHaveClass(/expanded/);
  const viewport = pngDialog.locator('.image-viewport');
  await expect
    .poll(() => viewport.evaluate((element) => getComputedStyle(element).backgroundImage))
    .toContain('linear-gradient');
  await expect(pngDialog.getByRole('button', { name: /Reset image zoom/ })).toHaveText('100%');
  await pngDialog.getByRole('button', { name: 'Zoom in image', exact: true }).click();
  await expect(pngDialog.getByRole('button', { name: /Reset image zoom/ })).toHaveText('110%');
  await pngDialog.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect(pngDialog).toHaveCount(0);
  await expect(page.locator('.preview-pane').first()).not.toHaveClass(/expanded/);
  await expect(imageFrames.first().locator('img')).toBeVisible();

  await imageFrames.nth(1).locator('svg').click();
  const svgDialog = frame.getByRole('dialog', { name: 'image', exact: true });
  await expect(svgDialog).toBeVisible();
  await expect(svgDialog.locator('.image-output svg')).toBeVisible();
  await expect
    .poll(() => svgDialog.locator('.image-viewport').evaluate((element) => element.scrollWidth))
    .toBeGreaterThan(0);
  await svgDialog.getByRole('button', { name: /Reset image zoom/ }).click();
  await expect
    .poll(() =>
      svgDialog
        .locator('.image-viewport')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(svgDialog).toHaveCount(0);
  await expect(page.locator('.preview-pane').first()).not.toHaveClass(/expanded/);

  await imageFrames
    .nth(2)
    .getByRole('button', { name: /Expand image/ })
    .click();
  const dataDialog = frame.getByRole('dialog', { name: 'image: Data vector', exact: true });
  await expect(dataDialog).toBeVisible();
  await expect(dataDialog.locator('.image-output img')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml/,
  );
  await dataDialog.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect(dataDialog).toHaveCount(0);
});

test('keeps linked image navigation while offering the image viewer', async ({ page }) => {
  await page.goto('/');
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1kAAAAASUVORK5CYII=';
  await page.getByLabel('Import selected files', { exact: true }).setInputFiles(
    markdownFile(`# Linked image

[![Linked pixel](${png})](https://example.invalid/)`),
  );
  const frame = page.frameLocator('iframe');
  const wrapper = frame.locator('.image-frame.linked');
  await expect(wrapper.locator('a img')).toBeVisible();
  await wrapper.getByRole('button', { name: /Expand image/ }).click();
  const dialog = frame.getByRole('dialog', { name: 'image: Linked pixel', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close image', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(wrapper.locator('a img')).toBeVisible();
});

test('offers source, rendered text, and quote copies for a Markdown selection', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile('# Selection\n\nA **bold** paragraph.', 'selection.md'));
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Selection' })).toBeVisible();
  const selectParagraph = () =>
    frame
      .locator('p')
      .first()
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        const bounds = element.getBoundingClientRect();
        element.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: bounds.left + 12,
            clientY: bounds.top + 8,
          }),
        );
      });
  const menu = page.getByRole('menu', { name: 'Selection actions' });
  const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());

  await selectParagraph();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.pad-rendered strong')).toHaveText('bold');
  await menu.getByRole('button', { name: 'Toggle source preview' }).hover();
  await expect(menu.locator('.pad-source-code')).toHaveText('A **bold** paragraph.');
  await page.mouse.move(1, 1);
  await expect(menu.locator('.pad-rendered')).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Copy source', exact: true }).click();
  expect(await readClipboard()).toBe('A **bold** paragraph.');

  await selectParagraph();
  await menu.getByRole('menuitem', { name: 'Copy selected text', exact: true }).click();
  expect(await readClipboard()).toBe('A bold paragraph.');

  await selectParagraph();
  await menu.getByRole('menuitem', { name: 'Copy as quote', exact: true }).click();
  expect(await readClipboard()).toBe('> A bold paragraph.');

  await selectParagraph();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('suppresses WebKit navigation menus in the app and document preview', async ({ page }) => {
  await page.goto('/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Papyri' })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await expect(page.getByRole('menu', { name: 'Context actions' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(
    await frame.locator('body').evaluate(() => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await expect(page.getByRole('menu', { name: 'Context actions' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('opens context menus for app chrome, tabs, files, and documents', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 700, 'Context menus are desktop interactions.');
  await page.goto('/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Papyri' })).toBeVisible();
  const menu = page.getByRole('menu', { name: 'Context actions' });

  await page.locator('.brand').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Open file/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await page.locator('.tab-item[data-path]').first().click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /Close tab/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page
    .locator('.file-row[data-path]')
    .filter({ hasText: 'welcome.md' })
    .click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Open', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await frame.locator('p').first().click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: /Copy raw source/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('highlights a partially selected formula as one block', async ({ page }) => {
  await page.goto('/');
  const markdown = String.raw`# Math highlight

Inline math: \(e^{i\pi} + 1 = 0\) with text.
`;
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile(markdown, 'math-highlight.md'));
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Math highlight' })).toBeVisible();
  const formula = frame.locator('.katex').first();
  await formula.evaluate((element) => {
    const text = element.querySelector('.katex-html .mord')?.firstChild;
    if (!text) throw new Error('No formula text');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(1, text.textContent!.length));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect.poll(() => formula.getAttribute('class')).toContain('selection-highlight');
  const highlight = await frame
    .locator('.math')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const content = element.querySelector('.math-content')!;
      return {
        background: style.backgroundColor,
        radius: style.borderRadius,
        contentSelection: getComputedStyle(content, '::selection').backgroundColor,
      };
    });
  expect(highlight.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(highlight.radius).toBe('0px');
  expect(highlight.contentSelection).toBe('rgba(0, 0, 0, 0)');
  expect(await formula.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)',
  );
  await frame.locator('body').evaluate(() => window.getSelection()!.removeAllRanges());
  await expect(formula).not.toHaveClass(/selection-highlight/);
  expect(
    await frame.locator('.math').evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe('rgba(0, 0, 0, 0)');
});

test('highlights display math across its block without native glyph artifacts', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles(
    markdownFile(
      String.raw`# Display math

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi} \tag{1}
$$
`,
      'display-math.md',
    ),
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Display math' })).toBeVisible();
  await frame.locator('main').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const block = frame.locator('.math-block');
  const display = frame.locator('.katex-display');
  const formula = block.locator('.katex');
  await expect(formula).toHaveClass(/selection-highlight/);
  const styles = await display.evaluate((element) => {
    const katex = element.querySelector('.katex')!;
    return {
      displayBackground: getComputedStyle(element).backgroundColor,
      displayWidth: element.getBoundingClientRect().width,
      katexBackground: getComputedStyle(katex).backgroundColor,
      katexWidth: katex.getBoundingClientRect().width,
      userSelect: getComputedStyle(katex).userSelect,
    };
  });
  expect(styles.displayBackground).toBe('rgba(203, 166, 247, 0.26)');
  expect(styles.katexBackground).toBe('rgba(203, 166, 247, 0.26)');
  expect(styles.katexWidth).toBeGreaterThan(styles.displayWidth / 2);
  expect(styles.userSelect).toBe('none');
});

test('preserves ordered-list numbering and leaves room for multi-digit markers', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(
      markdownFile(
        [
          '# List markers',
          Array.from({ length: 12 }, (_, index) => `${index + 5}. Item ${index + 5}`).join('\n'),
          '<ol start="9"><li>Nine<ol start="12"><li>Twelve</li><li>Thirteen</li></ol></li><li value="25">Twenty-five</li><li>Twenty-six</li></ol>',
          '<ol reversed><li>Three</li><li>Two</li><li>One</li></ol>',
          '<ol reversed start="12"><li>Twelve</li><li value="5">Five</li><li>Four</li></ol>',
          '<ol start="0"><li>Zero</li><li value="-2">Negative two</li><li>Negative one</li></ol>',
          '<ol reversed start="invalid"><li>Three</li><li value="invalid">Two</li><li>One</li></ol>',
          '- Bullet\n  - Nested bullet\n- [ ] Task',
        ].join('\n\n'),
        'list-markers.md',
      ),
    );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'List markers' })).toBeVisible();
  const markers = await frame.locator('ol > li').evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item, '::before');
      const bounds = item.getBoundingClientRect();
      const markerRight = bounds.right - parseFloat(style.right);
      return {
        label: style.content,
        gap: bounds.left - markerRight,
        left: markerRight - parseFloat(style.width),
      };
    }),
  );
  expect(markers.map(({ label }) => label)).toEqual(
    [
      ...Array.from({ length: 12 }, (_, index) => `${index + 5}.`),
      '9.',
      '12.',
      '13.',
      '25.',
      '26.',
      '3.',
      '2.',
      '1.',
      '12.',
      '5.',
      '4.',
      '0.',
      '-2.',
      '-1.',
      '3.',
      '2.',
      '1.',
    ].map((label) => `"${label}"`),
  );
  for (const marker of markers) {
    expect(marker.gap).toBeGreaterThan(4);
    expect(marker.left).toBeGreaterThanOrEqual(0);
  }
  expect(
    await frame
      .locator('ul > li')
      .first()
      .evaluate((item) => getComputedStyle(item, '::before').content),
  ).toBe('"•"');
  expect(
    await frame
      .locator('.task-list-item')
      .evaluate((item) => getComputedStyle(item, '::before').content),
  ).toBe('none');
});

test('keeps wrapped inline math inside one selection box', async ({ page }) => {
  await page.goto('/');
  const wideExpression = String.raw`\begin{bmatrix}${Array.from({ length: 60 }, (_, index) => `x_{${index}}`).join(' & ')}\end{bmatrix}`;
  await page.getByLabel('Import selected files').setInputFiles(
    markdownFile(
      String.raw`# Wrapped math

Text before \(e^{i\pi} + 1 = 0\) and after.

Text before \(${wideExpression}\) and after.`,
      'wrapped-math.md',
    ),
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Wrapped math' })).toBeVisible();
  // Constrain the reading column independently of the app's responsive panels.
  await frame.locator('main').evaluate((element) => {
    element.style.width = '220px';
    window.dispatchEvent(new Event('resize'));
  });
  await expect(frame.locator('.math-content.scrollable')).toHaveCount(1);
  for (const zoom of [100, 150]) {
    if (zoom === 150) {
      await frame.getByRole('heading', { name: 'Wrapped math' }).click();
      for (let index = 0; index < 5; index++) await page.keyboard.press('Control+Shift+Equal');
      await expect(page.getByRole('button', { name: /Reset document zoom/ })).toHaveText('150%');
    }
    for (const index of [0, 1]) {
      const math = frame.locator('.math').nth(index);
      await math.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element.parentElement!);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await expect(math.locator('.katex')).toHaveClass(/selection-highlight/);
      const box = await math.evaluate((element) => {
        const style = getComputedStyle(element);
        const before = getComputedStyle(element, '::before');
        const after = getComputedStyle(element, '::after');
        const textLine = element.parentElement!.getBoundingClientRect();
        const mathBounds = element.getBoundingClientRect();
        return {
          background: style.backgroundColor,
          beforeBackground: before.backgroundColor,
          beforeContent: before.content,
          afterBackground: after.backgroundColor,
          afterContent: after.content,
          userSelect: getComputedStyle(element.querySelector('.katex')!).userSelect,
          wrapped: mathBounds.top > textLine.top,
        };
      });
      expect(box.wrapped).toBe(true);
      expect(box.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(box.beforeContent).toBe('none');
      expect(box.afterContent).toBe('none');
      expect(box.beforeBackground).toBe('rgba(0, 0, 0, 0)');
      expect(box.afterBackground).toBe('rgba(0, 0, 0, 0)');
      expect(box.userSelect).toBe('none');
    }
    await frame
      .locator('.math-content.scrollable')
      .evaluate((element) => (element.scrollLeft = 100));
    expect(
      await frame.locator('.math-content.scrollable').evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
  }
});

test('keeps inline code selection aligned with the surrounding text', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile('# Code\n\nBefore `code` after.\n', 'inline-code.md'));
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Code' })).toBeVisible();
  const code = frame.locator('p code').first();
  await frame
    .locator('p')
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await expect(code).toHaveClass(/selection-highlight/);
  expect(await code.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgba(203, 166, 247, 0.26)',
  );
  await frame.locator('body').evaluate(() => window.getSelection()!.removeAllRanges());
  await expect(code).not.toHaveClass(/selection-highlight/);
  expect(await code.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(24, 24, 37)',
  );
});

test('shows selected word and character counts in the status bar', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile('# Stats\n\nAlpha beta gamma.', 'stats.md'));
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Stats' })).toBeVisible();
  const status = page.locator('.status-stats');
  await frame
    .locator('p')
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await expect(status).toContainText('3 words selected');
  await expect(status).toContainText('17 characters selected');
  await frame.locator('body').evaluate(() => window.getSelection()!.removeAllRanges());
  await expect(status).not.toContainText('selected');
  await expect(status).toContainText('26 characters');
});

test('renders lists and block structure in the action-pad preview', async ({ page }) => {
  await page.goto('/');
  const markdown = [
    '# Preview structure',
    '',
    'A **mixed** sentence.',
    '',
    '- First item',
    '- Second item',
    '',
    '> Quoted line',
    '',
    'Final paragraph.',
  ].join('\n');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile(markdown, 'preview-structure.md'));
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Preview structure' })).toBeVisible();
  const openMenu = (select: 'blocks' | 'list') =>
    frame.locator('#document').evaluate((root, mode) => {
      const range = document.createRange();
      if (mode === 'list') range.selectNodeContents(root.querySelector('ul')!);
      else {
        const paragraphs = root.querySelectorAll('p');
        range.setStart(paragraphs[0].firstChild!, 0);
        range.setEnd(paragraphs[1].firstChild!, paragraphs[1].firstChild!.textContent!.length);
      }
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const bounds = range.getBoundingClientRect();
      root.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + 10,
          clientY: bounds.top + 10,
        }),
      );
    }, select);
  const menu = page.getByRole('menu', { name: 'Selection actions' });

  await openMenu('blocks');
  await expect(menu.locator('.pad-rendered ul')).toHaveCSS('list-style-type', 'disc');
  await expect(menu.locator('.pad-rendered ul li')).toHaveCount(2);
  await expect(menu.locator('.pad-rendered blockquote')).toContainText('Quoted line');
  await page.keyboard.press('Escape');

  await openMenu('list');
  await expect(menu.locator('.pad-rendered ul li')).toHaveCount(2);
});

test('copies Markdown source and rendered text with keyboard shortcuts', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const markdown = String.raw`# Keyboard copy

A **bold** \(x^2\) paragraph.

Second paragraph for multi-block source.`;
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile(markdown, 'keyboard-copy.md'));
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading', { name: 'Keyboard copy' }).click();
  const selectParagraph = () =>
    frame
      .locator('p')
      .first()
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
  const selectAcrossParagraphs = () =>
    frame.locator('#document').evaluate((root) => {
      const paragraphs = root.querySelectorAll('p');
      const range = document.createRange();
      range.setStart(paragraphs[0].firstChild!, 0);
      range.setEnd(paragraphs[1].firstChild!, paragraphs[1].firstChild!.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  const openSelectionMenu = () =>
    frame
      .locator('p')
      .first()
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        const bounds = element.getBoundingClientRect();
        element.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: bounds.left + 12,
            clientY: bounds.top + 8,
          }),
        );
      });
  const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());

  await selectParagraph();
  await page.keyboard.press('Control+c');
  await expect.poll(readClipboard).toBe(String.raw`A **bold** \(x^2\) paragraph.`);

  await selectParagraph();
  await page.keyboard.press('Control+Shift+c');
  await expect.poll(readClipboard).toBe('A bold $x^2$ paragraph.');

  await selectAcrossParagraphs();
  await page.keyboard.press('Control+c');
  await expect.poll(readClipboard).toBe(
    String.raw`A **bold** \(x^2\) paragraph.

Second paragraph for multi-block source.`,
  );

  await openSelectionMenu();
  await expect(page.getByRole('menu', { name: 'Selection actions' })).toBeVisible();
  await page.keyboard.press('Control+Shift+c');
  await expect.poll(readClipboard).toBe('A bold $x^2$ paragraph.');
});

test('copies TeX instead of KaTeX markup for math selections', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const markdown = String.raw`# Math selection

Inline \(x^2 + y^2 = z^2\) and **bold** prose.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
`;
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile(markdown, 'math-selection.md'));
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Math selection' })).toBeVisible();
  async function copyFrom(locator: ReturnType<typeof frame.locator>, action: string) {
    await locator.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + 12,
          clientY: bounds.top + 8,
        }),
      );
    });
    await page.getByRole('menuitem', { name: action, exact: true }).click();
    return page.evaluate(() => navigator.clipboard.readText());
  }
  expect(await copyFrom(frame.locator('.katex').first(), 'Copy selected text')).toBe(
    '$x^2 + y^2 = z^2$',
  );
  expect(await copyFrom(frame.locator('.katex-display').first(), 'Copy selected text')).toBe(
    '$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$',
  );
  expect(await copyFrom(frame.locator('.katex-display').first(), 'Copy source')).toBe(
    '$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$',
  );
});

test('exports diagrams as SVG and PNG and copies a PNG', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile('# Export\n\n```dot\ndigraph { A -> B }\n```'));
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Render dot diagram' }).click();
  await frame.getByRole('button', { name: 'Expand diagram' }).click();
  const dialog = frame.getByRole('dialog', { name: 'dot diagram' });
  const svgDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download diagram as SVG' }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe('diagram.svg');
  expect(await readFile((await svg.path())!, 'utf8')).toContain('<svg');
  const pngDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download diagram as PNG' }).click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe('diagram.png');
  expect((await readFile((await png.path())!)).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  await dialog.getByRole('button', { name: 'Copy diagram as PNG' }).click();
  await expect(dialog.getByRole('status')).toContainText('copied to clipboard');
  expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toContain(
    'image/png',
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }),
  );
  await dialog.getByRole('button', { name: 'Copy diagram as PNG' }).click();
  await expect(dialog.getByRole('status')).toContainText('Copying images is unavailable');
  await expect(dialog.getByRole('button', { name: 'Copy diagram as PNG' })).toBeEnabled();
});

test('routes a desktop diagram download through the native save dialog', async ({ page }) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce');
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: unknown) => {
          if (command === 'initial_path') return { path: '/paper.md', directory: false };
          if (command === 'read_document')
            return { text: '# Export\n\n```dot\ndigraph { A -> B }\n```', stamp: '1' };
          if (command === 'list_directory') return [];
          if (command === 'document_stamp') return '1';
          if (command === 'save_diagram') {
            Object.defineProperty(window, 'savedDiagram', { value: args, configurable: true });
            return true;
          }
          throw new Error(`Unexpected native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Render dot diagram' }).click();
  await frame.getByRole('button', { name: 'Expand diagram' }).click();
  const dialog = frame.getByRole('dialog', { name: 'dot diagram' });
  await dialog.getByRole('button', { name: 'Download diagram as SVG' }).click();
  await expect(dialog.getByRole('status')).toContainText('Diagram saved');
  const saved = await page.evaluate(
    () => (window as unknown as { savedDiagram: { format: string; bytes: number[] } }).savedDiagram,
  );
  expect(saved.format).toBe('svg');
  expect(Buffer.from(saved.bytes).toString('utf8')).toContain('<svg');
});

test('does not expose diagram export to script-enabled documents', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(markdownFile('# Trusted\n\n```dot\ndigraph { A -> B }\n```'));
  await page
    .getByRole('button', { name: 'Safe preview: trust current document for scripts' })
    .click();
  await page.getByRole('button', { name: 'Enable scripts for this document' }).click();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Render dot diagram' }).click();
  await frame.getByRole('button', { name: 'Expand diagram' }).click();
  const dialog = frame.getByRole('dialog', { name: 'dot diagram' });
  await expect(dialog.getByRole('button', { name: 'Download diagram as SVG' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Copy diagram as PNG' })).toBeDisabled();
  await expect(dialog.getByRole('status')).toContainText(
    'unavailable while document scripts are enabled',
  );
});

test('scrolls a trusted document even when scripts replace scrollTo', async ({ page }) => {
  await page.goto('/');
  const paragraphs = Array.from({ length: 200 }, (_, index) => `Paragraph ${index}.`).join('\n\n');
  await page
    .getByLabel('Import selected files')
    .setInputFiles(
      markdownFile(
        `# Trusted scroll\n\n<script>window.scrollTo = () => {}; window.__scrollBlocked = true;</script>\n\n${paragraphs}`,
        'trusted-scroll.md',
      ),
    );
  await page
    .getByRole('button', { name: 'Safe preview: trust current document for scripts' })
    .click();
  await page.getByRole('button', { name: 'Enable scripts for this document' }).click();
  await expect(page.locator('.preview-pane')).toHaveAttribute('aria-busy', 'false');
  const frame = page.frameLocator('iframe');
  await expect
    .poll(() =>
      frame
        .locator('html')
        .evaluate(() => (window as unknown as { __scrollBlocked?: boolean }).__scrollBlocked),
    )
    .toBe(true);
  await page
    .locator('iframe')
    .evaluate((element) =>
      (element as HTMLIFrameElement).contentWindow?.postMessage(
        { type: 'scroll', request: 1, y: 700 },
        '*',
      ),
    );
  await expect.poll(() => frame.locator('html').evaluate(() => window.scrollY)).toBeGreaterThan(0);
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
  await expect(frame.locator('.math-content > .katex')).toHaveCount(1);
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
  const inlineMath = frame.locator('.math-content');
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
        .locator('.math-content')
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
  for (const name of ['Toggle right panel', 'Toggle explorer', 'Toggle split view']) {
    if (name === 'Toggle right panel' && (await page.locator('.side-panel').isVisible()))
      await page.locator('.side-panel-close').click();
    else await page.getByRole('button', { name, exact: true }).click();
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

test('keeps the latest scroll when switching tabs immediately', async ({ page }) => {
  await page.goto('/');
  const paragraphs = 'A paragraph.\n\n'.repeat(150);
  await page
    .getByLabel('Import selected files', { exact: true })
    .setInputFiles([
      markdownFile('# Alpha\n\n[Beta](./beta.md)\n\n' + paragraphs, 'alpha.md'),
      markdownFile('# Beta\n\n' + paragraphs, 'beta.md'),
    ]);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('link', { name: 'Beta', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Beta', exact: true })).toBeVisible();
  await page.locator('.tab-select').filter({ hasText: 'alpha.md' }).click();
  await expect(frame.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
  await frame.locator('html').evaluate(() => scrollTo(0, 1800));
  await page.locator('.tab-select').filter({ hasText: 'beta.md' }).click();
  await page.locator('.tab-select').filter({ hasText: 'alpha.md' }).click();
  await expect(frame.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
  await expect.poll(() => frame.locator('html').evaluate(() => scrollY)).toBe(1800);
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
  const outline = page.getByRole('complementary', { name: 'Context panel' });
  if (!(await outline.isVisible()))
    await page.getByRole('button', { name: 'Toggle right panel', exact: true }).click();
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
  await openSettingsTab(page, 'Documents');
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

test('hides chrome in decoration-less mode while keeping the palette and shortcuts', async ({
  page,
}) => {
  await page.goto('/');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Papyri' })).toBeVisible();

  await frame.locator('body').press('Control+Shift+D');
  await expect(page.locator('.app-shell')).toHaveClass(/decorationless/);
  await expect(page.locator('.app-header')).toBeHidden();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.side-panel')).toBeHidden();
  await expect(page.locator('.status-bar')).toBeHidden();
  await expect(page.locator('.render-time')).toBeHidden();
  expect(
    await page.locator('.preview-pane').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return Math.abs(bounds.width - innerWidth) <= 2 && Math.abs(bounds.height - innerHeight) <= 2;
    }),
  ).toBe(true);

  await frame.locator('body').press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  const search = dialog.getByRole('combobox', { name: 'Search files and commands' });
  await expect(search).toBeFocused();
  await search.fill('>toggle decoration');
  await dialog.getByRole('option', { name: /Toggle decoration-less mode/ }).click();
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.locator('.app-shell')).not.toHaveClass(/decorationless/);

  await page.keyboard.press('Control+Shift+D');
  await expect(page.locator('.app-header')).toBeHidden();
  await frame.locator('body').press('Escape');
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.locator('.app-shell')).not.toHaveClass(/decorationless/);
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
    if (theme === 'mocha') await toggleTheme(page);
  }
});

test('uses theme-aware Catppuccin selection colors in the source editor', async ({ page }) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce'),
    });
  });
  await page.addInitScript(() => {
    const file = {
      text: '# Selection\n\nSelect **this** text with `code` and a [link](https://example.com).\n',
      stamp: '1',
    };
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'initial_path') return { path: '/selection.md', directory: false };
          if (command === 'read_document') return { ...file };
          if (command === 'document_stamp') return file.stamp;
          if (command === 'list_directory') return [];
          throw new Error(`Unavailable native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit source' }).click();
  const editor = page.getByRole('textbox', { name: 'Source editor' });
  const backgrounds: string[] = [];
  const activeLineBackgrounds: string[] = [];
  for (const theme of ['mocha', 'latte']) {
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme);
    await editor.click();
    await page.keyboard.press('Control+A');
    const selection = page.locator('.cm-selectionBackground').first();
    await expect(selection).toBeVisible();
    backgrounds.push(
      await selection.evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    activeLineBackgrounds.push(
      await page
        .locator('.cm-activeLine')
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    if (theme === 'mocha') await toggleTheme(page);
  }
  expect(backgrounds).toEqual(['rgba(203, 166, 247, 0.4)', 'rgba(136, 57, 239, 0.3)']);
  for (const background of activeLineBackgrounds) expect(background).toMatch(/0\.3\)$/);
});

test('edits source, retains a draft across preview mode, and saves the captured version', async ({
  page,
}) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce');
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => {
    const file = { text: '# Original', stamp: '1' };
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === 'initial_path') return { path: '/paper.md', directory: false };
          if (command === 'read_document') return { ...file };
          if (command === 'document_stamp') return file.stamp;
          if (command === 'list_directory') return [];
          if (command === 'write_document') {
            if (args.expectedText !== file.text || args.expectedStamp !== file.stamp)
              throw new Error('Document changed on disk');
            file.text = String(args.text);
            file.stamp = '2';
            return { ...file };
          }
          throw new Error(`Unavailable native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await expect(
    page.frameLocator('iframe:not(.pending)').getByRole('heading', { name: 'Original' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit source' }).click();
  const editor = page.getByRole('textbox', { name: 'Source editor' });
  await expect(editor).toHaveText('# Original');
  await page.getByRole('button', { name: 'Zoom in live preview' }).click();
  await expect(page.getByRole('button', { name: 'Reset live preview zoom: 110%' })).toBeVisible();
  await page.getByRole('button', { name: 'Fit live preview to width' }).click();
  await expect(page.getByRole('button', { name: 'Reset live preview zoom: 100%' })).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('# Changed');
  await expect(
    page.frameLocator('iframe:not(.pending)').getByRole('heading', { name: 'Changed' }),
  ).toBeVisible();
  await editor.fill('# Changed\n\nSecond paragraph');
  await page.frameLocator('iframe:not(.pending)').getByText('Second paragraph').click();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.textContent))
    .toBe('Second paragraph');
  await editor.fill(
    `# Changed\n\n${Array.from({ length: 100 }, (_, i) => `Paragraph ${i}`).join('\n\n')}`,
  );
  const activePreview = page.locator('iframe:not(.pending)');
  await expect(activePreview.contentFrame().getByText('Paragraph 99')).toBeAttached();
  await activePreview.evaluate((frame) => frame.setAttribute('data-scroll-test', 'original'));
  await activePreview
    .contentFrame()
    .locator('html')
    .evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(() =>
      activePreview
        .contentFrame()
        .locator('html')
        .evaluate(() => window.scrollY),
    )
    .toBeGreaterThan(400);
  await page.waitForTimeout(400);
  await expect(activePreview).toHaveAttribute('data-scroll-test', 'original');
  await expect(page.locator('iframe.pending')).toHaveCount(0);
  await editor.fill('# Changed');
  await expect(page.getByRole('button', { name: 'Save source' })).toBeEnabled();
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'Close paper.md' }).click();
  await expect(editor).toHaveText('# Changed');
  await page.getByRole('button', { name: 'Show preview' }).click();
  await expect(
    page.frameLocator('iframe:not(.pending)').getByRole('heading', { name: 'Original' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit source' }).click();
  await expect(editor).toHaveText('# Changed');
  await page.getByRole('button', { name: 'Save source' }).click();
  await expect(page.getByRole('button', { name: 'Save source' })).toBeDisabled();
  await page.getByRole('button', { name: 'Show preview' }).click();
  await expect(
    page.frameLocator('iframe:not(.pending)').getByRole('heading', { name: 'Changed' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit source' }).click();
  for (const theme of ['mocha', 'latte']) {
    if (theme === 'latte') await toggleTheme(page);
    await editor.fill('');
    await editor.press('Control+Space');
    const menu = page.locator('.cm-tooltip-autocomplete');
    await expect(menu.getByRole('option')).toHaveCount(3);
    await expect(menu.locator('.codicon-symbol-snippet')).toHaveCount(3);
    await expect.poll(() => page.evaluate(() => document.fonts.check('16px codicon'))).toBe(true);
    const selected = menu.locator('[aria-selected="true"]');
    const selectedLabel = selected.locator('.cm-completionLabel');
    const firstSuggestion = await selectedLabel.textContent();
    // CodeMirror ignores completion keys briefly while the menu appears.
    await page.waitForTimeout(100);
    await editor.press('ArrowDown');
    await expect(selectedLabel).not.toHaveText(firstSuggestion!);
    await editor.press('ArrowUp');
    await expect(selectedLabel).toHaveText(firstSuggestion!);
    const alignment = await menu.evaluate((element) => {
      const popup = element.getBoundingClientRect();
      const pane = element.closest('.cm-editor')!.getBoundingClientRect();
      const rows = [...element.querySelectorAll('li')].map((row) => {
        const bounds = row.getBoundingClientRect();
        const icon = row.querySelector('.completion-kind')!.getBoundingClientRect();
        const label = row.querySelector('.cm-completionLabel')!.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          iconLeft: icon.left,
          labelLeft: label.left,
          centerDifference: Math.abs((icon.top + icon.bottom - label.top - label.bottom) / 2),
        };
      });
      return {
        popupLeft: popup.left,
        popupRight: popup.right,
        paneLeft: pane.left,
        paneRight: pane.right,
        rows,
      };
    });
    expect(alignment.popupLeft).toBeGreaterThanOrEqual(alignment.paneLeft - 1);
    expect(alignment.popupRight).toBeLessThanOrEqual(alignment.paneRight + 1);
    for (const row of alignment.rows) {
      expect(Math.abs(row.iconLeft - alignment.rows[0].iconLeft)).toBeLessThan(1);
      expect(Math.abs(row.labelLeft - alignment.rows[0].labelLeft)).toBeLessThan(1);
      expect(row.centerDifference).toBeLessThan(2);
      expect(row.left).toBeCloseTo(alignment.rows[0].left, 0);
      expect(row.right).toBeCloseTo(alignment.rows[0].right, 0);
    }
    const contrast = await menu.evaluate((element) => {
      const context = document.createElement('canvas').getContext('2d')!;
      function luminance(color: string) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      const background = getComputedStyle(element).backgroundColor;
      return [...element.querySelectorAll('li')].flatMap((option) => {
        const optionBackground = option.hasAttribute('aria-selected')
          ? getComputedStyle(option).backgroundColor
          : background;
        const surface = luminance(optionBackground);
        return [...option.querySelectorAll('.cm-completionLabel, .cm-completionDetail')].map(
          (text) => {
            const foreground = luminance(getComputedStyle(text).color);
            return {
              selected: option.hasAttribute('aria-selected'),
              part: text.className,
              ratio:
                (Math.max(surface, foreground) + 0.05) / (Math.min(surface, foreground) + 0.05),
            };
          },
        );
      });
    });
    expect(contrast.length).toBeGreaterThan(3);
    expect(
      contrast.filter(({ ratio }) => ratio < 4.5),
      theme,
    ).toEqual([]);
    await page.keyboard.press('Escape');
  }
  await toggleTheme(page);
  await editor.fill('heading');
  await editor.press('Control+Space');
  await page.getByRole('option').filter({ hasText: 'heading' }).first().click();
  await expect(editor).toContainText('## heading');
  await page.keyboard.insertText('Research');
  await expect(editor).toContainText('## Research');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Reload source' }).click();
  await expect(editor).toHaveText('# Changed');
});

for (const [name, original, changed] of [
  ['paper.typ', '= Original', '= Changed'],
  ['paper.tex', String.raw`\section{Original}`, String.raw`\section{Changed}`],
] as const) {
  test(`edits and saves ${name} source when compilation is unavailable`, async ({ page }) => {
    await page.route('**/', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce'),
      });
    });
    await page.addInitScript(
      ({ name, original }) => {
        const file = { text: original, stamp: '1' };
        Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
          value: {
            invoke: async (command: string, args: Record<string, unknown>) => {
              if (command === 'initial_path') return { path: '/' + name, directory: false };
              if (command === 'read_document') return { ...file };
              if (command === 'document_stamp') return file.stamp;
              if (command === 'list_directory') return [];
              if (command === 'write_document') {
                if (args.expectedText !== file.text || args.expectedStamp !== file.stamp)
                  throw new Error('Document changed on disk');
                file.text = String(args.text);
                file.stamp = '2';
                return { ...file };
              }
              throw new Error(`Unavailable native command: ${command}`);
            },
          },
        });
      },
      { name, original },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit source' }).click();
    const editor = page.getByRole('textbox', { name: 'Source editor' });
    await expect(editor).toContainText(original);
    await expect(editor.locator('.cm-line span').first()).toBeVisible();
    await editor.fill(changed);
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('button', { name: 'Save source' })).toBeDisabled();
    await page.getByRole('button', { name: 'Show preview' }).click();
    await page.getByRole('button', { name: 'Edit source' }).click();
    await expect(editor).toContainText(changed);
  });
}

test('completes LaTeX commands inside Markdown math', async ({ page }) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce');
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => {
    const file = { text: '# Math\n\n$\\fra', stamp: '1' };
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === 'initial_path') return { path: '/paper.md', directory: false };
          if (command === 'read_document') return { ...file };
          if (command === 'document_stamp') return file.stamp;
          if (command === 'list_directory') return [];
          if (command === 'write_document') {
            file.text = String(args.text);
            file.stamp = '2';
            return { ...file };
          }
          throw new Error(`Unavailable native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await expect(
    page.frameLocator('iframe:not(.pending)').getByRole('heading', { name: 'Math' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit source' }).click();
  const editor = page.getByRole('textbox', { name: 'Source editor' });
  expect(await editor.innerText()).toContain('$\\fra');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Space');
  const menu = page.locator('.cm-tooltip-autocomplete');
  await expect(menu).toBeVisible();
  const fraction = menu.getByRole('option', { name: /^\\frac\{\}\{\}/ });
  await expect(fraction).toBeVisible();
  await fraction.click();
  await page.keyboard.type('1');
  await page.keyboard.press('Tab');
  await page.keyboard.type('2');
  await expect.poll(() => editor.innerText()).toContain('$\\frac{1}{2}');
});

test('completes LaTeX commands in a .tex source file', async ({ page }) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce'),
    });
  });
  await page.addInitScript(() => {
    const file = {
      text: '\\documentclass{article}\n\\begin{document}\n\\begin{equation}\n\\fra\n',
      stamp: '1',
    };
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'initial_path') return { path: '/paper.tex', directory: false };
          if (command === 'read_document') return { ...file };
          if (command === 'document_stamp') return file.stamp;
          if (command === 'list_directory') return [];
          throw new Error(`Unavailable native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit source' }).click();
  const editor = page.getByRole('textbox', { name: 'Source editor' });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Space');
  const menu = page.locator('.cm-tooltip-autocomplete');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toContainText('\\frac');
});

test('does not offer LaTeX math completions outside Markdown math', async ({ page }) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce');
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => {
    const file = { text: '# Text\n\n\\fra', stamp: '1' };
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'initial_path') return { path: '/paper.md', directory: false };
          if (command === 'read_document') return { ...file };
          if (command === 'document_stamp') return file.stamp;
          if (command === 'list_directory') return [];
          throw new Error(`Unavailable native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await expect(
    page.frameLocator('iframe:not(.pending)').getByRole('heading', { name: 'Text' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit source' }).click();
  const editor = page.getByRole('textbox', { name: 'Source editor' });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Space');
  await expect(
    page.locator('.cm-tooltip-autocomplete').getByRole('option', { name: /\\frac/ }),
  ).toHaveCount(0);
});

test('recompiles LaTeX drafts while retaining the previous PDF', async ({ page }) => {
  const pdf = (await readFile('e2e/fixtures/paged.pdf')).toString('base64');
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce'),
    });
  });
  await page.addInitScript((encoded) => {
    const file = {
      text: '\\documentclass{article}\n\\begin{document}\nOriginal\n\\end{document}',
      stamp: '1',
    };
    const pdfBytes = () =>
      Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)).buffer;
    (window as unknown as { compileRequests: string[] }).compileRequests = [];
    (window as unknown as { syncRequests: Record<string, unknown>[] }).syncRequests = [];
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === 'initial_path') return { path: '/paper.tex', directory: false };
          if (command === 'read_document') return { ...file };
          if (command === 'document_stamp') return file.stamp;
          if (command === 'list_directory') return [];
          if (command === 'read_pdf') return pdfBytes();
          if (command === 'compile_latex_draft') {
            (window as unknown as { compileRequests: string[] }).compileRequests.push(
              String(args.text),
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
            const pdf = new Uint8Array(pdfBytes());
            const result = new Uint8Array(32 + pdf.length);
            result.set(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));
            result.set(pdf, 32);
            return result.buffer;
          }
          if (command === 'latex_sync') {
            (window as unknown as { syncRequests: Record<string, unknown>[] }).syncRequests.push(
              args,
            );
            return 'SyncTeX result begin\nInput:/paper.tex\nLine:3\nColumn:-1\nPage:1\nx:80\ny:80\nSyncTeX result end';
          }
          if (command === 'latex_sync_release') return;
          throw new Error(`Unavailable native command: ${command}`);
        },
      },
    });
  }, pdf);
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit source' }).click();
  const editor = page.getByRole('textbox', { name: 'Source editor' });
  const frame = page.locator('iframe:not(.pending)');
  await expect(frame.contentFrame().locator('.page canvas').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recompile' })).toBeEnabled();
  await expect(page.getByText('Compiling · Stale')).toHaveCount(0);
  await frame
    .contentFrame()
    .locator('.page')
    .first()
    .click({ position: { x: 20, y: 20 } });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { syncRequests: Record<string, unknown>[] }).syncRequests.some(
          (item) => item.page === 1,
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.textContent))
    .toBe('Original');
  await editor.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { syncRequests: Record<string, unknown>[] }).syncRequests.some(
          (item) => item.source === '/paper.tex',
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(
    () => ((window as unknown as { compileRequests: string[] }).compileRequests = []),
  );
  await frame.evaluate((element) => element.setAttribute('data-old-pdf', 'yes'));
  await editor.fill('Draft one');
  await expect(page.getByText('Stale', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recompile' }).click();
  await expect(page.getByText('Compiling · Stale')).toBeVisible();
  await expect(frame).toHaveAttribute('data-old-pdf', 'yes');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { compileRequests: string[] }).compileRequests),
    )
    .toEqual(['Draft one']);
  await expect(page.getByText('Compiling · Stale')).toHaveCount(0);
  await expect(frame).not.toHaveAttribute('data-old-pdf', 'yes');
  await page.getByLabel('Live', { exact: true }).check();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Draft two');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { compileRequests: string[] }).compileRequests),
    )
    .toEqual(['Draft one', 'Draft two']);
});

test('creates source files and folders from the explorer', async ({ page }) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce'),
    });
  });
  await page.addInitScript(() => {
    const files = new Map<string, string>([['/work/existing.md', '# Existing']]);
    const folders = new Set(['/work']);
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          (window as unknown as { clipboardText: string }).clipboardText = text;
        },
      },
    });
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === 'initial_path') return { path: '/work', directory: true };
          if (command === 'list_directory')
            return [...folders, ...files.keys()]
              .filter((path) => path.startsWith('/work/') && !path.slice(6).includes('/'))
              .map((path) => ({
                name: path.slice(6),
                path,
                directory: folders.has(path),
                symlink: false,
              }));
          if (command === 'read_document')
            return { text: files.get(String(args.path)) ?? '', stamp: '1' };
          if (command === 'read_text_file') return files.get(String(args.path)) ?? '';
          if (command === 'delete_file') {
            files.delete(String(args.path));
            return;
          }
          if (command === 'document_stamp') return '1';
          if (command === 'read_pdf') throw new Error('Compiler unavailable');
          if (command === 'create_entry') {
            const path = `${args.directory}/${args.name}`;
            if (files.has(path) || folders.has(path)) throw new Error('Entry already exists');
            if (args.kind === 'folder') folders.add(path);
            else
              files.set(
                path,
                args.kind === 'latex'
                  ? '\\documentclass{article}\\begin{document}\\end{document}'
                  : '',
              );
            return path;
          }
          if (command === 'rename_file') {
            const path = String(args.path);
            const next = `${path.slice(0, path.lastIndexOf('/'))}/${args.name}`;
            if (files.has(next) || folders.has(next)) throw new Error('Entry already exists');
            const content = files.get(path);
            if (content === undefined) throw new Error('File not found');
            files.delete(path);
            files.set(next, content);
            return next;
          }
          throw new Error(`Unavailable native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  await ensureExplorer(page);
  await expect(page.getByRole('button', { name: 'Create file or folder' })).toBeVisible();
  for (const [kind, name, result] of [
    ['folder', 'notes', 'notes'],
    ['markdown', 'draft', 'draft.md'],
    ['typst', 'paper.typ', 'paper.typ'],
    ['latex', 'thesis', 'thesis.tex'],
  ]) {
    await page.getByRole('button', { name: 'Create file or folder' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create new' });
    await dialog.locator(`input[name="entry-type"][value="${kind}"]`).check();
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (kind !== 'folder')
      await expect(page.getByRole('textbox', { name: 'Source editor' })).toBeVisible();
    await ensureExplorer(page);
    await expect(page.locator('.file-row').filter({ hasText: result })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Create file or folder' }).click();
  const duplicateDialog = page.getByRole('dialog', { name: 'Create new' });
  await duplicateDialog.getByLabel('Name').fill('draft');
  await duplicateDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(duplicateDialog.getByRole('alert')).toContainText('already exists');
  await duplicateDialog.getByRole('button', { name: 'Cancel' }).click();
  if ((page.viewportSize()?.width ?? 0) < 700) return;
  const editor = page.getByRole('textbox', { name: 'Source editor' });
  await editor.fill('Unsaved text');
  await page.locator('.file-row[data-path="/work/thesis.tex"]').dblclick();
  const rename = page.getByRole('textbox', { name: 'Rename file' });
  await rename.fill('renamed.tex');
  await rename.press('Enter');
  await expect(page.locator('.file-row[data-path="/work/renamed.tex"]')).toBeVisible();
  await expect(editor).toHaveText('Unsaved text');
  await expect(page.getByRole('button', { name: 'Save source' })).toBeEnabled();
  await page.locator('.file-row[data-path="/work/renamed.tex"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await expect(page.getByRole('textbox', { name: 'Rename file' })).toHaveValue('renamed.tex');
  await page.getByRole('textbox', { name: 'Rename file' }).press('Escape');
  await page.locator('.file-row[data-path="/work/renamed.tex"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy file contents' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { clipboardText: string }).clipboardText))
    .toBe('Unsaved text');
  await page.locator('.file-row[data-path="/work/renamed.tex"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy relative path' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { clipboardText: string }).clipboardText))
    .toBe('renamed.tex');
  await page.locator('.file-row[data-path="/work/renamed.tex"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy full path' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { clipboardText: string }).clipboardText))
    .toBe('/work/renamed.tex');
  await page.locator('.file-row[data-path="/work/renamed.tex"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete file…' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'unsaved changes' })).toBeVisible();
  await expect(editor).toHaveText('Unsaved text');
  await page.locator('.file-row[data-path="/work/notes"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New folder…' }).click();
  await expect(page.getByRole('dialog', { name: 'Create new' })).toContainText('/work/notes');
  await expect(page.getByRole('radio', { name: /Folder/ })).toBeChecked();
  await page
    .getByRole('dialog', { name: 'Create new' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await page.locator('.file-row[data-path="/work/existing.md"]').click({ button: 'right' });
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('menuitem', { name: 'Delete file…' }).click();
  await expect(page.locator('.file-row[data-path="/work/existing.md"]')).toBeVisible();
  await page.locator('.file-row[data-path="/work/existing.md"]').click({ button: 'right' });
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('menuitem', { name: 'Delete file…' }).click();
  await expect(page.locator('.file-row[data-path="/work/existing.md"]')).toHaveCount(0);
});

test('remembers expanded folders and the working directory separately from the tree root', async ({
  page,
}) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace('__TAURI_SCRIPT_NONCE__', 'testnonce'),
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          if (command === 'initial_path') return { path: '/work', directory: true };
          if (command === 'list_directory') {
            if (args.path === '/work')
              return [
                { name: 'chapters', path: '/work/chapters', directory: true, symlink: false },
              ];
            if (args.path === '/work/chapters')
              return [
                { name: 'notes', path: '/work/chapters/notes', directory: true, symlink: false },
              ];
            return [];
          }
          if (command === 'create_entry') return `${args.directory}/${args.name}`;
          throw new Error(`Unavailable native command: ${command}`);
        },
      },
    });
  });
  await page.goto('/');
  const chapters = page.locator('.file-row[data-path="/work/chapters"]');
  const notes = page.locator('.file-row[data-path="/work/chapters/notes"]');
  await ensureExplorer(page);
  await chapters.click();
  await notes.click();
  await expect(notes).toHaveClass(/working/);
  await expect(page.getByLabel('Directory path')).toHaveValue('/work');
  await page.getByRole('button', { name: 'Create file or folder' }).click();
  await expect(page.getByRole('dialog', { name: 'Create new' })).toContainText(
    '/work/chapters/notes',
  );
  await page
    .getByRole('dialog', { name: 'Create new' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await page.reload();
  await ensureExplorer(page);
  await expect(chapters).toHaveAttribute('aria-expanded', 'true');
  await expect(notes).toHaveAttribute('aria-expanded', 'true');
  await expect(notes).toHaveClass(/working/);
  await chapters.click({ button: 'right' });
  await expect(chapters).toHaveClass(/working/);
  await expect(page.getByRole('menuitem', { name: 'Open folder' })).toBeVisible();
});

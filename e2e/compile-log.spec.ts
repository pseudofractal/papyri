import { expect, test, type Page } from '@playwright/test';

const typstFailure = {
  id: 7,
  path: '/work/broken.typ',
  engine: 'typst',
  phase: 'Failed',
  detail: 'Typst reported an error',
  elapsedSeconds: 0.4,
  page: 0,
  totalPages: null,
  log: ['error: unknown variable: heading', '  ┌─ /work/broken.typ:2:1'],
  active: false,
  success: false,
  cancelled: false,
  error: 'error: unknown variable: heading',
};

const cancelled = {
  ...typstFailure,
  phase: 'Cancelled',
  detail: 'Compilation cancelled',
  log: ['partial compiler output'],
  error: '',
  cancelled: true,
};

const texDocument = Buffer.from(
  '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n',
);
const typstDocument = Buffer.from('= Heading\n\nTypst document.\n');
const markdownDocument = Buffer.from('# Notes\n\nPlain Markdown.\n');

async function installNativeMock(page: Page, snapshot = typstFailure) {
  await page.addInitScript((snapshot) => {
    Object.defineProperty(window, '__PAPYRI_PLATFORM__', {
      value: {
        os: 'linux',
        desktop: true,
        latex: true,
        typst: true,
      },
    });
    Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', { value: 'test-token' });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          if (command === 'declarative_preferences') return null;
          if (command === 'initial_path') return { path: '/work', directory: true, explicit: true };
          if (command === 'list_directory') return [];
          if (command === 'document_stamp') return '1';
          if (command === 'latex_engines' || command === 'typst_binary') return [];
          if (command === 'compile_log') return snapshot;
          if (command.startsWith('plugin:event|')) return 1;
          return null;
        },
      },
    });
  }, snapshot);
}

async function importDocument(page: Page, name: string, buffer: Buffer) {
  await page.getByLabel('Import selected files').setInputFiles({
    name,
    mimeType: name.endsWith('.tex')
      ? 'text/x-tex'
      : name.endsWith('.typ')
        ? 'text/plain'
        : 'text/markdown',
    buffer,
  });
}

test('shows the log button only when a LaTeX or Typst tab is open', async ({ page }) => {
  await installNativeMock(page);
  await page.goto('/');
  await importDocument(page, 'notes.md', markdownDocument);
  await expect(page.getByRole('group', { name: 'Open documents' })).toContainText('notes.md');
  await expect(page.getByRole('button', { name: 'Open compilation log' })).toHaveCount(0);

  await importDocument(page, 'paper.tex', texDocument);
  await expect(page.getByRole('group', { name: 'Open documents' })).toContainText('paper.tex');
  await expect(page.getByRole('button', { name: 'Open compilation log' })).toBeVisible();
});

test('does not expose the log in the browser build', async ({ page }) => {
  await page.goto('/');
  await importDocument(page, 'paper.tex', texDocument);
  await expect(page.getByRole('button', { name: 'Open compilation log' })).toHaveCount(0);

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search files and commands' });
  await search.fill('compilation log');
  await expect(palette.getByRole('option', { name: /Open compilation log/ })).toHaveCount(0);
});

test('matches the command palette default dimensions', async ({ page }) => {
  await installNativeMock(page);
  await page.goto('/');
  await importDocument(page, 'paper.tex', texDocument);
  await page.getByRole('button', { name: 'Open compilation log' }).click();

  const logDialog = page.getByRole('dialog', { name: 'Compilation log' });
  const logPanel = logDialog.locator('.log-panel');
  await expect(logPanel).toBeVisible();
  const logBox = await logPanel.boundingBox();

  await page.keyboard.press('Escape');
  await expect(logDialog).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palettePanel = page
    .getByRole('dialog', { name: 'Command palette' })
    .locator('.palette-panel');
  await expect(palettePanel).toBeVisible();
  const paletteBox = await palettePanel.boundingBox();

  expect(logBox).not.toBeNull();
  expect(paletteBox).not.toBeNull();
  expect(Math.abs(logBox!.width - paletteBox!.width)).toBeLessThan(1);
  expect(Math.abs(logBox!.height - paletteBox!.height)).toBeLessThan(1);
});

test('renders a cancelled compilation without an error', async ({ page }) => {
  await installNativeMock(page, cancelled);
  await page.goto('/');
  await importDocument(page, 'broken.typ', typstDocument);
  await page.getByRole('button', { name: 'Open compilation log' }).click();

  const dialog = page.getByRole('dialog', { name: 'Compilation log' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Cancelled');
  await expect(dialog).toContainText('partial compiler output');
  await expect(dialog.locator('.log p.error')).toHaveCount(0);
});

test('renders the most recent Typst failure and copies the full log', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installNativeMock(page);
  await page.goto('/');
  await importDocument(page, 'broken.typ', typstDocument);
  await page.getByRole('button', { name: 'Open compilation log' }).click();

  const dialog = page.getByRole('dialog', { name: 'Compilation log' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Typst');
  await expect(dialog).toContainText('Failed');
  await expect(
    dialog.locator('.log p', { hasText: 'error: unknown variable: heading' }),
  ).toHaveCount(1);

  const copyButton = dialog.locator('button.copy-log');
  await copyButton.click();
  await expect(copyButton).toHaveText('Copied');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('error: unknown variable: heading');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Open compilation log' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close compilation log' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Open compilation log' }).click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
});

import { expect, test } from '@playwright/test';

test('the showcase renders its math, references, and diagrams', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  const picker = page.getByLabel('Import selected files', { exact: true });
  await picker.setInputFiles('examples/showcase/markdown.md');
  let frame = page.frameLocator('iframe').first();
  await expect(frame.getByRole('heading', { name: 'Markdown and mathematics' })).toBeVisible();
  await expect(frame.locator('.katex').first()).toBeVisible();
  await frame.locator('a[href="#reference-1"]').click();
  await expect(frame.locator('#reference-1')).toBeInViewport();

  await picker.setInputFiles('examples/showcase/diagrams.md');
  frame = page.frameLocator('iframe').first();
  await expect(frame.getByRole('heading', { name: 'Diagrams and charts' })).toBeVisible();
  const diagrams = frame.locator('section.diagram');
  for (const [index, format] of ['mermaid', 'dot', 'vega', 'vega-lite'].entries()) {
    const diagram = diagrams.nth(index);
    await diagram.getByRole('button', { name: `Render ${format} diagram`, exact: true }).click();
    await expect(diagram.locator('svg').first()).toBeVisible();
  }
  await diagrams
    .nth(4)
    .getByRole('button', { name: 'Render plantuml diagram', exact: true })
    .click();
  await expect(diagrams.nth(4).getByText(/PlantUML requires Java/)).toBeVisible();
});

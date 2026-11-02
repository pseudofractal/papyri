import { expect, test } from '@playwright/test';

const document = {
  name: 'links.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from(
    '# Links\n\n[Website](https://preview.invalid/page)\n\n[Image](https://preview.invalid/image.png)\n\n[Private](https://user:secret@preview.invalid/private)\n\n[Email](mailto:reader@example.org)\n\n[Local](#links)',
  ),
};

test('shows the destination without making requests when network resources are blocked', async ({
  page,
}) => {
  let requests = 0;
  await page.route('https://preview.invalid/**', async (route) => {
    requests++;
    await route.abort();
  });
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles(document);
  const frame = page.frameLocator('iframe').first();
  await frame.getByRole('link', { name: 'Website' }).hover();
  await expect(frame.locator('.link-preview-destination')).toHaveText(
    'https://preview.invalid/page',
  );
  await expect(frame.locator('.link-preview-card')).toContainText('External previews are blocked');
  const cardBounds = (await frame.locator('.link-preview-card').boundingBox())!;
  const frameBounds = (await page.locator('iframe').first().boundingBox())!;
  expect(cardBounds.x).toBeGreaterThanOrEqual(frameBounds.x);
  expect(cardBounds.x + cardBounds.width).toBeLessThanOrEqual(frameBounds.x + frameBounds.width);
  expect(cardBounds.y + cardBounds.height).toBeLessThanOrEqual(frameBounds.y + frameBounds.height);
  await page.setViewportSize({ width: 340, height: 480 });
  await expect(frame.locator('.link-preview-card')).toBeHidden();
  expect(requests).toBe(0);
  await frame.getByRole('link', { name: 'Email' }).hover();
  await expect(frame.locator('.link-preview-destination')).toHaveText('mailto:reader@example.org');
  await expect(frame.locator('.link-preview-card')).toContainText('mail application');
  await frame.getByRole('link', { name: 'Local' }).hover();
  await expect(frame.locator('.link-preview-destination')).toBeHidden();
  await frame.getByRole('link', { name: 'Website' }).focus();
  await page.keyboard.press('Tab');
  await expect(frame.locator('.link-preview-destination')).toContainText('/image.png');
  await page.keyboard.press('Escape');
  await expect(frame.locator('.link-preview-destination')).toBeHidden();
});

test('previews images and sandboxed pages only when network resources are enabled', async ({
  page,
}) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1kAAAAASUVORK5CYII=',
    'base64',
  );
  await page.route('https://preview.invalid/**', async (route) => {
    if (route.request().url().endsWith('.png'))
      await route.fulfill({ contentType: 'image/png', body: png });
    else
      await route.fulfill({
        contentType: 'text/html',
        body: '<p>Preview page</p><script>document.body.dataset.executed = "yes"</script>',
      });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Reading preferences' })
    .getByRole('tab', { name: 'Documents', exact: true })
    .click();
  await page.getByRole('checkbox', { name: /Allow network resources/ }).check();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByLabel('Import selected files').setInputFiles(document);
  const frame = page.frameLocator('iframe').first();
  await frame.getByRole('link', { name: 'Image' }).hover();
  const image = frame.locator('.link-preview-card img');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(1);
  await frame.getByRole('link', { name: 'Website' }).hover();
  const nested = frame.locator('.link-preview-card iframe');
  await expect(nested).toHaveAttribute('sandbox', '');
  await expect(nested).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(nested).toHaveAttribute('tabindex', '-1');
  const previewPage = nested.contentFrame();
  await expect(previewPage.getByText('Preview page')).toBeVisible();
  await expect(previewPage.locator('body')).not.toHaveAttribute('data-executed', 'yes');
  await expect(frame.locator('.link-preview-card')).toContainText(
    'Some sites do not allow previews',
  );
  await frame.getByRole('link', { name: 'Private' }).hover();
  await expect(frame.locator('.link-preview-destination')).not.toContainText('secret');
  await expect(frame.locator('.link-preview-card')).toContainText('credentials');
  await expect(frame.locator('.link-preview-card iframe')).toHaveCount(0);
});

test('shows and previews external PDF links according to the network setting', async ({ page }) => {
  let requests = 0;
  await page.route('https://example.com/**', async (route) => {
    requests++;
    await route.fulfill({ contentType: 'text/html', body: '<p>External preview</p>' });
  });
  await page.goto('/');
  await page.getByLabel('Import selected files').setInputFiles('e2e/fixtures/paged.pdf');
  const frame = page.frameLocator('iframe').first();
  await expect(frame.locator('#page-count')).toHaveText('of 2');
  await frame.locator('a[data-preview-href^="https://example.com"]').hover();
  await expect(frame.locator('.link-preview-destination')).toContainText('example.com');
  await expect(frame.locator('.link-preview-card')).toContainText('External previews are blocked');
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Reading preferences' })
    .getByRole('tab', { name: 'Documents', exact: true })
    .click();
  await page.getByRole('checkbox', { name: /Allow network resources/ }).check();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(frame.locator('#page-count')).toHaveText('of 2');
  await frame.locator('a[data-preview-href^="https://example.com"]').hover();
  await expect(frame.locator('.link-preview-card iframe')).toHaveAttribute('sandbox', '');
  await expect.poll(() => requests).toBeGreaterThan(0);
});

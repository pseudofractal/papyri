import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const samples = Number(process.env.PAPYRI_BENCH_SAMPLES || 10);
if (!Number.isInteger(samples) || samples < 1) throw new Error('Sample count must be positive.');
const server = spawn(
  'node',
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '1421',
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
let browser;
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      server.stdout.on('data', (data) => {
        if (data.toString().includes('Local:')) resolve();
      });
      server.once('error', reject);
      server.once('exit', (code) => reject(new Error(`Preview server exited: ${code}`)));
    }),
    new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview server timed out.')), 15_000);
      timeout.unref();
    }),
  ]);
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  const results = [];
  for (let index = 0; index < samples; index++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const markAfterPaint = (name) =>
        requestAnimationFrame(() => requestAnimationFrame(() => performance.mark(name)));
      const observer = new MutationObserver(() => {
        if (document.querySelector('.app-header button')) {
          observer.disconnect();
          markAfterPaint('papyri-shell');
        }
      });
      observer.observe(document, { childList: true, subtree: true });
      window.addEventListener('message', (event) => {
        if (
          event.data?.type === 'ready' &&
          event.source === document.querySelector('iframe')?.contentWindow
        )
          markAfterPaint('papyri-preview');
      });
    });
    await page.goto('http://127.0.0.1:1421/');
    await page.waitForFunction(() => performance.getEntriesByName('papyri-preview').length > 0);
    const result = await page.evaluate(() => ({
      shellMs: performance.getEntriesByName('papyri-shell')[0]?.startTime,
      previewMs: performance.getEntriesByName('papyri-preview')[0].startTime,
      resources: performance
        .getEntriesByType('resource')
        .map((entry) => new URL(entry.name).pathname),
    }));
    results.push(result);
    await context.close();
  }
  const summary = (key) => {
    const values = results.map((result) => result[key]).sort((a, b) => a - b);
    return {
      medianMs: Math.round(values[Math.floor(values.length / 2)]),
      p95Ms: Math.round(values[Math.ceil(values.length * 0.95) - 1]),
      samplesMs: values.map(Math.round),
    };
  };
  console.log(
    JSON.stringify(
      {
        node: process.version,
        browser: browser.version(),
        platform: process.platform,
        samples,
        shell: summary('shellMs'),
        firstPreview: summary('previewMs'),
        resources: results[0].resources,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill();
  if (server.exitCode === null && server.signalCode === null) await once(server, 'exit');
}

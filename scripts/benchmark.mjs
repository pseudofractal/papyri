import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temporary = await mkdtemp(join(tmpdir(), 'papyri-benchmark-'));
try {
  const bundle = join(temporary, 'render.mjs');
  await build({
    entryPoints: ['src/render/markdown.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
  });
  const { renderMarkdown } = await import(pathToFileURL(bundle));
  const section =
    '## Section\n\nA paragraph with **bold**, [links](other.md), and `code`.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n';
  const results = [];
  for (const repeats of [1000, 10000]) {
    const source = section.repeat(repeats);
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      renderMarkdown(source);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    results.push({
      bytes: Buffer.byteLength(source),
      medianMs: Math.round(samples[2]),
      samplesMs: samples.map(Math.round),
    });
  }
  console.log(
    JSON.stringify({ node: process.version, platform: process.platform, results }, null, 2),
  );
} finally {
  await rm(temporary, { recursive: true });
}

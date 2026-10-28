import { build } from 'esbuild';
await build({
  entryPoints: ['src/render/frame.ts'],
  bundle: true,
  format: 'iife',
  outfile: 'public/renderer.js',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
});

await build({
  entryPoints: ['src/render/diagrams.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'mdviewDiagrams',
  outfile: 'public/diagrams.js',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});

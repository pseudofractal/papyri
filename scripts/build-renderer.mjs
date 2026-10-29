import { build, transform } from 'esbuild';
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';

const licenseDirectory = 'public/pdf-licenses';
await mkdir(licenseDirectory, { recursive: true });
await copyFile('node_modules/pdfjs-dist/LICENSE', `${licenseDirectory}/PDFJS.txt`);
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  for (const name of await readdir(`node_modules/pdfjs-dist/${directory}`)) {
    if (name.startsWith('LICENSE'))
      await copyFile(
        `node_modules/pdfjs-dist/${directory}/${name}`,
        `${licenseDirectory}/${directory}-${name}.txt`,
      );
  }
}
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
  globalName: 'papyriDiagrams',
  outfile: 'public/diagrams.js',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});

await build({
  entryPoints: ['src/render/pdf-frame.ts'],
  bundle: true,
  format: 'iife',
  outfile: 'public/pdf.js',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  loader: { '.svg': 'dataurl', '.gif': 'dataurl' },
  plugins: [
    {
      name: 'offline-pdf-resources',
      setup(build) {
        build.onResolve({ filter: /^papyri:pdf-resources$/ }, () => ({
          path: 'resources',
          namespace: 'pdf',
        }));
        build.onLoad({ filter: /.*/, namespace: 'pdf' }, async () => {
          const resources = {};
          for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
            for (const name of await readdir(`node_modules/pdfjs-dist/${directory}`)) {
              if (!/\.(bcmap|pfb|ttf|wasm)$/.test(name) || name.startsWith('quickjs')) continue;
              const bytes = await readFile(`node_modules/pdfjs-dist/${directory}/${name}`);
              resources[name] = bytes.toString('base64');
            }
          }
          return { contents: `export default ${JSON.stringify(resources)}`, loader: 'js' };
        });
        build.onLoad({ filter: /pdf\.worker\.mjs$/ }, async ({ path }) => ({
          contents: (
            await transform(await readFile(path, 'utf8'), {
              format: 'iife',
              target: 'es2022',
              minify: true,
            })
          ).code,
          loader: 'text',
        }));
      },
    },
  ],
});

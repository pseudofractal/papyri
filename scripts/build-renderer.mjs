import { build, transform } from 'esbuild';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const licenseDirectory = 'public/pdf-licenses';
const resourceDirectory = 'public/pdf-resources';
const dictionaryDirectory = 'public/dictionaries';
const resourceNames = [];
await mkdir(licenseDirectory, { recursive: true });
await mkdir(resourceDirectory, { recursive: true });
await mkdir(dictionaryDirectory, { recursive: true });
await copyFile('node_modules/pdfjs-dist/LICENSE', `${licenseDirectory}/PDFJS.txt`);
await mkdir('public/vendor-licenses', { recursive: true });
await copyFile(
  'src/assets/catppuccin-icons/LICENSE',
  'public/vendor-licenses/catppuccin-icons-MIT.txt',
);
await copyFile(
  'node_modules/@vscode/codicons/LICENSE',
  'public/vendor-licenses/codicons-CC-BY-4.0.txt',
);
await copyFile(
  'node_modules/@vscode/codicons/LICENSE-CODE',
  'public/vendor-licenses/codicons-MIT.txt',
);
for (const [source, destination] of [
  ['node_modules/dictionary-en/index.aff', 'en.aff'],
  ['node_modules/dictionary-en/index.dic', 'en.dic'],
  ['node_modules/dictionary-en/license', 'LICENSE-dictionary.txt'],
  ['node_modules/nspell/license', 'LICENSE-nspell.txt'],
])
  await copyFile(source, `${dictionaryDirectory}/${destination}`);
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  for (const name of await readdir(`node_modules/pdfjs-dist/${directory}`)) {
    if (/\.(bcmap|pfb|ttf|wasm)$/.test(name) && !name.startsWith('quickjs')) {
      if (resourceNames.includes(name)) throw new Error(`Duplicate PDF resource: ${name}`);
      resourceNames.push(name);
      await copyFile(
        `node_modules/pdfjs-dist/${directory}/${name}`,
        `${resourceDirectory}/${name}`,
      );
    }
    if (name.startsWith('LICENSE'))
      await copyFile(
        `node_modules/pdfjs-dist/${directory}/${name}`,
        `${licenseDirectory}/${directory}-${name}.txt`,
      );
  }
}
await writeFile('public/pdf-resources.json', JSON.stringify(resourceNames));
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
      name: 'inline-pdf-worker',
      setup(build) {
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

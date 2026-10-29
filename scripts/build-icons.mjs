import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const source = readFileSync(new URL('packaging/papyri-symbolic.svg', projectRoot), 'utf8');
const insetMark = source
  .replace('<svg ', '<svg x="8" y="8" ')
  .replace('width="128" height="128"', 'width="112" height="112"')
  .replace('currentColor', '#f5f5f5');
const launcher = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Papyri">
  <title>Papyri</title>
  <rect width="128" height="128" rx="28" fill="#242424"/>
  ${insetMark.trim()}
</svg>
`;

function output(relativePath, content) {
  const destination = new URL(relativePath, projectRoot);
  if (check) {
    if (!readFileSync(destination).equals(Buffer.from(content)))
      throw new Error(`${relativePath} is stale. Run nix develop -c npm run icons.`);
  } else writeFileSync(destination, content);
}

output('packaging/papyri.svg', launcher);
const sizes = new Map([
  [32, '32x32.png'],
  [64, '64x64.png'],
  [128, '128x128.png'],
  [256, '128x128@2x.png'],
  [512, 'icon.png'],
]);
for (const [size, filename] of sizes) {
  const png = execFileSync('rsvg-convert', ['--width', String(size), '--height', String(size)], {
    input: launcher,
    cwd: fileURLToPath(projectRoot),
  });
  output(`src-tauri/icons/${filename}`, png);
}
console.log(
  check ? 'App icons match the source SVG.' : 'Updated launcher SVG and Linux app icons.',
);

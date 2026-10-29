import { readFileSync } from 'node:fs';

const projectRoot = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, projectRoot), 'utf8');
const manifest = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargoVersion = read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1];
const cargoName = read('src-tauri/Cargo.toml').match(/^name = "([^"]+)"/m)?.[1];
const desktop = read('packaging/papyri.desktop').split('\n');
if (
  manifest.name !== 'papyri' ||
  lock.name !== manifest.name ||
  lock.packages[''].name !== manifest.name ||
  cargoName !== manifest.name ||
  tauri.productName !== 'Papyri' ||
  tauri.app.windows[0].title !== 'Papyri' ||
  ![
    'Name=Papyri',
    'Exec=papyri %f',
    'TryExec=papyri',
    'Icon=papyri',
    'StartupWMClass=papyri',
  ].every((entry) => desktop.includes(entry))
)
  throw new Error('Papyri branding disagrees across npm, Cargo, Tauri, or the desktop entry.');
if (
  ![lock.version, lock.packages[''].version, tauri.version, cargoVersion].every(
    (version) => version === manifest.version,
  )
)
  throw new Error('Release versions disagree across npm, Cargo, and Tauri metadata.');

const tag = process.argv[2];
if (tag && tag !== `v${manifest.version}`)
  throw new Error(`Tag ${tag} does not match application version v${manifest.version}.`);
console.log(`Release metadata agrees on v${manifest.version}.`);

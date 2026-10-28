import { readFileSync } from 'node:fs';

const projectRoot = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, projectRoot), 'utf8');
const manifest = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargoVersion = read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1];
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

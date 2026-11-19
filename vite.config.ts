import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(manifest.version),
    __APP_BUILD__: JSON.stringify(process.env.PAPYRI_BUILD_COMMIT ?? 'unknown'),
  },
  plugins: [svelte(), tailwindcss()],
  clearScreen: false,
  server: { strictPort: true, port: 1420 },
  test: { include: ['tests/**/*.test.ts'], benchmark: { include: ['tests/**/*.bench.ts'] } },
  build: { target: 'es2022' },
});

import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  base: './',
  plugins: [svelte(), tailwindcss()],
  clearScreen: false,
  server: { strictPort: true, port: 1420 },
  test: { include: ['tests/**/*.test.ts'], benchmark: { include: ['tests/**/*.bench.ts'] } },
  build: { target: 'es2022' },
});

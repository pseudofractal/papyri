import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
export default ts.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/renderer.*',
      'public/diagrams.js',
      'public/pdf.js',
      'public/pdf.css',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'test-results/**',
      'playwright-report/**',
      'result/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      'svelte/no-at-html-tags': 'error',
    },
  },
  { files: ['**/*.svelte.ts'], languageOptions: { parser: ts.parser } },
  {
    files: ['**/*.svelte'],
    languageOptions: { parserOptions: { parser: ts.parser } },
    rules: { 'svelte/prefer-svelte-reactivity': 'off' },
  },
);

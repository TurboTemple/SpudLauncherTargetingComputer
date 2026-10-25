import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'dev-dist/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // core/ is pure maths: no app layers, no browser globals. It runs unchanged in Node and the worker.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['../*', '!./*'], message: 'core/ may only import from core/.' },
            { group: ['*sensors*', '*data*', '*ui*', '*worker*', '*state*', 'preact*', 'leaflet', 'idb'], message: 'core/ must stay free of app and browser code.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'self',
        'fetch',
        'localStorage',
        'indexedDB',
        'location',
        'DeviceOrientationEvent',
        'OffscreenCanvas',
      ],
    },
  },
);

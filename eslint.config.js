import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    // Pasted into Shopify's pixel editor: top-level script, sandbox injects
    // analytics/browser/init alongside the usual browser globals.
    files: ['umami-pixel.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        analytics: 'readonly',
        browser: 'readonly',
        init: 'readonly',
      },
    },
  },
  {
    files: ['proxy/cloudflare-worker.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.serviceworker,
      },
    },
  },
];

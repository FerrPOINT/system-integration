import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from './playwright.config';

const origin = 'http://127.0.0.1:19774';
export default defineConfig({
  ...base,
  testMatch: ['choice-fields.spec.ts', 'pagination-navigation.spec.ts'],
  testIgnore: [],
  outputDir: './results/components',
  reporter: [['list'], ['json', { outputFile: './results/components.json' }]],
  use: { ...base.use, baseURL: origin },
  webServer: {
    command: 'corepack pnpm exec vite --host 127.0.0.1 --port 19774 --strictPort',
    cwd: fileURLToPath(new URL('../frontend/', import.meta.url)),
    url: origin + '/tests/choice-form.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

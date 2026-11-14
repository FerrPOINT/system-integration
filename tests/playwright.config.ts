import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './results/playwright',
  reporter: [['list'], ['html', { outputFolder: './results/report', open: 'never' }]],
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.SI_FRONTEND_URL || 'http://127.0.0.1:19673',
    // Browser traces capture login passwords and session headers.
    trace: 'off',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Novosibirsk',
  },
  projects: [
    { name: 'desktop', testIgnore: ['mobile-feed.spec.ts'], use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});

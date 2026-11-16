import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const origin = 'http://127.0.0.1:19778';
export default defineConfig({
  ...base,
  projects: base.projects?.map((project) => ({
    ...project,
    grepInvert: project.name === 'mobile' ? /@desktop/ : undefined,
  })),
  testDir: './production',
  outputDir: './results/production',
  reporter: [['list'], ['json', { outputFile: './results/production.json' }]],
  use: { ...base.use, baseURL: origin },
  globalSetup: './support/production-runtime.ts',
});

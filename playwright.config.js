import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://localhost:3100', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'node src/server.js', url: 'http://localhost:3100/healthz', reuseExistingServer: false,
    env: { PORT: '3100', HOST: '127.0.0.1', APP_ORIGIN: 'http://localhost:3100', APP_MODE: 'demo', DATABASE_PATH: ':memory:', ADMIN_PASSWORD: '' } }
});

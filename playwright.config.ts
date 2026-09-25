import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-тесты гоняют настоящий собранный фронт и настоящий сервер, но вместо
 * OpenRouter — мок (scripts/mock-openrouter.ts). Так проверяются 429, таймауты
 * и обрывы, которые у живой модели по заказу не получить. Ключ не нужен.
 *
 * Порты отдельные от dev-режима, чтобы тесты можно было запускать параллельно с `npm run dev`.
 */
const APP_PORT = 8790;
const MOCK_PORT = 8791;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // один сервер с лимитом запросов; тесты короткие, так проще и стабильнее
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx scripts/mock-openrouter.ts',
      port: MOCK_PORT,
      env: { MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'npx vite build && npx tsx server/index.ts --static',
      port: APP_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(APP_PORT),
        OPENROUTER_API_KEY: 'mock-key-never-sent-to-browser',
        OPENROUTER_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/api/v1`,
        OPENROUTER_MODEL: 'mock/model:free',
        FIRST_TOKEN_TIMEOUT_MS: '2000',
        IDLE_TIMEOUT_MS: '2000',
        RATE_LIMIT_PER_MINUTE: '1000',
      },
    },
  ],
});

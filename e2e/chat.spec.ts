import { expect, test, type Page } from '@playwright/test';

/*
 * Сценарий выбирается словом в сообщении — см. scripts/mock-openrouter.ts.
 * Серверные таймауты в тестах укорочены до 2 с (playwright.config.ts).
 */

const input = (page: Page) => page.getByRole('textbox', { name: 'Сообщение' });
const lastAnswer = (page: Page) => page.locator('.msg--assistant').last();
const liveRegion = (page: Page) => page.locator('[role=status][aria-live=polite]');

async function send(page: Page, text: string) {
  await input(page).fill(text);
  await input(page).press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('пустое состояние: пример из подсказки отправляется и ответ приходит потоком', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'О чём поговорим?' })).toBeVisible();
  await page.getByRole('button', { name: /Придумай пять названий/ }).click();

  await expect(page.getByText('Модель печатает…')).toBeVisible();
  // Текст появляется до окончания генерации — это и есть стриминг
  await expect(lastAnswer(page).locator('.md')).toContainText('Конечно!');
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();

  await expect(page.getByText('Модель печатает…')).toBeHidden({ timeout: 15_000 });
  await expect(lastAnswer(page).locator('table')).toBeVisible(); // markdown отрендерен
  await expect(liveRegion(page)).toHaveText('Ответ получен.');
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeVisible();
});

test('Esc останавливает генерацию, полученный текст остаётся, фокус в поле ввода', async ({ page }) => {
  await send(page, 'привет');
  await expect(lastAnswer(page).locator('.md')).toContainText('TypeScript');
  await page.keyboard.press('Escape');

  await expect(lastAnswer(page)).toContainText('Генерация остановлена.');
  const partial = await lastAnswer(page).locator('.md').innerText();
  await page.waitForTimeout(500);
  expect(await lastAnswer(page).locator('.md').innerText()).toBe(partial); // поток действительно оборван
  await expect(input(page)).toBeFocused();
  await expect(liveRegion(page)).toHaveText('Генерация остановлена.');

  // Интерфейс живой: можно сразу отправить следующее сообщение
  await send(page, 'ещё');
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();
});

test('кнопка «Стоп» и «Сгенерировать заново»', async ({ page }) => {
  await send(page, 'привет');
  await expect(lastAnswer(page).locator('.md')).toContainText('Конечно!');
  await page.getByRole('button', { name: 'Стоп' }).click();
  await expect(lastAnswer(page)).toContainText('Генерация остановлена.');

  await lastAnswer(page).getByRole('button', { name: 'Сгенерировать заново' }).click();
  await expect(page.locator('.msg')).toHaveCount(2); // старый ответ заменён, а не добавлен
  await expect(page.getByText('Модель печатает…')).toBeVisible();
});

test('429: понятное сообщение, честный статус в Network и повтор', async ({ page }) => {
  const response = page.waitForResponse('**/api/chat');
  await send(page, '429');
  expect((await response).status()).toBe(429);

  const notice = lastAnswer(page).locator('.notice');
  await expect(notice).toContainText('Модель перегружена');
  await expect(notice).toContainText(/лимит обычно снимается через \d+ с/);
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeVisible(); // не вечный спиннер

  await notice.getByRole('button', { name: 'Повторить' }).click();
  await expect(input(page)).toBeFocused();
  await expect(page.locator('.msg')).toHaveCount(2);
});

test('таймаут до первого токена → 504 и сообщение', async ({ page }) => {
  const response = page.waitForResponse('**/api/chat');
  await send(page, 'таймаут');
  expect((await response).status()).toBe(504);
  await expect(lastAnswer(page).locator('.notice')).toContainText('Модель не ответила вовремя');
});

test('модель замолчала посреди ответа: часть текста + ошибка', async ({ page }) => {
  await send(page, 'зависни');
  const answer = lastAnswer(page);
  await expect(answer.locator('.notice')).toContainText('Модель замолчала посреди ответа', { timeout: 10_000 });
  await expect(answer.locator('.md')).toContainText('fetchWithTimeout');
});

test('обрыв соединения у провайдера посреди ответа', async ({ page }) => {
  await send(page, 'обрыв');
  await expect(lastAnswer(page).locator('.notice')).toContainText('Проблема со связью');
  await expect(lastAnswer(page).locator('.md')).not.toBeEmpty();
});

test('ошибка провайдера внутри потока', async ({ page }) => {
  await send(page, 'ошибка');
  await expect(lastAnswer(page).locator('.notice')).toContainText('Ошибка модели');
});

test('модель пропала из каталога', async ({ page }) => {
  await send(page, '404');
  await expect(lastAnswer(page).locator('.notice')).toContainText('Модель недоступна');
});

test('пустой ответ модели не выглядит как успех', async ({ page }) => {
  await send(page, 'пусто');
  await expect(lastAnswer(page).locator('.notice')).toContainText('пустой ответ');
});

test('ответ обрезан по лимиту длины — пользователь это видит', async ({ page }) => {
  await send(page, 'длинно');
  await expect(lastAnswer(page)).toContainText('Ответ обрезан', { timeout: 10_000 });
});

test('reasoning-модель: «думает» дольше таймаута первого токена и не падает', async ({ page }) => {
  await send(page, 'думай');
  await expect(page.getByText('Модель думает…')).toBeVisible();
  await expect(lastAnswer(page).locator('.md')).toContainText('Конечно!', { timeout: 10_000 });
  await expect(lastAnswer(page).locator('.notice')).toHaveCount(0);
});

test('потеря сети посреди ответа', async ({ page, context }) => {
  await send(page, 'привет');
  await expect(lastAnswer(page).locator('.md')).toContainText('Конечно!');
  await context.setOffline(true);

  await expect(lastAnswer(page).locator('.notice')).toContainText('Пропало подключение к интернету');
  await expect(page.getByText('Нет подключения к интернету')).toBeVisible();
  await input(page).fill('набираю без сети');
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeDisabled();

  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeEnabled();
});

test('история переживает перезагрузку, в том числе посреди ответа', async ({ page }) => {
  await send(page, 'привет');
  await expect(lastAnswer(page).locator('.md')).toContainText('TypeScript');
  await page.reload();

  await expect(page.locator('.msg--user .msg-text')).toHaveText('привет');
  await expect(lastAnswer(page)).toContainText('Генерация остановлена.');
  await expect(lastAnswer(page).locator('.md')).toContainText('TypeScript');

  await page.getByRole('button', { name: 'Новый чат' }).click();
  await expect(page.getByRole('heading', { name: 'О чём поговорим?' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'О чём поговорим?' })).toBeVisible();
});

test('ключ не попадает в браузер: только свой origin, без Authorization', async ({ page, baseURL }) => {
  const requests: { url: string; auth?: string }[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), auth: r.headers()['authorization'] }));
  await page.reload();
  await send(page, 'привет');
  await expect(page.getByText('Модель печатает…')).toBeHidden({ timeout: 15_000 });

  expect(requests.length).toBeGreaterThan(0);
  for (const r of requests) {
    expect(r.url.startsWith(baseURL!)).toBe(true);
    expect(r.auth).toBeUndefined();
  }
  const html = await page.content();
  expect(html).not.toContain('mock-key-never-sent-to-browser');
});

test('клавиатура: Shift+Enter — перенос строки, Tab доходит до кнопки', async ({ page }) => {
  await input(page).focus();
  await page.keyboard.type('строка 1');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('строка 2');
  await expect(input(page)).toHaveValue('строка 1\nстрока 2');
  await expect(page.locator('.msg')).toHaveCount(0);

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.msg--user .msg-text')).toHaveText('строка 1\nстрока 2');
});

test('телефон: ничего не уезжает по горизонтали', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await send(page, 'привет');
  await expect(page.getByText('Модель печатает…')).toBeHidden({ timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('двойной клик по «Отправить» не останавливает только что начатый ответ', async ({ page }) => {
  await input(page).fill('привет');
  await page.getByRole('button', { name: 'Отправить' }).dblclick();
  await expect(lastAnswer(page).locator('.md')).toContainText('TypeScript');
  await expect(lastAnswer(page)).not.toContainText('Генерация остановлена');
});

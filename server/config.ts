const int = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const models = (process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

export const config = {
  apiKey: process.env.OPENROUTER_API_KEY?.trim() ?? '',
  baseUrl: (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
  /** Первая — основная, остальные — фолбэк на стороне OpenRouter (параметр `models`). */
  models,
  port: int('PORT', 8787),
  /** Сколько ждём первый токен. Бесплатные модели иногда долго стоят в очереди. */
  firstTokenTimeoutMs: int('FIRST_TOKEN_TIMEOUT_MS', 45_000),
  /** Сколько ждём следующий токен, если модель замолчала посреди ответа. */
  idleTimeoutMs: int('IDLE_TIMEOUT_MS', 30_000),
  /** Наш собственный лимит запросов с одного IP в минуту — чтобы прокси с ключом не стал открытым. */
  rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 20),
  systemPrompt:
    process.env.SYSTEM_PROMPT ??
    'Ты дружелюбный и точный ассистент. Отвечай на языке пользователя. ' +
      'Используй Markdown, когда он помогает: списки, таблицы, блоки кода с указанием языка.',
} as const;

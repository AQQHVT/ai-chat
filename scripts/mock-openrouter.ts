/**
 * Поддельный OpenRouter для локальной проверки краевых случаев без ключа и лимитов.
 *
 *   npm run mock                         # слушает :8788
 *   OPENROUTER_BASE_URL=http://127.0.0.1:8788/api/v1 OPENROUTER_API_KEY=mock npm run dev
 *
 * Сценарий выбирается по тексту последнего сообщения пользователя:
 *   «429»      → 429 Too Many Requests с Retry-After
 *   «таймаут»  → только keep-alive комментарии, ни одного токена
 *   «зависни»  → начинает отвечать и замолкает (idle-таймаут)
 *   «обрыв»    → несколько токенов, затем разрыв TCP-соединения
 *   «ошибка»   → ошибка провайдера внутри потока (HTTP 200 уже отправлен)
 *   «404»      → модель не найдена
 *   всё прочее → длинный markdown-ответ по слову раз в 40 мс
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 8788);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ANSWER = `Конечно! Вот короткий пример на **TypeScript** — функция, которая отменяет запрос по таймауту:

\`\`\`ts
async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
\`\`\`

Что здесь важно:

1. \`AbortController\` — стандартный способ отменить \`fetch\`.
2. Таймер обязательно чистим в \`finally\`, иначе он переживёт запрос.
3. Отмена приходит в \`catch\` как \`AbortError\` — её стоит отличать от сетевой ошибки.

| Состояние | Что видит пользователь |
|---|---|
| Ответ пришёл | Текст ответа |
| Таймаут | Сообщение и кнопка «Повторить» |
| Отмена | Уже полученный кусок текста |

Если нужно, могу показать тот же пример с повторными попытками и экспоненциальной задержкой.`;

const chunk = (content: string, finish: string | null = null) =>
  `data: ${JSON.stringify({ model: 'mock/llama:free', choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;

http
  .createServer(async (req, res) => {
    if (req.method !== 'POST') return res.writeHead(404).end();
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw) as { messages: Array<{ role: string; content: string }> };
    const last = body.messages.at(-1)?.content.toLowerCase() ?? '';
    let closed = false;
    res.on('close', () => {
      closed = true;
      console.log('[mock] клиент закрыл соединение');
    });
    console.log(`[mock] запрос: «${last.slice(0, 40)}»`);

    if (last.includes('429')) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '20' });
      return res.end(JSON.stringify({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-min' } }));
    }
    if (last.includes('404')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 404, message: 'No endpoints found for mock/model:free' } }));
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

    if (last.includes('таймаут')) {
      while (!closed) {
        res.write(': OPENROUTER PROCESSING\n\n');
        await sleep(2000);
      }
      return;
    }

    const words = ANSWER.split(/(?<=\s)/);
    for (let i = 0; i < words.length && !closed; i++) {
      if (last.includes('обрыв') && i === 25) return res.socket?.destroy();
      if (last.includes('зависни') && i === 25) {
        while (!closed) await sleep(1000);
        return;
      }
      if (last.includes('ошибка') && i === 25) {
        res.write(`data: ${JSON.stringify({ error: { code: 502, message: 'Provider returned error' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] })}\n\n`);
        return res.end();
      }
      res.write(chunk(words[i]));
      await sleep(40);
    }
    if (closed) return;
    res.write(chunk('', 'stop'));
    res.end('data: [DONE]\n\n');
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[mock] fake OpenRouter on http://127.0.0.1:${PORT}/api/v1`));

import { LIMITS, type ChatMessageDTO } from '../shared/protocol.ts';

/**
 * Проверяем тело запроса строго: сервер держит ключ, поэтому он — единственное
 * место, где можно не пустить мусор (роль `system`, гигантские тексты,
 * выбор произвольной платной модели) в OpenRouter от нашего имени.
 * Модель клиент не выбирает вовсе — она задана на сервере.
 */
export function parseChatRequest(
  body: unknown,
): { ok: true; messages: ChatMessageDTO[] } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { messages?: unknown }).messages)) {
    return { ok: false, message: 'Ожидается { messages: [...] }.' };
  }
  const raw = (body as { messages: unknown[] }).messages;
  if (raw.length === 0) return { ok: false, message: 'Пустой диалог.' };

  const messages: ChatMessageDTO[] = [];
  for (const m of raw) {
    if (typeof m !== 'object' || m === null) return { ok: false, message: 'Некорректное сообщение.' };
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') return { ok: false, message: 'Недопустимая роль сообщения.' };
    if (typeof content !== 'string') return { ok: false, message: 'Текст сообщения должен быть строкой.' };
    if (role === 'user' && content.length > LIMITS.maxMessageChars) {
      return { ok: false, message: `Сообщение длиннее ${LIMITS.maxMessageChars} символов.` };
    }
    // Пустые ответы ассистента (остановили до первого токена) в контекст не шлём.
    if (content.trim() === '') continue;
    messages.push({ role, content });
  }

  if (messages.at(-1)?.role !== 'user') {
    return { ok: false, message: 'Последним должно быть сообщение пользователя.' };
  }

  // Контекст обрезаем с начала. Первым в окне должно остаться сообщение пользователя —
  // некоторые модели плохо переносят диалог, начинающийся с реплики ассистента.
  let window = messages.slice(-LIMITS.maxContextMessages);
  const firstUser = window.findIndex((m) => m.role === 'user');
  window = window.slice(firstUser);

  return { ok: true, messages: window };
}

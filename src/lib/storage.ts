import type { Message } from '../types.ts';

/**
 * История хранится в sessionStorage:
 *  - переживает перезагрузку (F5, случайный свайп на телефоне) — терять диалог
 *    из-за этого обидно;
 *  - умирает вместе с вкладкой — «в рамках сессии», как в задании; на общем
 *    компьютере переписка не остаётся лежать в браузере навсегда;
 *  - у каждой вкладки своя история, две вкладки не перетирают друг друга.
 */
const KEY = 'ai-chat:history:v1';

export function loadHistory(): Message[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as Message[])
      .filter((m) => m && typeof m.id === 'string' && typeof m.content === 'string')
      .map((m) =>
        // Страницу перезагрузили посреди генерации — поток уже не вернуть.
        m.status === 'streaming' ? { ...m, status: 'stopped' as const } : m,
      );
  } catch {
    return []; // приватный режим, битые данные, запрет хранилища — просто начинаем с чистого листа
  }
}

export function saveHistory(messages: Message[]): void {
  try {
    if (messages.length === 0) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify(messages));
  } catch {
    /* переполнено или запрещено — история просто не переживёт перезагрузку */
  }
}

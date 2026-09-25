import { useEffect, useRef, useState } from 'react';
import type { Message } from '../types.ts';

/**
 * Текст для aria-live региона. Озвучиваем только переходы состояния последнего
 * ответа («модель отвечает» → «ответ готов» / «остановлено» / ошибка), а не сам
 * поток токенов: скринридер, читающий каждый чанк, сделал бы чат непригодным.
 */
export function useAnnouncer(messages: Message[]): string {
  const [text, setText] = useState('');
  const last = messages.at(-1);
  const key = last?.role === 'assistant' ? `${last.id}:${last.status}` : '';
  const prevKey = useRef(key);

  useEffect(() => {
    if (key === prevKey.current) return;
    prevKey.current = key;
    if (!last || last.role !== 'assistant') return;
    switch (last.status) {
      case 'streaming':
        setText('Модель отвечает…');
        break;
      case 'done':
        setText('Ответ получен.');
        break;
      case 'stopped':
        setText('Генерация остановлена.');
        break;
      case 'error':
        setText(`Ошибка: ${last.error?.message ?? 'не удалось получить ответ.'}`);
        break;
    }
  }, [key, last]);

  return text;
}

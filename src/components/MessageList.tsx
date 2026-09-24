import { useLayoutEffect, useRef } from 'react';
import type { Message } from '../types.ts';
import { MessageItem } from './MessageItem.tsx';

interface Props {
  messages: Message[];
  onRetry: () => void;
}

/**
 * Автоскролл «прилипает» к низу, только если пользователь и так был внизу.
 * Если он прокрутил вверх почитать начало ответа — не дёргаем его обратно
 * на каждом токене.
 */
export function MessageList({ messages, onRetry }: Props) {
  const stickRef = useRef(true);

  useLayoutEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement ?? document.documentElement;
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const last = messages.at(-1);
  useLayoutEffect(() => {
    // Новое сообщение пользователя — всегда показываем, иначе — только если «прилипли».
    // Скроллим окно до самого низа, а не элемент в видимую область: липкий футер
    // (поле ввода, плашка «нет сети») иначе перекрывал бы конец ответа.
    if (last?.role === 'user' || stickRef.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages.length, last?.content, last?.status, last?.role]);

  return (
    <section className="log" aria-labelledby="log-title">
      <h2 id="log-title" className="visually-hidden">
        Диалог
      </h2>
      <ol className="log-list">
        {messages.map((m, i) => {
          const canRetry = i === messages.length - 1 && (m.status === 'error' || m.status === 'stopped');
          return <MessageItem key={m.id} message={m} onRetry={canRetry ? onRetry : undefined} />;
        })}
      </ol>
    </section>
  );
}

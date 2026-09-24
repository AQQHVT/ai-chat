import { useLayoutEffect, useRef } from 'react';
import type { Message } from '../types.ts';
import { MessageItem } from './MessageItem.tsx';

interface Props {
  messages: Message[];
}

/**
 * Автоскролл «прилипает» к низу, только если пользователь и так был внизу.
 * Если он прокрутил вверх почитать начало ответа — не дёргаем его обратно
 * на каждом токене.
 */
export function MessageList({ messages }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
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
    if (last?.role === 'user' || stickRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, last?.content, last?.status, last?.role]);

  return (
    <section className="log" aria-labelledby="log-title">
      <h2 id="log-title" className="visually-hidden">
        Диалог
      </h2>
      <ol className="log-list">
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} />
        ))}
      </ol>
      <div ref={endRef} className="log-end" />
    </section>
  );
}

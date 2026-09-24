import { memo } from 'react';
import type { Message } from '../types.ts';
import { Markdown } from './Markdown.tsx';
import { TypingIndicator } from './TypingIndicator.tsx';

interface Props {
  message: Message;
}

export const MessageItem = memo(function MessageItem({ message }: Props) {
  const { role, content, status, error } = message;
  const isUser = role === 'user';

  return (
    <li className={`msg msg--${role}`}>
      <article aria-label={isUser ? 'Вы' : 'Модель'}>
        <h3 className="visually-hidden">{isUser ? 'Вы написали' : 'Ответ модели'}</h3>
        {isUser ? (
          <p className="msg-text">{content}</p>
        ) : (
          content && (
            <div className="msg-text md">
              <Markdown text={content} />
            </div>
          )
        )}

        {status === 'streaming' && <TypingIndicator />}

        {status === 'error' && error && (
          <p className="msg-note msg-note--error">{error.message}</p>
        )}
      </article>
    </li>
  );
});

import { memo } from 'react';
import type { Message } from '../types.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { Markdown } from './Markdown.tsx';
import { TypingIndicator } from './TypingIndicator.tsx';

interface Props {
  message: Message;
  /** Передаётся только последнему сообщению модели — повторять старые ответы бессмысленно. */
  onRetry?: () => void;
}

export const MessageItem = memo(function MessageItem({ message, onRetry }: Props) {
  const { role, content, status, error, thinking, finishReason, retryAt } = message;
  const isUser = role === 'user';
  const hasText = content.trim() !== '';

  return (
    <li className={`msg msg--${role}`}>
      <article aria-label={isUser ? 'Вы' : 'Модель'}>
        <h3 className="visually-hidden">{isUser ? 'Вы написали' : 'Ответ модели'}</h3>
        {isUser ? (
          <p className="msg-text">{content}</p>
        ) : (
          hasText && (
            <div className="msg-text md">
              <Markdown text={content} />
            </div>
          )
        )}

        {status === 'streaming' && <TypingIndicator thinking={thinking && !hasText} />}

        {status === 'done' && finishReason === 'length' && (
          <p className="msg-note">Ответ обрезан: модель упёрлась в лимит длины. Попросите её продолжить.</p>
        )}

        {status === 'stopped' && (
          <p className="msg-note">
            {hasText ? 'Генерация остановлена.' : 'Остановлено до начала ответа.'}
            {onRetry && (
              <>
                {' '}
                <button type="button" className="link-btn" onClick={onRetry}>
                  Сгенерировать заново
                </button>
              </>
            )}
          </p>
        )}

        {status === 'error' && error && <ErrorNotice error={error} retryAt={retryAt} onRetry={onRetry} partial={hasText} />}
      </article>
    </li>
  );
});

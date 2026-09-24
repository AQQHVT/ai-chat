import { useEffect, useRef } from 'react';
import { Composer } from './components/Composer.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { MessageList } from './components/MessageList.tsx';
import { useAnnouncer } from './hooks/useAnnouncer.ts';
import { useChat } from './hooks/useChat.ts';
import { useOnline } from './hooks/useOnline.ts';

export function App() {
  const { messages, isStreaming, send, stop, retry, reset } = useChat();
  const online = useOnline();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const announcement = useAnnouncer(messages);

  // Esc останавливает генерацию, где бы ни был фокус. Слушаем на document,
  // а не только в поле ввода: после клика по «Стоп» или по ссылке в ответе
  // фокус уже не в textarea.
  useEffect(() => {
    if (!isStreaming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        stop();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isStreaming, stop]);

  const newChat = () => {
    reset();
    inputRef.current?.focus();
  };

  const retryAndFocus = () => {
    retry();
    inputRef.current?.focus(); // кнопка «Повторить» исчезнет — не бросаем фокус в никуда
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <h1 className="app-title">Чат с моделью</h1>
          {messages.length > 0 && (
            <button type="button" className="btn btn--ghost" onClick={newChat}>
              Новый чат
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {messages.length === 0 ? (
          <EmptyState onPick={send} />
        ) : (
          <MessageList messages={messages} onRetry={retryAndFocus} />
        )}
      </main>

      <footer className="app-footer">
        {!online && (
          <p className="offline" role="status">
            Нет подключения к интернету. Сообщение можно набрать — отправите, когда связь вернётся.
          </p>
        )}
        <Composer inputRef={inputRef} isStreaming={isStreaming} canSend={online} onSend={send} onStop={stop} />
      </footer>

      {/* Для скринридеров: короткие сообщения о смене состояния, а не каждый токен ответа. */}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}

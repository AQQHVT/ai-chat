import { useRef } from 'react';
import { Composer } from './components/Composer.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { MessageList } from './components/MessageList.tsx';
import { useChat } from './hooks/useChat.ts';

export function App() {
  const { messages, isStreaming, send, reset } = useChat();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const newChat = () => {
    reset();
    inputRef.current?.focus();
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
        {messages.length === 0 ? <EmptyState onPick={send} /> : <MessageList messages={messages} />}
      </main>

      <footer className="app-footer">
        <Composer inputRef={inputRef} isStreaming={isStreaming} onSend={send} />
      </footer>
    </div>
  );
}

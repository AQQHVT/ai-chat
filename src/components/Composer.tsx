import { useLayoutEffect, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { LIMITS } from '../../shared/protocol.ts';

interface Props {
  isStreaming: boolean;
  onSend: (text: string) => boolean;
  onStop: () => void;
  /** false — нет сети: печатать можно, отправлять нельзя. */
  canSend: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function Composer({ isStreaming, onSend, onStop, canSend: online, inputRef }: Props) {
  const [text, setText] = useState('');

  // Поле растёт вместе с текстом (до max-height в CSS), потом скроллится.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, inputRef]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (onSend(text)) setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing: Enter, подтверждающий ввод в японской/китайской раскладке, не должен отправлять.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // Во время генерации Enter ничего не отправляет, но и текст не теряется:
      // можно спокойно набирать следующий вопрос.
      if (canSend) submit();
    }
  };

  const tooLong = text.length > LIMITS.maxMessageChars;
  const canSend = online && text.trim() !== '' && !tooLong && !isStreaming;

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="composer-input" className="visually-hidden">
        Сообщение
      </label>
      <div className="composer-box">
        <textarea
          id="composer-input"
          ref={inputRef}
          className="composer-input"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Сообщение…"
          aria-describedby="composer-hint"
          aria-invalid={tooLong || undefined}
          enterKeyHint="send"
          autoComplete="off"
        />
        {/*
          Одна и та же кнопка меняет роль «Отправить» ↔ «Стоп». Это один DOM-элемент,
          поэтому фокус с клавиатуры не теряется, когда генерация начинается/заканчивается.
        */}
        <button
          type={isStreaming ? 'button' : 'submit'}
          className={`btn composer-btn ${isStreaming ? 'btn--stop' : 'btn--primary'}`}
          onClick={isStreaming ? onStop : undefined}
          disabled={!isStreaming && !canSend}
          aria-keyshortcuts={isStreaming ? 'Escape' : undefined}
        >
          {isStreaming ? (
            <>
              <span className="stop-icon" aria-hidden="true" />
              Стоп
            </>
          ) : (
            'Отправить'
          )}
        </button>
      </div>
      <p id="composer-hint" className="composer-hint">
        {tooLong ? (
          <span className="composer-hint--error">
            Слишком длинно: {text.length} из {LIMITS.maxMessageChars} символов
          </span>
        ) : (
          isStreaming ? (
            <>
              <kbd>Esc</kbd> — остановить генерацию
            </>
          ) : (
            <>
              <kbd>Enter</kbd> — отправить, <kbd>Shift</kbd>+<kbd>Enter</kbd> — новая строка
            </>
          )
        )}
      </p>
    </form>
  );
}

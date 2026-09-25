import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageDTO, ErrorPayload } from '../../shared/protocol.ts';
import { ChatError, streamChat } from '../api/chatStream.ts';
import { loadHistory, saveHistory } from '../lib/storage.ts';
import type { Message } from '../types.ts';

const uid = () => crypto.randomUUID();

const toDTO = (messages: Message[]): ChatMessageDTO[] =>
  messages.filter((m) => m.content.trim() !== '').map(({ role, content }) => ({ role, content }));

/** Почему оборвали запрос — от этого зависит, что увидит пользователь. */
type AbortReason = 'user' | 'offline' | 'reset';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const controllerRef = useRef<AbortController | null>(null);
  const isStreaming = messages.some((m) => m.status === 'streaming');

  // Сохранение. Вне стрима — сразу. Во время стрима — не чаще раза в секунду
  // (throttle, а не debounce: токены идут непрерывно, и debounce-таймер
  // перезапускался бы бесконечно, так ничего и не сохранив до конца ответа).
  const latest = useRef(messages);
  const lastSave = useRef(0);
  useEffect(() => {
    latest.current = messages;
    const now = Date.now();
    if (!isStreaming || now - lastSave.current >= 1000) {
      lastSave.current = now;
      saveHistory(messages);
    }
  }, [messages, isStreaming]);

  // Перезагрузка/закрытие посреди ответа: дописываем самое свежее состояние.
  useEffect(() => {
    const onHide = () => saveHistory(latest.current);
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // Уходим со страницы/размонтируемся — обрываем запрос, чтобы сервер отменил генерацию.
  useEffect(() => () => controllerRef.current?.abort('reset' satisfies AbortReason), []);

  // Браузер сообщил, что сеть пропала. fetch в таком случае может «висеть»
  // десятки секунд, прежде чем упасть сам, — не заставляем человека ждать.
  useEffect(() => {
    const onOffline = () => controllerRef.current?.abort('offline' satisfies AbortReason);
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, []);

  const patch = useCallback((id: string, fn: (m: Message) => Message) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const run = useCallback(
    async (history: Message[]) => {
      const assistantId = uid();
      setMessages([...history, { id: assistantId, role: 'assistant', content: '', status: 'streaming' }]);

      controllerRef.current?.abort('reset' satisfies AbortReason);
      const controller = new AbortController();
      controllerRef.current = controller;

      // Токены приходят чаще, чем экран перерисовывается. Копим их и сбрасываем
      // в состояние раз в кадр — иначе длинный ответ с markdown будет подтормаживать.
      let pending = '';
      let frame = 0;
      const flush = () => {
        frame = 0;
        if (!pending) return;
        const text = pending;
        pending = '';
        patch(assistantId, (m) => ({ ...m, content: m.content + text }));
      };

      let final: Pick<Message, 'status' | 'error' | 'finishReason' | 'retryAt'> | null = null;
      const fail = (error: ErrorPayload): NonNullable<typeof final> => ({
        status: 'error',
        error,
        retryAt: error.retryAfter ? Date.now() + error.retryAfter * 1000 : undefined,
      });
      try {
        for await (const event of streamChat(toDTO(history), controller.signal)) {
          if (event.type === 'delta') {
            pending += event.text;
            if (!frame) frame = requestAnimationFrame(flush);
          } else if (event.type === 'thinking') {
            patch(assistantId, (m) => (m.thinking ? m : { ...m, thinking: true }));
          } else if (event.type === 'meta') {
            patch(assistantId, (m) => ({ ...m, model: event.model }));
          } else if (event.type === 'done') {
            final = { status: 'done', finishReason: event.finishReason };
          } else if (event.type === 'error') {
            const { type: _type, ...error } = event;
            final = fail(error);
          }
        }
        final ??= fail({ code: 'network', message: 'Ответ оборвался, не дойдя до конца.' });
      } catch (err) {
        const reason = controller.signal.reason as AbortReason | undefined;
        if (controller.signal.aborted && reason === 'offline') {
          final = fail({ code: 'network', message: 'Пропало подключение к интернету.' });
        } else if (controller.signal.aborted) {
          final = { status: 'stopped' };
        } else if (err instanceof ChatError) {
          final = fail(err.payload);
        } else {
          console.error(err);
          final = fail({ code: 'upstream', message: 'Что-то пошло не так. Попробуйте ещё раз.' });
        }
      } finally {
        cancelAnimationFrame(frame);
        flush(); // не теряем хвост, пришедший в последнем кадре
        if (controllerRef.current === controller) controllerRef.current = null;
      }

      const result = final;
      patch(assistantId, (m) => ({ ...m, ...result, thinking: false }));
    },
    [patch],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || isStreaming) return false;
      void run([...messages, { id: uid(), role: 'user', content, status: 'done' }]);
      return true;
    },
    [messages, isStreaming, run],
  );

  /** Стоп: обрываем запрос. Уже полученный текст остаётся в истории со статусом «остановлено». */
  const stop = useCallback(() => {
    controllerRef.current?.abort('user' satisfies AbortReason);
  }, []);

  /** Повтор последнего ответа: убираем неудачную реплику модели и спрашиваем заново. */
  const retry = useCallback(() => {
    if (isStreaming) return;
    const last = messages.at(-1);
    if (last?.role !== 'assistant') return;
    void run(messages.slice(0, -1));
  }, [messages, isStreaming, run]);

  const reset = useCallback(() => {
    controllerRef.current?.abort('reset' satisfies AbortReason);
    setMessages([]);
  }, []);

  return { messages, isStreaming, send, stop, retry, reset };
}

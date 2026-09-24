import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageDTO, ErrorPayload } from '../../shared/protocol.ts';
import { ChatError, streamChat } from '../api/chatStream.ts';
import { loadHistory, saveHistory } from '../lib/storage.ts';
import type { Message } from '../types.ts';

const uid = () => crypto.randomUUID();

const toDTO = (messages: Message[]): ChatMessageDTO[] =>
  messages.filter((m) => m.content.trim() !== '').map(({ role, content }) => ({ role, content }));

export function useChat() {
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const controllerRef = useRef<AbortController | null>(null);
  const isStreaming = messages.some((m) => m.status === 'streaming');

  // Во время стрима пишем в хранилище не чаще раза в секунду, в остальное время — сразу.
  useEffect(() => {
    if (!isStreaming) {
      saveHistory(messages);
      return;
    }
    const t = setTimeout(() => saveHistory(messages), 1000);
    return () => clearTimeout(t);
  }, [messages, isStreaming]);

  // Уходим со страницы/размонтируемся — обрываем запрос, чтобы сервер отменил генерацию.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const patch = useCallback((id: string, fn: (m: Message) => Message) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const run = useCallback(
    async (history: Message[]) => {
      const assistantId = uid();
      setMessages([...history, { id: assistantId, role: 'assistant', content: '', status: 'streaming' }]);

      controllerRef.current?.abort();
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

      let final: { status: Message['status']; error?: ErrorPayload } | null = null;
      try {
        for await (const event of streamChat(toDTO(history), controller.signal)) {
          if (event.type === 'delta') {
            pending += event.text;
            if (!frame) frame = requestAnimationFrame(flush);
          } else if (event.type === 'meta') {
            patch(assistantId, (m) => ({ ...m, model: event.model }));
          } else if (event.type === 'done') {
            final = { status: 'done' };
          } else if (event.type === 'error') {
            const { type: _type, ...error } = event;
            final = { status: 'error', error };
          }
        }
        final ??= {
          status: 'error',
          error: { code: 'network', message: 'Ответ оборвался, не дойдя до конца.' },
        };
      } catch (err) {
        if (controller.signal.aborted) final = { status: 'stopped' };
        else if (err instanceof ChatError) final = { status: 'error', error: err.payload };
        else final = { status: 'error', error: { code: 'upstream', message: 'Что-то пошло не так. Попробуйте ещё раз.' } };
      } finally {
        cancelAnimationFrame(frame);
        flush(); // не теряем хвост, пришедший в последнем кадре
        if (controllerRef.current === controller) controllerRef.current = null;
      }

      const result = final;
      patch(assistantId, (m) => ({ ...m, ...result }));
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

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, isStreaming, send, reset };
}

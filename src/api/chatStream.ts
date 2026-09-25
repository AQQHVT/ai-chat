import type { ChatMessageDTO, ErrorBody, ErrorPayload, StreamEvent } from '../../shared/protocol.ts';

/** Ошибка, которую можно показать пользователю как есть. */
export class ChatError extends Error {
  readonly payload: ErrorPayload;
  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.name = 'ChatError';
    this.payload = payload;
  }
}

/**
 * Отправляет диалог на наш сервер и отдаёт события по мере прихода
 * (async-генератор: потребитель пишет обычный `for await`).
 *
 * Почему fetch + ReadableStream, а не EventSource: EventSource умеет только GET
 * без тела и не отменяется через AbortController. Здесь POST с историей и
 * честная отмена одной строчкой `controller.abort()`.
 */
/**
 * Сторож на клиенте. Основные таймауты живут на сервере (45 с до первого токена,
 * 30 с между токенами) и приходят к нам нормальной ошибкой. Этот нужен на случай,
 * когда до нас не доходит вообще ничего: сервер завис, соединение «повисло» без
 * разрыва (мобильная сеть, спящий ноутбук). Поэтому он заметно длиннее серверных.
 */
const CLIENT_SILENCE_TIMEOUT_MS = 60_000;

export async function* streamChat(messages: ChatMessageDTO[], signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const watchdog = new AbortController();
  let timer = setTimeout(() => watchdog.abort(), CLIENT_SILENCE_TIMEOUT_MS);
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(() => watchdog.abort(), CLIENT_SILENCE_TIMEOUT_MS);
  };
  const combined = AbortSignal.any([signal, watchdog.signal]);
  const failure = (network: ErrorPayload): ChatError =>
    watchdog.signal.aborted
      ? new ChatError({ code: 'timeout', message: 'Сервер слишком долго молчит. Попробуйте ещё раз.' })
      : new ChatError(network);

  try {
    yield* read(messages, signal, combined, kick, failure);
  } finally {
    clearTimeout(timer);
  }
}

async function* read(
  messages: ChatMessageDTO[],
  signal: AbortSignal,
  combined: AbortSignal,
  kick: () => void,
  failure: (network: ErrorPayload) => ChatError,
): AsyncGenerator<StreamEvent> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: combined,
    });
  } catch (err) {
    if (signal.aborted) throw err; // отмена пользователем — пробрасываем как есть
    throw failure({ code: 'network', message: 'Нет связи с сервером. Проверьте подключение к интернету.' });
  }
  kick();

  if (!res.ok || !res.body) throw new ChatError(await readError(res));

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (signal.aborted) throw err;
        throw failure({ code: 'network', message: 'Соединение с сервером оборвалось посреди ответа.' });
      }
      if (chunk.done) break;
      kick();
      buffer += chunk.value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line) as StreamEvent;
      }
    }
  } finally {
    // Если потребитель вышел из цикла раньше (break/throw) — закрываем поток, а не просто отпускаем.
    await reader.cancel().catch(() => {});
  }
}

async function readError(res: Response): Promise<ErrorPayload> {
  try {
    const body = (await res.json()) as Partial<ErrorBody>;
    if (body.error?.message) return body.error;
  } catch {
    /* не JSON — например, Vite-прокси ответил 502, потому что Node-сервер не запущен */
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return { code: 'network', message: 'Сервер чата недоступен. Возможно, он не запущен или перезапускается.' };
  }
  return { code: 'upstream', message: `Сервер ответил ошибкой ${res.status}.` };
}

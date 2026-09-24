import type { ChatMessageDTO, ErrorPayload, StreamEvent } from '../shared/protocol.ts';
import { config } from './config.ts';
import { SseParser } from './sse.ts';

export type OpenResult =
  | { ok: true; events: AsyncGenerator<StreamEvent> }
  | { ok: false; status: number; error: ErrorPayload }
  | { ok: false; status: 0; aborted: true };

type AbortCause = 'client' | 'timeout';

/**
 * Открывает стрим у OpenRouter.
 *
 * Разделено на две фазы, потому что у них разная судьба ошибок:
 *  1. до первого байта тела мы ещё можем ответить клиенту честным HTTP-статусом;
 *  2. после — только событием `error` внутри NDJSON.
 *
 * `clientSignal` — отмена со стороны браузера (Стоп / закрытая вкладка). Мы
 * пробрасываем её в fetch к OpenRouter, иначе модель продолжала бы генерировать
 * «в пустоту» и жечь лимиты бесплатного тарифа.
 */
export async function openChatStream(
  messages: ChatMessageDTO[],
  clientSignal: AbortSignal,
): Promise<OpenResult> {
  const upstream = new AbortController();
  let abortCause: AbortCause | null = null;
  const abort = (cause: AbortCause) => {
    if (abortCause) return;
    abortCause = cause;
    upstream.abort();
  };

  const onClientAbort = () => abort('client');
  if (clientSignal.aborted) return { ok: false, status: 0, aborted: true };
  clientSignal.addEventListener('abort', onClientAbort, { once: true });

  // Один таймер на всё время жизни запроса: сначала «ждём первый токен»,
  // затем после каждого токена перезаводится на «модель замолчала».
  let timer = setTimeout(() => abort('timeout'), config.firstTokenTimeoutMs);
  const resetTimer = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => abort('timeout'), ms);
  };
  const cleanup = () => {
    clearTimeout(timer);
    clientSignal.removeEventListener('abort', onClientAbort);
  };

  const [model, ...fallbacks] = config.models;
  const body = {
    ...(fallbacks.length > 0 ? { models: config.models } : { model }),
    stream: true,
    messages: [{ role: 'system', content: config.systemPrompt }, ...messages],
  };

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'AI chat test task',
      },
      body: JSON.stringify(body),
      signal: upstream.signal,
    });
  } catch {
    cleanup();
    if (abortCause === 'client') return { ok: false, status: 0, aborted: true };
    if (abortCause === 'timeout') return { ok: false, status: 504, error: timeoutError() };
    return {
      ok: false,
      status: 502,
      error: { code: 'network', message: 'Сервер не смог связаться с OpenRouter. Проверьте подключение и попробуйте ещё раз.' },
    };
  }

  if (!res.ok || !res.body) {
    const error = await describeHttpError(res);
    cleanup();
    return { ok: false, status: statusFor(error.code, res.status), error };
  }

  const stream = res.body;
  async function* events(): AsyncGenerator<StreamEvent> {
    const parser = new SseParser();
    const decoder = new TextDecoder();
    let finishReason: string | null = null;
    let gotDone = false;
    let gotAnyText = false;
    let sentMeta = false;

    try {
      for await (const chunk of stream) {
        for (const data of parser.push(decoder.decode(chunk, { stream: true }))) {
          if (data === '[DONE]') {
            gotDone = true;
            continue;
          }
          let json: OpenRouterChunk;
          try {
            json = JSON.parse(data) as OpenRouterChunk;
          } catch {
            continue; // битый чанк — пропускаем, не роняем весь ответ
          }

          if (json.model && !sentMeta) {
            sentMeta = true; // какая модель реально отвечает (важно при фолбэке `models`)
            yield { type: 'meta', model: json.model };
          }

          if (json.error) {
            // Ошибка провайдера посреди потока: HTTP 200 уже ушёл, сообщаем событием.
            yield { type: 'error', ...mapUpstreamError(json.error.code, json.error.message) };
            return;
          }

          const choice = json.choices?.[0];
          const text = choice?.delta?.content;
          if (text) {
            gotAnyText = true;
            resetTimer(config.idleTimeoutMs);
            yield { type: 'delta', text };
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        }
      }
      parser.flush();
    } catch {
      if (abortCause === 'client') return; // клиент ушёл — писать уже некому
      if (abortCause === 'timeout') {
        yield { type: 'error', ...timeoutError(gotAnyText) };
        return;
      }
      yield { type: 'error', code: 'network', message: 'Соединение с моделью оборвалось посреди ответа.' };
      return;
    } finally {
      cleanup();
    }

    if (finishReason === 'error') {
      yield { type: 'error', code: 'upstream', message: 'Провайдер модели прервал генерацию с ошибкой.' };
      return;
    }
    if (!gotDone && !finishReason) {
      yield { type: 'error', code: 'network', message: 'Ответ модели оборвался, не дойдя до конца.' };
      return;
    }
    yield { type: 'done', finishReason };
  }

  return { ok: true, events: events() };
}

interface OpenRouterChunk {
  model?: string;
  error?: { code?: number | string; message?: string };
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
}

function timeoutError(midStream = false): ErrorPayload {
  return {
    code: 'timeout',
    message: midStream
      ? 'Модель замолчала посреди ответа и не отвечает. Попробуйте ещё раз.'
      : 'Модель слишком долго не начинает отвечать — бесплатные модели бывают перегружены. Попробуйте ещё раз.',
  };
}

async function describeHttpError(res: Response): Promise<ErrorPayload> {
  let message: string | undefined;
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    message = json.error?.message;
  } catch {
    /* тело не JSON — не страшно */
  }
  const mapped = mapUpstreamError(res.status, message);
  if (mapped.code === 'rate_limit') {
    const retryAfter = parseRetryAfter(res.headers);
    if (retryAfter) mapped.retryAfter = retryAfter;
  }
  // Подробности от OpenRouter пишем в лог сервера, пользователю — человеческий текст.
  console.warn(`[openrouter] HTTP ${res.status}: ${message ?? '(без описания)'}`);
  return mapped;
}

function mapUpstreamError(code: number | string | undefined, raw?: string): ErrorPayload {
  const status = typeof code === 'number' ? code : Number.parseInt(String(code ?? ''), 10);
  switch (true) {
    case status === 429:
      return {
        code: 'rate_limit',
        message: 'Бесплатная модель сейчас перегружена или исчерпан лимит запросов. Подождите немного и повторите.',
      };
    case status === 401 || status === 403:
      return { code: 'config', message: 'Сервер не может авторизоваться в OpenRouter: проверьте API-ключ в .env.' };
    case status === 402:
      return { code: 'config', message: 'На аккаунте OpenRouter недостаточно кредитов для этого запроса.' };
    case status === 404 || /no endpoints|not a valid model|model.*not found/i.test(raw ?? ''):
      return {
        code: 'model_unavailable',
        message: 'Модель недоступна — возможно, её убрали из бесплатного каталога. Поменяйте OPENROUTER_MODEL.',
      };
    case status === 408 || status === 504 || status === 524:
      return timeoutError();
    case status === 400:
      return { code: 'bad_request', message: 'OpenRouter отклонил запрос. Возможно, диалог слишком длинный — начните новый.' };
    default:
      return { code: 'upstream', message: 'Модель ответила ошибкой. Попробуйте ещё раз чуть позже.' };
  }
}

export function statusFor(code: ErrorPayload['code'], upstreamStatus: number): number {
  switch (code) {
    case 'rate_limit':
      return 429;
    case 'timeout':
      return 504;
    case 'bad_request':
      return 400;
    default:
      // Ошибки конфигурации и провайдера для браузера — это «плохой шлюз»,
      // а не его собственные 401/402: авторизуется здесь сервер, а не пользователь.
      return upstreamStatus >= 500 ? upstreamStatus : 502;
  }
}

function parseRetryAfter(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  // OpenRouter отдаёт момент сброса лимита в миллисекундах эпохи.
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > Date.now()) return Math.ceil((reset - Date.now()) / 1000);
  return undefined;
}

/**
 * Контракт между браузером и нашим сервером.
 *
 * Запрос:  POST /api/chat  { messages: ChatMessageDTO[] }
 * Ответ:
 *   - ошибка ДО начала генерации → обычный HTTP-статус (400/429/502/504…) + JSON `ErrorBody`;
 *   - успех → 200, `application/x-ndjson`, по одному `StreamEvent` на строку.
 *     Ошибка ПОСЛЕ начала генерации приходит событием `{ type: 'error' }` —
 *     статус к этому моменту уже отправлен и поменять его нельзя.
 */

export type ChatRole = 'user' | 'assistant';

export interface ChatMessageDTO {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessageDTO[];
}

export type ErrorCode =
  | 'rate_limit' // 429: от OpenRouter/бесплатной модели или наш собственный лимит
  | 'timeout' // модель слишком долго молчит
  | 'network' // соединение оборвалось (браузер ↔ сервер или сервер ↔ OpenRouter)
  | 'model_unavailable' // модель убрали из каталога / нет провайдеров
  | 'upstream' // прочие 5xx и ошибки внутри потока
  | 'config' // сервер не настроен: нет ключа, ключ отозван, кончились кредиты
  | 'bad_request'; // некорректный запрос от клиента

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  /** Через сколько секунд имеет смысл повторить (для rate_limit), если известно. */
  retryAfter?: number;
}

export interface ErrorBody {
  error: ErrorPayload;
}

export type StreamEvent =
  | { type: 'meta'; model: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason: string | null }
  | ({ type: 'error' } & ErrorPayload);

/** Лимиты, общие для клиента и сервера. */
export const LIMITS = {
  /** Максимальная длина одного сообщения пользователя, символов. */
  maxMessageChars: 8_000,
  /** Сколько последних сообщений уходит в модель как контекст. */
  maxContextMessages: 30,
  /** Максимальный размер тела запроса, байт. */
  maxBodyBytes: 512 * 1024,
} as const;

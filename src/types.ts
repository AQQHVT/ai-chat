import type { ChatRole, ErrorPayload } from '../shared/protocol.ts';

export type MessageStatus =
  | 'streaming' // модель пишет прямо сейчас
  | 'done' // ответ дописан до конца
  | 'stopped' // пользователь нажал «Стоп» (или страницу перезагрузили посреди ответа)
  | 'error'; // генерация оборвалась с ошибкой; часть текста могла успеть прийти

export interface Message {
  id: string;
  role: ChatRole;
  content: string;
  status: MessageStatus;
  error?: ErrorPayload;
  /** Какая модель ответила (при фолбэке может отличаться от основной). */
  model?: string;
  /** Reasoning-модель прислала признаки «размышлений», а текста ещё нет. */
  thinking?: boolean;
  /** Почему модель закончила: 'stop' — сама, 'length' — упёрлась в лимит длины. */
  finishReason?: string | null;
  /** Момент (epoch ms), после которого лимит 429 должен сняться. Абсолютное время — чтобы пережить перезагрузку. */
  retryAt?: number;
}

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
}

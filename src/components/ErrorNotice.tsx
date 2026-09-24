import { useEffect, useState } from 'react';
import type { ErrorPayload } from '../../shared/protocol.ts';

const TITLES: Record<ErrorPayload['code'], string> = {
  rate_limit: 'Модель перегружена',
  timeout: 'Модель не ответила вовремя',
  network: 'Проблема со связью',
  model_unavailable: 'Модель недоступна',
  upstream: 'Ошибка модели',
  config: 'Сервер не настроен',
  bad_request: 'Запрос не принят',
};

interface Props {
  error: ErrorPayload;
  /** Если есть — показываем кнопку «Повторить» (только у последнего сообщения). */
  onRetry?: () => void;
  partial: boolean;
}

export function ErrorNotice({ error, onRetry, partial }: Props) {
  const seconds = useCountdown(error.retryAfter);

  return (
    <div className="notice notice--error">
      <p className="notice-title">{TITLES[error.code]}</p>
      <p className="notice-text">
        {error.message}
        {partial && ' Всё, что модель успела написать, сохранено выше.'}
      </p>
      {onRetry && (
        <div className="notice-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
            Повторить
          </button>
          {seconds > 0 && (
            // Не блокируем кнопку: лимит мог уже сброситься раньше, а заблокированная
            // кнопка без объяснения раздражает сильнее, чем повторный 429.
            <span className="notice-hint">лимит обычно снимается через {seconds} с</span>
          )}
        </div>
      )}
    </div>
  );
}

function useCountdown(from?: number): number {
  const [left, setLeft] = useState(from ?? 0);
  useEffect(() => {
    if (!from) return;
    const until = Date.now() + from * 1000;
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [from]);
  return left;
}

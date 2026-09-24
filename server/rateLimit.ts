/**
 * Простейший лимит «N запросов в минуту с IP» (фиксированное окно, в памяти).
 * Для одного процесса и тестового задания достаточно; в проде это был бы Redis
 * или лимит на уровне API-гейтвея.
 */
export function createRateLimiter(limitPerMinute: number, windowMs = 60_000) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);
  }, windowMs);
  sweep.unref();

  return function check(ip: string): { ok: true } | { ok: false; retryAfter: number } {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }
    if (entry.count >= limitPerMinute) {
      return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.count += 1;
    return { ok: true };
  };
}

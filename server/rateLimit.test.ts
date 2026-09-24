import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from './rateLimit.ts';

describe('createRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('пропускает N запросов, потом отказывает с временем ожидания', () => {
    const check = createRateLimiter(2, 60_000);
    expect(check('1.1.1.1').ok).toBe(true);
    expect(check('1.1.1.1').ok).toBe(true);
    const third = check('1.1.1.1');
    expect(third).toEqual({ ok: false, retryAfter: 60 });
  });

  it('считает адреса раздельно и сбрасывается после окна', () => {
    const check = createRateLimiter(1, 60_000);
    expect(check('a').ok).toBe(true);
    expect(check('b').ok).toBe(true);
    expect(check('a').ok).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(check('a').ok).toBe(true);
  });
});

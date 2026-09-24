import { describe, expect, it } from 'vitest';
import { SseParser } from './sse.ts';

describe('SseParser', () => {
  it('разбирает обычные события', () => {
    const p = new SseParser();
    expect(p.push('data: {"a":1}\n\ndata: [DONE]\n\n')).toEqual(['{"a":1}', '[DONE]']);
  });

  it('собирает событие, порезанное на произвольные куски', () => {
    const p = new SseParser();
    const raw = 'data: {"choices":[{"delta":{"content":"При"}}]}\n\ndata: [DONE]\n\n';
    const out: string[] = [];
    for (const ch of raw) out.push(...p.push(ch)); // худший случай — по символу
    expect(out).toEqual(['{"choices":[{"delta":{"content":"При"}}]}', '[DONE]']);
  });

  it('пропускает keep-alive комментарии OpenRouter', () => {
    const p = new SseParser();
    expect(p.push(': OPENROUTER PROCESSING\n\n: OPENROUTER PROCESSING\n\ndata: x\n\n')).toEqual(['x']);
  });

  it('понимает \\r\\n, в том числе разорванный между чанками', () => {
    const p = new SseParser();
    expect(p.push('data: a\r')).toEqual([]);
    expect(p.push('\n\r')).toEqual([]);
    expect(p.push('\n')).toEqual(['a']);
  });

  it('склеивает многострочный data через \\n', () => {
    const p = new SseParser();
    expect(p.push('data: one\ndata: two\n\n')).toEqual(['one\ntwo']);
  });

  it('flush отдаёт событие без завершающей пустой строки', () => {
    const p = new SseParser();
    expect(p.push('data: tail')).toEqual([]);
    expect(p.flush()).toEqual(['tail']);
  });
});

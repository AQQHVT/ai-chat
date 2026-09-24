/**
 * Минимальный инкрементальный парсер Server-Sent Events.
 *
 * Сетевые чанки режутся где угодно — посреди строки, посреди `\r\n`, посреди
 * JSON. Поэтому копим буфер и отдаём наружу только завершённые события
 * (разделитель — пустая строка). Строки-комментарии (`: OPENROUTER PROCESSING`)
 * OpenRouter шлёт как keep-alive — их пропускаем.
 */
export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];

  /** Принимает очередной кусок текста, возвращает payload'ы завершённых событий. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const events: string[] = [];

    let newline: number;
    while ((newline = this.findLineEnd()) !== -1) {
      let line = this.buffer.slice(0, newline);
      // Съедаем \n, \r или \r\n. Одинокий \r в самом конце буфера не трогаем:
      // следом может прийти \n, и тогда это один перевод строки, а не два.
      const skip = this.buffer[newline] === '\r' && this.buffer[newline + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(newline + skip);
      if (line.endsWith('\r')) line = line.slice(0, -1);

      if (line === '') {
        if (this.dataLines.length > 0) {
          events.push(this.dataLines.join('\n'));
          this.dataLines = [];
        }
        continue;
      }
      if (line.startsWith(':')) continue; // комментарий / keep-alive

      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);

      if (field === 'data') this.dataLines.push(value);
      // event/id/retry нам не нужны — OpenRouter шлёт только data.
    }

    return events;
  }

  /** Досбрасывает незавершённое событие, если поток закрылся без финальной пустой строки. */
  flush(): string[] {
    const rest = this.push('\n\n');
    this.buffer = '';
    return rest;
  }

  private findLineEnd(): number {
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch === '\n') return i;
      if (ch === '\r') {
        // \r последним символом: ждём следующий чанк, вдруг там \n.
        return i === this.buffer.length - 1 ? -1 : i;
      }
    }
    return -1;
  }
}

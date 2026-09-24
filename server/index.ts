import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, type ErrorBody, type ErrorPayload, type StreamEvent } from '../shared/protocol.ts';
import { config } from './config.ts';
import { openChatStream, statusFor } from './openrouter.ts';
import { createRateLimiter } from './rateLimit.ts';
import { parseChatRequest } from './validate.ts';

const serveStatic = process.argv.includes('--static');
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const rateLimit = createRateLimiter(config.rateLimitPerMinute);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST') return sendError(res, 405, { code: 'bad_request', message: 'Только POST.' });
      return await handleChat(req, res);
    }
    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, configured: Boolean(config.apiKey), models: config.models });
    }
    if (url.pathname.startsWith('/api/')) return sendError(res, 404, { code: 'bad_request', message: 'Нет такого метода.' });
    if (serveStatic && (req.method === 'GET' || req.method === 'HEAD')) return await handleStatic(url.pathname, res);
    res.writeHead(404).end();
  } catch (err) {
    console.error('[server] unhandled', err);
    if (!res.headersSent) sendError(res, 500, { code: 'upstream', message: 'Внутренняя ошибка сервера.' });
    else res.destroy();
  }
});

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const limited = rateLimit(clientIp(req));
  if (!limited.ok) {
    res.setHeader('Retry-After', String(limited.retryAfter));
    return sendError(res, 429, {
      code: 'rate_limit',
      message: 'Слишком много запросов подряд. Подождите немного.',
      retryAfter: limited.retryAfter,
    });
  }

  if (!config.apiKey) {
    return sendError(res, 503, {
      code: 'config',
      message: 'Сервер не настроен: задайте OPENROUTER_API_KEY в файле .env и перезапустите его.',
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBody(req, LIMITS.maxBodyBytes));
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === 'too_large';
    return sendError(res, tooLarge ? 413 : 400, {
      code: 'bad_request',
      message: tooLarge ? 'Диалог слишком длинный — начните новый.' : 'Некорректный JSON.',
    });
  }

  const parsed = parseChatRequest(body);
  if (!parsed.ok) return sendError(res, 400, { code: 'bad_request', message: parsed.message });

  // Отмена со стороны браузера. Важно слушать именно `res.on('close')`:
  // `req` в Node эмитит 'close', как только тело запроса дочитано, то есть
  // сразу — и мы бы отменяли каждый запрос в самом начале.
  const clientGone = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) clientGone.abort();
  });

  const opened = await openChatStream(parsed.messages, clientGone.signal);
  if (!opened.ok) {
    if ('aborted' in opened) return; // клиент ушёл, отвечать некому
    if (opened.error.retryAfter) res.setHeader('Retry-After', String(opened.error.retryAfter));
    return sendError(res, opened.status, opened.error);
  }

  // Ждём первое событие, прежде чем отправить 200: если модель упала или
  // протаймаутила до первого токена, браузер (и вкладка Network) увидит
  // честный 429/504/502, а не «200 OK» с ошибкой внутри.
  // meta приходит раньше текста, поэтому копим его и ждём первое «настоящее» событие.
  const head: StreamEvent[] = [];
  let first = await opened.events.next();
  while (!first.done && first.value.type === 'meta') {
    head.push(first.value);
    first = await opened.events.next();
  }
  if (first.done) return res.end();
  if (first.value.type === 'error') {
    const { type: _type, ...error } = first.value;
    return sendError(res, statusFor(error.code, 502), error);
  }
  head.push(first.value);

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    // no-transform + X-Accel-Buffering: чтобы ни прокси, ни nginx не копили ответ целиком.
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });

  const write = (event: StreamEvent) => {
    if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };

  head.forEach(write);
  for await (const event of opened.events) {
    if (clientGone.signal.aborted) break; // break вызовет finally в генераторе → отмена апстрима
    write(event);
  }
  res.end();
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too_large'));
        req.resume(); // дочитываем в никуда, чтобы корректно ответить 413
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req: IncomingMessage): string {
  // X-Forwarded-For не читаем: без доверенного прокси перед нами его подделает кто угодно.
  return req.socket.remoteAddress ?? 'unknown';
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, error: ErrorPayload) {
  sendJson(res, status, { error } satisfies ErrorBody);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

async function handleStatic(pathname: string, res: ServerResponse) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = path.join(distDir, safe);
  if (!file.startsWith(distDir)) return res.writeHead(403).end();

  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    file = path.join(distDir, 'index.html'); // SPA-фолбэк
    info = await stat(file).catch(() => null);
    if (!info) return res.writeHead(404).end('Сначала выполните npm run build');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

// Слушаем только localhost: наружу этот прокси с ключом смотреть не должен.
server.listen(config.port, '127.0.0.1', () => {
  const where = serveStatic ? `http://localhost:${config.port}` : `API на :${config.port}, UI — через Vite`;
  console.log(`[server] ${where}; модель: ${config.models.join(' → ')}`);
  if (!config.apiKey) console.warn('[server] OPENROUTER_API_KEY не задан — /api/chat будет отвечать 503');
});

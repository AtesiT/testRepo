/**
 * Мини-сервер для локальной разработки: отдаёт статику репозитория.
 * Запуск: npm start → http://localhost:5173
 *
 * Порядок разрешения порта и адреса: argv → переменные окружения → значения по умолчанию.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const portArg = process.argv.slice(2).find((arg) => /^\d+$/.test(arg));
const PORT = Number(portArg ?? process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Не даём выйти за пределы корня репозитория. */
function resolveWithinRoot(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const candidate = resolve(ROOT, `.${normalize(decoded)}`);
  return candidate === ROOT || candidate.startsWith(ROOT + sep) ? candidate : null;
}

async function statFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  let filePath = resolveWithinRoot(url.pathname);

  if (filePath) {
    let info = await statFile(filePath);
    if (!info && !extname(filePath)) {
      filePath = join(filePath, 'index.html');
      info = await statFile(filePath);
    }
    if (!info && url.pathname === '/') {
      filePath = join(ROOT, 'index.html');
      info = await statFile(filePath);
    }

    if (info) {
      response.writeHead(200, {
        'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-cache',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(filePath).pipe(response);
      return;
    }
  }

  response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!DOCTYPE html><meta charset="utf-8"><title>404</title><p>404 — файл не найден.</p>');
});

server.listen(PORT, HOST, () => {
  console.log(`Змейка: http://localhost:${PORT} (слушает ${HOST}:${PORT})`);
});

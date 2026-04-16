import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addAccountApi, getScanState, getSettings, listAccountsApi, listEventsApi,
  loginApi, logoutApi, removeAccountApi, saveApiKey, saveProvider, startScanApi,
} from './api.js';
import { SCREENSHOT_ROOT } from '../scanner/screenshot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const SCREENSHOT_DIR = resolve(SCREENSHOT_ROOT);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('invalid JSON body'); }
}

async function serveStatic(res, urlPath) {
  const clean = normalize(urlPath).replace(/^\/+/, '');
  const path = clean === '' ? 'index.html' : clean;
  const full = join(PUBLIC_DIR, path);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  try {
    const buf = await readFile(full);
    res.writeHead(200, {
      'content-type': MIME[extname(full)] || 'application/octet-stream',
      'cache-control': 'no-cache, must-revalidate',
    });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}

async function serveScreenshot(res, urlPath) {
  const rel = decodeURIComponent(urlPath.replace(/^\/screenshots\/?/, ''));
  const full = resolve(SCREENSHOT_DIR, rel);
  if (!full.startsWith(SCREENSHOT_DIR + '/') && full !== SCREENSHOT_DIR) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    const buf = await readFile(full);
    res.writeHead(200, {
      'content-type': MIME[extname(full)] || 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
    });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}

async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/settings' && method === 'GET') return json(res, 200, await getSettings());
  if (path === '/api/settings' && method === 'POST') return json(res, 200, await saveApiKey(await readJsonBody(req)));
  if (path === '/api/settings/provider' && method === 'POST') return json(res, 200, await saveProvider(await readJsonBody(req)));

  if (path === '/api/accounts' && method === 'GET') return json(res, 200, await listAccountsApi());
  if (path === '/api/accounts' && method === 'POST') return json(res, 200, await addAccountApi(await readJsonBody(req)));

  const accountMatch = path.match(/^\/api\/accounts\/([^/]+)$/);
  if (accountMatch && method === 'DELETE') {
    return json(res, 200, await removeAccountApi(decodeURIComponent(accountMatch[1])));
  }

  if (path === '/api/events' && method === 'GET') {
    const upcoming = url.searchParams.get('upcoming') !== 'false';
    const includeLow = url.searchParams.get('all') === 'true';
    return json(res, 200, await listEventsApi({ upcoming, includeLow }));
  }

  if (path === '/api/auth/login' && method === 'POST') return json(res, 200, await loginApi());
  if (path === '/api/auth/logout' && method === 'POST') return json(res, 200, await logoutApi());

  if (path === '/api/scan' && method === 'POST') return json(res, 200, await startScanApi());
  if (path === '/api/scan/status' && method === 'GET') return json(res, 200, getScanState());

  json(res, 404, { error: 'not found' });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method === 'GET' && url.pathname.startsWith('/screenshots/')) {
      return await serveScreenshot(res, url.pathname);
    }
    if (req.method === 'GET') return await serveStatic(res, url.pathname);
    json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    console.error('[ui]', e);
    json(res, 500, { error: e.message });
  }
}

export function startServer({ port = 4510 } = {}) {
  const server = http.createServer(route);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

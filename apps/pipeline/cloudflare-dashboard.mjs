import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = fileURLToPath(new URL('.', import.meta.url));
for (const path of [resolve(here, '../../.env'), resolve(here, '../../.env.development'), resolve(here, '.env'), resolve(here, '.env.development')]) {
  dotenv.config({ path, override: false, quiet: true });
}
const baseUrl = (process.env.PICTOBOOK_API_BASE_URL || process.env.PICTOBOOK_PREVIEW_URL || '').replace(/\/$/, '');
const token = process.env.PICTOBOOK_API_TOKEN || process.env.PICTOBOOK_PREVIEW_SMOKE_TOKEN || '';
const accessClientId = process.env.PICTOBOOK_API_ACCESS_CLIENT_ID;
const accessClientSecret = process.env.PICTOBOOK_API_ACCESS_CLIENT_SECRET;
const port = Number(process.env.PICTOBOOK_DASHBOARD_PORT || 4180);
const html = await readFile(resolve(here, 'cloudflare-dashboard.html'));
const fixtures = await readFile(resolve(here, 'cloudflare-dashboard-fixtures.js'));
const uploadSessions = new Map();
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
if ((!baseUrl || !token) && process.argv.includes('--require-api')) {
  throw new Error('Set PICTOBOOK_API_BASE_URL and PICTOBOOK_API_TOKEN (or PICTOBOOK_PREVIEW_URL and PICTOBOOK_PREVIEW_SMOKE_TOKEN).');
}

const server = createServer(async (req, res) => {
  const host = req.headers.host || '';
  const origin = req.headers.origin;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host) || (origin && origin !== `http://${host}`)) {
    sendJson(res, 403, { error: 'Local dashboard requests must use the loopback origin.' }); return;
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html); return;
    }
    if (url.pathname === '/cloudflare-dashboard-fixtures.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(fixtures); return;
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); res.end('Not found'); return; }
    if (!baseUrl || !token) { sendJson(res, 503, { error: 'Configure the Cloudflare API URL and token in apps/pipeline/.env.development.' }); return; }
    const uploadMatch = url.pathname.match(/^\/api\/uploads\/([A-Za-z0-9_-]{1,120})$/);
    if (req.method === 'PUT' && uploadMatch) {
      const session = uploadSessions.get(uploadMatch[1]);
      if (!session || Date.parse(session.expiresAt) <= Date.now()) {
        uploadSessions.delete(uploadMatch[1]);
        sendJson(res, 410, { error: 'Upload link expired. Start a fresh run.' }); return;
      }
      if (req.headers['content-type'] !== session.contentType) {
        sendJson(res, 415, { error: 'Photo content type does not match the upload request.' }); return;
      }
      const bytes = await readBinaryBody(req, session.byteSize);
      if (bytes.byteLength !== session.byteSize) {
        sendJson(res, 400, { error: 'Photo size does not match the upload request.' }); return;
      }
      const uploaded = await fetch(session.upload.url, {
        method: session.upload.method,
        headers: session.upload.headers,
        body: bytes,
        signal: AbortSignal.timeout(60000),
      });
      if (!uploaded.ok) {
        await uploaded.body?.cancel();
        sendJson(res, 502, { error: `R2 photo upload failed (${uploaded.status}).` }); return;
      }
      await uploaded.body?.cancel();
      sendJson(res, 200, { uploaded: true }); return;
    }
    if (url.pathname.startsWith('/api/artifacts/')) {
      const artifactId = decodeURIComponent(url.pathname.slice('/api/artifacts/'.length));
      const access = await api(`/v1/artifacts/${encodeURIComponent(artifactId)}/access`);
      const downloadUrl = access.access?.url;
      if (!downloadUrl) throw new Error('Artifact access URL missing');
      const download = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) });
      if (!download.ok || !download.body) { sendJson(res, 502, { error: 'Artifact download failed.' }); return; }
      res.writeHead(200, { 'content-type': download.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
      for await (const chunk of download.body) res.write(chunk);
      res.end(); return;
    }
    const method = req.method || 'GET';
    const body = method === 'POST' ? await readBody(req) : undefined;
    const requestKey = req.headers['idempotency-key'];
    if (method === 'POST' && (typeof requestKey !== 'string' || !/^[A-Za-z0-9._:-]{8,200}$/.test(requestKey))) {
      sendJson(res, 400, { error: 'A valid idempotency key is required.' }); return;
    }
    const upstreamPath = url.pathname.replace(/^\/api/, '/v1') + url.search;
    const result = await api(upstreamPath, { method, body, idempotencyKey: requestKey });
    if (method === 'POST' && /^\/api\/books\/[A-Za-z0-9_-]+\/runs$/.test(url.pathname)) {
      for (const item of result.uploads || []) {
        if (item.uploadIntentId && item.upload?.url && item.upload?.expiresAt) {
          uploadSessions.set(item.uploadIntentId, {
            upload: item.upload,
            contentType: item.upload.headers?.['Content-Type'],
            byteSize: Number(item.upload.headers?.['Content-Length']),
            expiresAt: item.upload.expiresAt,
          });
        }
      }
    }
    sendJson(res, 200, result);
  } catch (error) {
    const status = Number(error.status) || 502;
    sendJson(res, status, { error: error.publicMessage || 'Cloudflare API request failed.' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[cloudflare-dashboard] http://127.0.0.1:${port}`);
});

async function api(path, options = {}) {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (accessClientId && accessClientSecret) {
    headers['CF-Access-Client-Id'] = accessClientId;
    headers['CF-Access-Client-Secret'] = accessClientSecret;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] = options.idempotencyKey || crypto.randomUUID();
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30000),
  });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(result.error || `API returned ${response.status}`);
    error.status = response.status;
    error.publicMessage = result.error || `Cloudflare API returned ${response.status}.`;
    throw error;
  }
  return result;
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 65536) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolveBody(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function readBinaryBody(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      reject(Object.assign(new Error('Photo exceeds the 25 MiB upload limit.'), { status: 413, publicMessage: 'Photo exceeds the 25 MiB upload limit.' }));
      req.resume(); return;
    }
    const chunks = [];
    let length = 0;
    let overflow = false;
    req.on('data', chunk => {
      length += chunk.length;
      if (length > maxBytes || length > MAX_UPLOAD_BYTES) {
        if (!overflow) reject(Object.assign(new Error('Photo exceeds the upload size limit.'), { status: 413, publicMessage: 'Photo exceeds the 25 MiB upload limit.' }));
        overflow = true;
        return;
      }
      if (overflow) return;
      chunks.push(chunk);
    });
    req.on('end', () => { if (!overflow) resolveBody(Buffer.concat(chunks, length)); });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

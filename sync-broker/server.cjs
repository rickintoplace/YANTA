'use strict';

// ============================================================
// YANTA Sync Broker — Local Disk Backend
//
// This is the first real HTTP RemoteObjectStore endpoint.
//
// It deliberately does NOT implement Google/Dropbox/OneDrive yet.
// It only exposes a provider-neutral object API:
//
//   GET    /api/storage/list?prefix=...
//   GET    /api/storage/object?path=...
//   PUT    /api/storage/object?path=...
//   DELETE /api/storage/object?path=...
//   GET    /api/storage/stat?path=...
//
// The broker only stores encrypted blobs. It should never receive note
// titles, plaintext markdown, folder names, drawings, or image contents.
//
// For development:
//   PORT=8787 DATA_DIR=.data BROKER_TOKEN=dev npm start
//
// Frontend:
//   new BrokerObjectStore({ baseUrl:'http://localhost:8787', token:'dev' })
// ============================================================

const http = require('http');
const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '.data'));
const BROKER_TOKEN = process.env.BROKER_TOKEN || '';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 250 * 1024 * 1024);

const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(obj, null, 2));

  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    ...extraHeaders,
  });

  res.end(body);
}

function sendText(res, status, text, extraHeaders = {}) {
  const body = Buffer.from(String(text));

  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
    ...extraHeaders,
  });

  res.end(body);
}

function corsHeaders(req) {
  const origin = req.headers.origin || '';

  if (!origin) return {};

  if (ALLOWED_ORIGINS.size && !ALLOWED_ORIGINS.has(origin)) {
    return {};
  }

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function isOriginAllowed(req) {
  const origin = req.headers.origin || '';

  if (!origin) return true;
  if (!ALLOWED_ORIGINS.size) return true;

  return ALLOWED_ORIGINS.has(origin);
}

function isAuthorized(req) {
  if (!BROKER_TOKEN) return true;

  const auth = req.headers.authorization || '';
  return auth === `Bearer ${BROKER_TOKEN}`;
}

function normalizeRemotePath(raw) {
  let p = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();

  const parts = [];

  for (const part of p.split('/')) {
    if (!part || part === '.') continue;

    if (part === '..') {
      throw new Error('Path must not contain ..');
    }

    if (part.includes('\0')) {
      throw new Error('Path contains NUL');
    }

    parts.push(part);
  }

  p = parts.join('/');

  if (!p) {
    throw new Error('Path must not be empty');
  }

  return p;
}

function localPathForRemote(remotePath) {
  const safe = normalizeRemotePath(remotePath);
  const full = path.resolve(DATA_DIR, ...safe.split('/'));

  if (full !== DATA_DIR && !full.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Path escapes data dir');
  }

  return {
    remotePath: safe,
    localPath: full,
  };
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function fileEtag(localPath, stat = null) {
  const s = stat || await fs.stat(localPath);

  // Debug/dev-friendly etag. Avoid hashing large objects on every stat.
  return `"${s.size}-${Math.floor(s.mtimeMs)}"`;
}

async function remoteEntryFor(localPath, remotePath) {
  const st = await fs.stat(localPath);

  return {
    path: remotePath,
    size: st.size,
    updated: Math.floor(st.mtimeMs),
    etag: await fileEtag(localPath, st),
  };
}

async function walkFiles(root, prefixRemote = '') {
  const out = [];

  async function walk(dir, relParts) {
    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    for (const ent of entries) {
      const rel = [...relParts, ent.name];
      const lp = path.join(dir, ent.name);
      const rp = rel.join('/');

      if (ent.isDirectory()) {
        await walk(lp, rel);
      } else if (ent.isFile()) {
        if (!prefixRemote || rp.startsWith(prefixRemote)) {
          out.push(await remoteEntryFor(lp, rp));
        }
      }
    }
  }

  await walk(root, []);

  out.sort((a, b) => a.path.localeCompare(b.path));

  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;

      if (total > MAX_UPLOAD_BYTES) {
        reject(new Error(`Upload too large. Limit is ${MAX_UPLOAD_BYTES} bytes.`));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleStorageList(req, res, url, headers) {
  const rawPrefix = url.searchParams.get('prefix') || '';
  const prefix = rawPrefix
    ? normalizeRemotePath(rawPrefix)
    : '';

  const entries = await walkFiles(DATA_DIR, prefix);

  sendJson(res, 200, { entries }, headers);
}

async function handleStorageGetObject(req, res, url, headers) {
  const raw = url.searchParams.get('path') || '';
  const { remotePath, localPath } = localPathForRemote(raw);

  let st;

  try {
    st = await fs.stat(localPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      sendJson(res, 404, { error: 'not_found', path: remotePath }, headers);
      return;
    }

    throw err;
  }

  if (!st.isFile()) {
    sendJson(res, 404, { error: 'not_found', path: remotePath }, headers);
    return;
  }

  const data = await fs.readFile(localPath);

  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': data.length,
    'etag': await fileEtag(localPath, st),
    ...headers,
  });

  res.end(data);
}

async function handleStoragePutObject(req, res, url, headers) {
  const raw = url.searchParams.get('path') || '';
  const { remotePath, localPath } = localPathForRemote(raw);

  const ifAbsent = url.searchParams.get('ifAbsent') === '1';

  if (ifAbsent && fssync.existsSync(localPath)) {
    sendJson(res, 409, { error: 'already_exists', path: remotePath }, headers);
    return;
  }

  const body = await readBody(req);

  await fs.mkdir(path.dirname(localPath), { recursive: true });

  const tmp = localPath + `.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  await fs.writeFile(tmp, body);
  await fs.rename(tmp, localPath);

  const entry = await remoteEntryFor(localPath, remotePath);

  sendJson(res, 200, { ok: true, entry }, headers);
}

async function handleStorageDeleteObject(req, res, url, headers) {
  const raw = url.searchParams.get('path') || '';
  const { remotePath, localPath } = localPathForRemote(raw);

  try {
    await fs.unlink(localPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  sendJson(res, 200, { ok: true, path: remotePath }, headers);
}

async function handleStorageStat(req, res, url, headers) {
  const raw = url.searchParams.get('path') || '';
  const { remotePath, localPath } = localPathForRemote(raw);

  try {
    const st = await fs.stat(localPath);

    if (!st.isFile()) {
      sendJson(res, 200, { entry: null }, headers);
      return;
    }

    sendJson(res, 200, {
      entry: await remoteEntryFor(localPath, remotePath),
    }, headers);
  } catch (err) {
    if (err.code === 'ENOENT') {
      sendJson(res, 200, { entry: null }, headers);
      return;
    }

    throw err;
  }
}

async function route(req, res) {
  const headers = corsHeaders(req);

  if (!isOriginAllowed(req)) {
    sendJson(res, 403, { error: 'origin_not_allowed' }, headers);
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' }, {
      ...headers,
      'www-authenticate': 'Bearer',
    });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/' || url.pathname === '/healthz') {
    sendText(res, 200, 'ok\n', headers);
    return;
  }

  if (url.pathname === '/api/storage/list' && req.method === 'GET') {
    await handleStorageList(req, res, url, headers);
    return;
  }

  if (url.pathname === '/api/storage/object' && req.method === 'GET') {
    await handleStorageGetObject(req, res, url, headers);
    return;
  }

  if (url.pathname === '/api/storage/object' && req.method === 'PUT') {
    await handleStoragePutObject(req, res, url, headers);
    return;
  }

  if (url.pathname === '/api/storage/object' && req.method === 'DELETE') {
    await handleStorageDeleteObject(req, res, url, headers);
    return;
  }

  if (url.pathname === '/api/storage/stat' && req.method === 'GET') {
    await handleStorageStat(req, res, url, headers);
    return;
  }

  sendJson(res, 404, { error: 'not_found' }, headers);
}

async function main() {
  await ensureDataDir();

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(err);

      const headers = corsHeaders(req);

      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || String(err),
      }, headers);
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`YANTA Sync Broker listening on http://0.0.0.0:${PORT}`);
    console.log(`DATA_DIR=${DATA_DIR}`);
    console.log(`BROKER_TOKEN=${BROKER_TOKEN ? '(set)' : '(not set)'}`);
    console.log(`ALLOWED_ORIGINS=${ALLOWED_ORIGINS.size ? [...ALLOWED_ORIGINS].join(',') : '(all)'}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
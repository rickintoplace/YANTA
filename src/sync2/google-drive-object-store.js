// ============================================================
// YANTA Sync2 — GoogleDriveObjectStore
//
// Direct browser Google Drive backend using appDataFolder.
// Google only sees encrypted object blobs.
//
// Scope:
//   https://www.googleapis.com/auth/drive.appdata
// ============================================================

import {
  RemoteObjectStore,
  assertSafeRemotePath,
  normalizeRemotePath,
  bytesFromData,
  remoteEntrySort,
} from './object-store.js';

import {
  base64UrlEncode,
  base64UrlDecode,
  utf8Encode,
  utf8Decode,
} from './crypto.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const FILE_PREFIX = 'yantaobj_';
const TOKEN_CACHE_KEY = 'yanta.googleDrive.accessToken.v1';
const TOKEN_EXPIRY_SKEW_MS = 60_000;

let gisLoadPromise = null;

function readTokenCache(clientId) {
  try {
    const raw = localStorage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return null;

    const rec = JSON.parse(raw);

    if (rec.clientId !== clientId) return null;
    if (!rec.accessToken) return null;
    if (!rec.expiresAt) return null;

    if (Date.now() + TOKEN_EXPIRY_SKEW_MS >= Number(rec.expiresAt)) {
      return null;
    }

    return rec.accessToken;
  } catch {
    return null;
  }
}

function writeTokenCache(clientId, accessToken, expiresInSeconds = 3600) {
  try {
    const ttl = Math.max(60, Number(expiresInSeconds || 3600) - 60);

    localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({
      clientId,
      accessToken,
      expiresAt: Date.now() + ttl * 1000,
      storedAt: Date.now(),
    }));
  } catch {}
}

function clearTokenCache() {
  try {
    localStorage.removeItem(TOKEN_CACHE_KEY);
  } catch {}
}

function loadScript(src) {
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) {
      resolve();
      return;
    }

    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load script: ${src}`));
    document.head.append(s);
  });

  return gisLoadPromise;
}

function driveFileNameForPath(path) {
  return FILE_PREFIX + base64UrlEncode(utf8Encode(path));
}

function pathFromDriveFileName(name) {
  if (!String(name || '').startsWith(FILE_PREFIX)) return null;

  try {
    return utf8Decode(base64UrlDecode(String(name).slice(FILE_PREFIX.length)));
  } catch {
    return null;
  }
}

function escapeDriveQueryString(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function makeEtag(file) {
  return file.md5Checksum || `${file.size || 0}-${file.modifiedTime || ''}`;
}

async function responseError(res, fallback) {
  let msg = fallback;

  try {
    const json = await res.json();
    msg = json?.error?.message || json?.message || msg;
  } catch {
    try {
      msg = await res.text();
    } catch {}
  }

  const err = new Error(`${fallback}: ${res.status} ${msg}`);
  err.status = res.status;

  return err;
}

function timeout(ms, message) {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function retryAfterMs(res) {
  const raw = res.headers?.get?.('retry-after');
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }

  return 0;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class GoogleDriveObjectStore extends RemoteObjectStore {
  constructor({
    clientId,
    initialPrompt = '',
    tokenClient = null,
  } = {}) {
    super();

    if (!clientId) {
      throw new Error('Google clientId required');
    }

    this.clientId = clientId;
    this.initialPrompt = initialPrompt;
    this.tokenClient = tokenClient;
    this.accessToken = '';
    this.ready = false;
  }

  async init() {
    if (this.ready) return;

    await loadScript(GIS_SRC);

    if (!globalThis.google?.accounts?.oauth2) {
      throw new Error('Google Identity Services not available');
    }

    if (!this.tokenClient) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: () => {},
      });
    }

    await this.ensureToken({
      prompt: this.initialPrompt,
    });

    this.ready = true;
  }

  async connectInteractive() {
    this.accessToken = '';
    clearTokenCache();

    await this.ensureToken({
      prompt: 'consent',
    });

    this.ready = true;
  }

  async ensureToken({ prompt = '' } = {}) {
    if (this.accessToken) return this.accessToken;

    const cached = readTokenCache(this.clientId);

    if (cached) {
      this.accessToken = cached;
      return cached;
    }

    await loadScript(GIS_SRC);

    if (!globalThis.google?.accounts?.oauth2) {
      throw new Error('Google Identity Services not available');
    }

    if (!this.tokenClient) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: () => {},
      });
    }

    const tokenPromise = new Promise((resolve, reject) => {
      this.tokenClient.callback = (res) => {
        if (res?.error) {
          reject(new Error(res.error_description || res.error));
          return;
        }

        if (!res?.access_token) {
          reject(new Error('Google access token missing'));
          return;
        }

        this.accessToken = res.access_token;

        writeTokenCache(
          this.clientId,
          res.access_token,
          res.expires_in || 3600
        );

        resolve(this.accessToken);
      };

      this.tokenClient.requestAccessToken({
        prompt,
      });
    });

    return Promise.race([
      tokenPromise,
      timeout(45_000, 'Google login timed out or was blocked by the browser.'),
    ]);
  }

  async api(url, options = {}, retryAuth = true) {
    await this.ensureToken();

    let lastError = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      let res;

      try {
        res = await fetchWithTimeout(url, {
          ...options,
          headers: {
            ...(options.headers || {}),
            authorization: `Bearer ${this.accessToken}`,
          },
        }, 30_000);
      } catch (err) {
        lastError = err;

        const backoff = 500 * Math.pow(2, attempt) + Math.random() * 300;
        await sleep(backoff);
        continue;
      }

      if (res.status === 401 && retryAuth) {
        this.accessToken = '';
        clearTokenCache();

        await this.ensureToken({ prompt: '' });
        return this.api(url, options, false);
      }

      if (isRetryableStatus(res.status) && attempt < 3) {
        lastError = await responseError(res, 'Google Drive transient error');

        const fromHeader = retryAfterMs(res);
        const backoff =
          fromHeader ||
          (700 * Math.pow(2, attempt) + Math.random() * 500);

        await sleep(Math.min(backoff, 12_000));
        continue;
      }

      return res;
    }

    throw lastError || new Error('Google Drive request failed');
  }

  clearCachedToken() {
    this.accessToken = '';
    clearTokenCache();
  }

  fileQueryForPath(path) {
    const p = assertSafeRemotePath(path);
    const name = driveFileNameForPath(p);

    return [
      `name = '${escapeDriveQueryString(name)}'`,
      `trashed = false`,
      `appProperties has { key='yantaSync' and value='1' }`,
    ].join(' and ');
  }

  async findFilesByPath(path) {
    const q = this.fileQueryForPath(path);

    const url = new URL(DRIVE_API + '/files');
    url.searchParams.set('spaces', 'appDataFolder');
    url.searchParams.set('q', q);
    url.searchParams.set('fields', 'files(id,name,size,modifiedTime,md5Checksum)');
    url.searchParams.set('pageSize', '10');

    const res = await this.api(url.href);

    if (!res.ok) {
      throw await responseError(res, 'Google Drive query failed');
    }

    const json = await res.json();

    return json.files || [];
  }

  async findFile(path) {
    const files = await this.findFilesByPath(path);

    if (!files.length) return null;

    files.sort((a, b) =>
      String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || ''))
    );

    return files[0];
  }

  async list(prefix = '') {
    await this.init();

    const cleanPrefix = normalizeRemotePath(prefix);

    const out = [];
    let pageToken = '';

    do {
      const url = new URL(DRIVE_API + '/files');

      url.searchParams.set('spaces', 'appDataFolder');
      url.searchParams.set(
        'q',
        `trashed = false and appProperties has { key='yantaSync' and value='1' }`
      );
      url.searchParams.set(
        'fields',
        'nextPageToken,files(id,name,size,modifiedTime,md5Checksum)'
      );
      url.searchParams.set('pageSize', '1000');

      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const res = await this.api(url.href);

      if (!res.ok) {
        throw await responseError(res, 'Google Drive list failed');
      }

      const json = await res.json();

      for (const f of json.files || []) {
        const path = pathFromDriveFileName(f.name);

        if (!path) continue;
        if (cleanPrefix && !path.startsWith(cleanPrefix)) continue;

        out.push({
          path,
          size: Number(f.size || 0),
          updated: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
          etag: makeEtag(f),
        });
      }

      pageToken = json.nextPageToken || '';
    } while (pageToken);

    return out.sort(remoteEntrySort);
  }

  async listAllYantaFiles() {
    await this.init();

    const out = [];
    let pageToken = '';

    do {
      const url = new URL(DRIVE_API + '/files');

      url.searchParams.set('spaces', 'appDataFolder');
      url.searchParams.set(
        'q',
        `trashed = false and appProperties has { key='yantaSync' and value='1' }`
      );
      url.searchParams.set(
        'fields',
        'nextPageToken,files(id,name,size,modifiedTime,md5Checksum,appProperties)'
      );
      url.searchParams.set('pageSize', '1000');

      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const res = await this.api(url.href);

      if (!res.ok) {
        throw await responseError(res, 'Google Drive list-all failed');
      }

      const json = await res.json();

      for (const f of json.files || []) {
        out.push({
          id: f.id,
          name: f.name,
          path: pathFromDriveFileName(f.name),
          size: Number(f.size || 0),
          updated: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
          etag: makeEtag(f),
          appProperties: f.appProperties || {},
        });
      }

      pageToken = json.nextPageToken || '';
    } while (pageToken);

    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    return out;
  }

  async deleteFileId(fileId) {
    await this.init();

    if (!fileId) return;

    const res = await this.api(
      DRIVE_API + `/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
      }
    );

    if (!res.ok && res.status !== 404) {
      throw await responseError(res, 'Google Drive delete-by-id failed');
    }
  }

  async deleteAllYantaFiles({ onProgress = null } = {}) {
    const files = await this.listAllYantaFiles();

    let deleted = 0;

    for (const file of files) {
      await this.deleteFileId(file.id);
      deleted++;

      onProgress?.({
        deleted,
        total: files.length,
        file,
      });
    }

    return {
      total: files.length,
      deleted,
      files,
    };
  }

  async get(path) {
    await this.init();

    const p = assertSafeRemotePath(path);
    const file = await this.findFile(p);

    if (!file) {
      const err = new Error(`Remote object not found: ${p}`);
      err.code = 'ENOENT';
      throw err;
    }

    const res = await this.api(
      DRIVE_API + `/files/${encodeURIComponent(file.id)}?alt=media`
    );

    if (!res.ok) {
      throw await responseError(res, 'Google Drive get failed');
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  async put(path, data, options = {}) {
    await this.init();

    const p = assertSafeRemotePath(path);
    const bytes = await bytesFromData(data);

    const existing = await this.findFile(p);

    if (options.ifAbsent && existing) {
      const err = new Error(`Remote object already exists: ${p}`);
      err.code = 'EEXIST';
      throw err;
    }

    if (existing && !options.ifAbsent) {
      const res = await this.api(
        DRIVE_UPLOAD + `/files/${encodeURIComponent(existing.id)}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/octet-stream',
          },
          body: bytes,
        }
      );

      if (!res.ok) {
        throw await responseError(res, 'Google Drive update failed');
      }

      return;
    }

    const metadata = {
      name: driveFileNameForPath(p),
      parents: ['appDataFolder'],
      appProperties: {
        yantaSync: '1',
        yantaSyncVersion: '1',
      },
    };

    const boundary = 'yanta_' + crypto.randomUUID().replace(/-/g, '');

    const body = new Blob([
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\n`,
      'Content-Type: application/octet-stream\r\n\r\n',
      bytes,
      `\r\n--${boundary}--`,
    ]);

    const res = await this.api(
      DRIVE_UPLOAD + '/files?uploadType=multipart&fields=id,name,size,modifiedTime,md5Checksum',
      {
        method: 'POST',
        headers: {
          'content-type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!res.ok) {
      throw await responseError(res, 'Google Drive create failed');
    }
  }

  async delete(path) {
    await this.init();

    const p = assertSafeRemotePath(path);
    const files = await this.findFilesByPath(p);

    for (const file of files) {
      await this.deleteFileId(file.id);
    }
  }

  async stat(path) {
    await this.init();

    const p = assertSafeRemotePath(path);
    const file = await this.findFile(p);

    if (!file) return null;

    return {
      path: p,
      size: Number(file.size || 0),
      updated: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
      etag: makeEtag(file),
    };
  }
}
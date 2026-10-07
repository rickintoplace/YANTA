// ============================================================
// YANTA Sync2 — GoogleDriveObjectStore
//
// Direct browser Google Drive backend using appDataFolder.
// Google only sees encrypted object blobs.
//
// Scope:
//   https://www.googleapis.com/auth/drive.appdata
//
// Important UX rule:
// - Google OAuth popup/token prompt is ONLY allowed from explicit user actions.
// - App startup / focus / interval sync must never open accounts.google.com.
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

export class GoogleAuthRequiredError extends Error {
  constructor(message = 'Google sign-in required') {
    super(message);
    this.name = 'GoogleAuthRequiredError';
    this.code = 'EAUTH_REQUIRED';
  }
}

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
    const existing = [...document.scripts].find((s) => s.src === src);

    if (existing) {
      if (globalThis.google?.accounts?.oauth2) {
        resolve();
        return;
      }

      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load script: ${src}`)), { once: true });
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

async function driveErrorReason(res) {
  try {
    const json = await res.clone().json();
    return String(json?.error?.errors?.[0]?.reason || json?.error?.status || '');
  } catch {
    return '';
  }
}

/*
  Drive answers both rate limiting and a full Drive with 403; only the
  error reason tells them apart (and both apart from a real 403).
*/
const DRIVE_RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const DRIVE_QUOTA_REASONS = new Set(['storageQuotaExceeded', 'quotaExceeded']);

async function responseError(res, fallback) {
  const reason = await driveErrorReason(res);
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
  err.reason = reason;

  if (DRIVE_QUOTA_REASONS.has(reason)) {
    err.code = 'EQUOTA';
  } else if (res.status === 429 || DRIVE_RATE_LIMIT_REASONS.has(reason)) {
    err.code = 'ERATE_LIMIT';
  }

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

/*
  A fixed 30 s killed large asset uploads on slow links: allow ~50 KB/s on
  top of the base, capped at ten minutes.
*/
function timeoutForBody(body) {
  const bytes = Number(body?.size ?? body?.byteLength ?? 0) || 0;
  return Math.min(10 * 60_000, 30_000 + Math.ceil(bytes / 50_000) * 1000);
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
    this.prepared = false;
  }

  /**
   * Prepare Google Identity Services.
   *
   * Important:
   * - init() normally does NOT open a popup.
   * - It only opens OAuth when initialPrompt is explicitly set, e.g. "consent".
   *   That path is meant for explicit user-triggered setup buttons.
   */
  async init() {
    if (this.ready) return;

    await this.prepareAuthClient();

    if (this.initialPrompt) {
      await this.ensureToken({
        interactive: true,
        prompt: this.initialPrompt,
      });
    }

    this.ready = true;
  }

  async prepareAuthClient() {
    if (this.prepared && this.tokenClient) return;

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

    this.prepared = true;
  }

  /**
   * Explicit user-triggered login.
   *
   * Only call this from a click/tap handler such as:
   * - Connect Google Drive
   * - Reconnect Google Drive
   * - Connect & Pull
   */
  async connectInteractive() {
    this.accessToken = '';
    clearTokenCache();

    await this.prepareAuthClient();

    const token = await this.requestTokenInteractive({
      prompt: 'consent',
    });

    this.ready = true;

    return token;
  }

  /**
   * Token getter.
   *
   * Default mode is silent/cache-only.
   * If no cached token exists, it throws EAUTH_REQUIRED instead of opening
   * accounts.google.com automatically.
   */
  async ensureToken({
    interactive = false,
    prompt = '',
  } = {}) {
    if (this.accessToken) return this.accessToken;

    const cached = readTokenCache(this.clientId);

    if (cached) {
      this.accessToken = cached;
      return cached;
    }

    await this.prepareAuthClient();

    if (!interactive) {
      throw new GoogleAuthRequiredError(
        'Google sign-in required. Please reconnect Google Drive Sync.'
      );
    }

    return this.requestTokenInteractive({
      prompt: prompt || 'consent',
    });
  }

  requestTokenInteractive({
    prompt = 'consent',
  } = {}) {
    return Promise.race([
      new Promise((resolve, reject) => {
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
      }),

      timeout(45_000, 'Google login timed out or was blocked by the browser.'),
    ]);
  }

  async api(url, options = {}, retryAuth = true) {
    await this.init();

    await this.ensureToken({
      interactive: false,
    });

    let lastError = null;

    /*
      A create (POST) that timed out may still have been executed: retrying
      it blindly left two files with the same name. Only retry a POST when
      Drive said it did not process it (rate limiting); otherwise surface
      the error and let the next sync find whatever landed.
    */
    const isCreate = String(options.method || 'GET').toUpperCase() === 'POST';

    for (let attempt = 0; attempt < 4; attempt++) {
      let res;

      try {
        res = await fetchWithTimeout(url, {
          ...options,
          headers: {
            ...(options.headers || {}),
            authorization: `Bearer ${this.accessToken}`,
          },
        }, options.body ? timeoutForBody(options.body) : 30_000);
      } catch (err) {
        lastError = err;

        if (isCreate) throw err;

        const backoff = 500 * Math.pow(2, attempt) + Math.random() * 300;
        await sleep(backoff);
        continue;
      }

      /**
       * Important:
       * Do NOT silently call requestAccessToken() here.
       *
       * A 401 can happen after token expiry/revocation. Background sync must
       * fail with EAUTH_REQUIRED and let the UI show "Reconnect Google Drive".
       */
      if (res.status === 401 && retryAuth) {
        this.accessToken = '';
        clearTokenCache();

        throw new GoogleAuthRequiredError(
          'Google session expired. Please reconnect Google Drive Sync.'
        );
      }

      const reason = res.status === 403 ? await driveErrorReason(res) : '';
      const rateLimited = res.status === 429 || DRIVE_RATE_LIMIT_REASONS.has(reason);

      const retryable = isCreate
        ? rateLimited
        : (rateLimited || isRetryableStatus(res.status));

      if (retryable && attempt < 3) {
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

    /*
      Drive allows several files with one name (left behind by retried
      creates). Report one entry per path — the newest, which is also what
      get() reads — or callers see the path flip between two etags.
    */
    const byPath = new Map();

    for (const entry of out) {
      const prev = byPath.get(entry.path);
      if (!prev || entry.updated > prev.updated) byPath.set(entry.path, entry);
    }

    return [...byPath.values()].sort(remoteEntrySort);
  }

  /*
    The whole listing in one go. Without it the engine listed per prefix,
    and every per-note listing paged through all files again.
  */
  async index() {
    return this.list('');
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

    const matches = await this.findFilesByPath(p);

    matches.sort((a, b) =>
      String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || ''))
    );

    const existing = matches[0] || null;

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

      // Drop duplicates of this path; the newest now holds the data.
      for (const dup of matches.slice(1)) {
        await this.deleteFileId(dup.id).catch(() => {});
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
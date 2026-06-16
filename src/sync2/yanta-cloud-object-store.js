// ============================================================
// YANTA Sync2 — YantaCloudObjectStore
//
// Frontend RemoteObjectStore implementation for managed YANTA Cloud.
//
// Best-practice performance path:
// - index(): one metadata request for all encrypted objects in the vault
// - Sync2AppEngine filters this index locally instead of doing hundreds of
//   per-note list(prefix) calls.
//
// Recommended production setup without moving DNS to Cloudflare:
//   VITE_YANTA_CLOUD_API_BASE_URL=/cloud-api
//
// Then Vercel rewrites:
//   https://yanta.page/cloud-api/*
// to:
//   https://yanta-cloud.rickintoplace.workers.dev/*
//
// This keeps auth cookies same-origin on yanta.page.
// The server stores only encrypted Sync2 blobs.
// ============================================================

import {
  RemoteObjectStore,
  assertSafeRemotePath,
  normalizeRemotePath,
  bytesFromData,
  remoteEntrySort,
} from './object-store.js';

import {
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function retryableStatus(status) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

export class YantaCloudObjectStore extends RemoteObjectStore {
  constructor({
    baseUrl = YANTA_CLOUD_BASE_URL,
    vaultId = '',
    deviceId = '',
    fetchImpl = null,
  } = {}) {
    super();

    this.baseUrl = String(baseUrl || YANTA_CLOUD_BASE_URL || '/cloud-api')
      .replace(/\/+$/, '');

    this.vaultId = String(vaultId || '');
    this.deviceId = String(deviceId || '');

    this.fetchImpl = fetchImpl || fetch.bind(globalThis);
  }

  async init() {
    if (!this.vaultId) {
      throw new Error('YANTA Cloud vaultId missing');
    }

    if (!this.deviceId) {
      throw new Error('YANTA Cloud deviceId missing');
    }

    const res = await this.fetchWithRetry(
      this.url('/api/me'),
      {
        method: 'GET',
        credentials: 'include',
      },
      {
        label: 'YANTA Cloud login check',
      }
    );

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'YANTA Cloud login required');
    }

    let json = null;

    try {
      json = await res.json();
    } catch {}

    if (json && json.authenticated === false) {
      throw new Error('YANTA Cloud login required');
    }
  }

  headers(extra = {}) {
    return {
      ...extra,
      'x-yanta-vault-id': this.vaultId,
      'x-yanta-device-id': this.deviceId,
    };
  }

  url(pathname, params = {}) {
    const base = String(this.baseUrl || '').replace(/\/+$/, '');
    const path = String(pathname || '').replace(/^\/+/, '');

    const url = new URL(`${base}/${path}`, location.origin);

    for (const [key, value] of Object.entries(params || {})) {
      if (value == null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    return url.href;
  }

  async fetchWithRetry(url, options = {}, {
    attempts = 4,
    label = 'YANTA Cloud request',
  } = {}) {
    let lastRes = null;
    let lastErr = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, options);

        if (!retryableStatus(res.status) || attempt === attempts - 1) {
          return res;
        }

        lastRes = res;

        const fromHeader = retryAfterMs(res);
        const backoff =
          fromHeader ||
          (500 * Math.pow(2, attempt) + Math.random() * 350);

        await sleep(Math.min(backoff, 8000));
      } catch (err) {
        lastErr = err;

        if (attempt === attempts - 1) {
          throw err;
        }

        const backoff = 500 * Math.pow(2, attempt) + Math.random() * 350;
        await sleep(Math.min(backoff, 8000));
      }
    }

    if (lastRes) return lastRes;
    throw lastErr || new Error(label);
  }

  /**
   * Full remote metadata index for the current vault.
   *
   * This is the fast path used by Sync2AppEngine.
   */
  async index() {
    const res = await this.fetchWithRetry(
      this.url('/api/storage/index'),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
      },
      {
        label: 'YANTA Cloud index',
      }
    );

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'YANTA Cloud index failed');
    }

    const json = await res.json();

    return (json.entries || []).sort(remoteEntrySort);
  }

  async list(prefix = '') {
    const cleanPrefix = normalizeRemotePath(prefix);

    const res = await this.fetchWithRetry(
      this.url('/api/storage/list', {
        prefix: cleanPrefix,
      }),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
      },
      {
        label: 'YANTA Cloud list',
      }
    );

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'YANTA Cloud list failed');
    }

    const json = await res.json();

    return (json.entries || []).sort(remoteEntrySort);
  }

  async get(path) {
    const p = assertSafeRemotePath(path);

    const res = await this.fetchWithRetry(
      this.url('/api/storage/object', {
        path: p,
      }),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
      },
      {
        label: 'YANTA Cloud get',
      }
    );

    if (res.status === 404) {
      const err = new Error(`Remote object not found: ${p}`);
      err.code = 'ENOENT';
      throw err;
    }

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'YANTA Cloud get failed');
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  async put(path, data, options = {}) {
    const p = assertSafeRemotePath(path);
    const bytes = await bytesFromData(data);

    const res = await this.fetchWithRetry(
      this.url('/api/storage/object', {
        path: p,
        ifAbsent: options.ifAbsent ? '1' : '',
      }),
      {
        method: 'PUT',
        credentials: 'include',
        headers: this.headers({
          'content-type': 'application/octet-stream',
        }),
        body: bytes,
      },
      {
        label: 'YANTA Cloud put',
      }
    );

    if (res.status === 409) {
      const err = new Error(`Remote object already exists: ${p}`);
      err.code = 'EEXIST';
      throw err;
    }

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'YANTA Cloud put failed');
    }
  }

  async delete(path) {
    const p = assertSafeRemotePath(path);

    const res = await this.fetchWithRetry(
      this.url('/api/storage/object', {
        path: p,
      }),
      {
        method: 'DELETE',
        credentials: 'include',
        headers: this.headers(),
      },
      {
        label: 'YANTA Cloud delete',
      }
    );

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'YANTA Cloud delete failed');
    }
  }

  async stat(path) {
    const p = assertSafeRemotePath(path);

    const res = await this.fetchWithRetry(
      this.url('/api/storage/stat', {
        path: p,
      }),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
      },
      {
        label: 'YANTA Cloud stat',
      }
    );

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'YANTA Cloud stat failed');
    }

    const json = await res.json();

    return json.entry || null;
  }

  async errorFromResponse(res, fallback) {
    let message = fallback;
    let parsed = null;

    try {
      parsed = await res.json();
      message =
        parsed?.message ||
        parsed?.error?.message ||
        parsed?.error ||
        message;
    } catch {
      try {
        message = await res.text();
      } catch {}
    }

    const err = new Error(`${fallback}: ${res.status} ${message}`);

    err.status = res.status;
    err.response = parsed;

    const errorCode =
      typeof parsed?.error === 'string'
        ? parsed.error
        : parsed?.error?.code ||
          parsed?.code ||
          '';

    if (errorCode) {
      err.serverCode = errorCode;
    }

    if (res.status === 429) {
      err.code = 'ERATE_LIMIT';

      const retryAfter = Number(res.headers.get('retry-after') || 0);

      err.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 5 * 60 * 1000;
    }

    if (
      res.status === 403 &&
      [
        'storage_quota_exceeded',
        'object_quota_exceeded',
        'upload_day_quota_exceeded',
        'writes_day_quota_exceeded',
        'download_quota_exceeded',
      ].includes(errorCode)
    ) {
      err.code = 'EQUOTA';
      err.retryAfterMs = 60 * 60 * 1000;
    }

    return err;
  }
}
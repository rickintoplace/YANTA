// ============================================================
// YANTA Sync2 — BrokerObjectStore
//
// Frontend RemoteObjectStore implementation for the YANTA Sync Broker.
//
// The broker provides a provider-independent object API:
//
//   GET    /api/storage/list?prefix=...
//   GET    /api/storage/object?path=...
//   PUT    /api/storage/object?path=...
//   DELETE /api/storage/object?path=...
//   GET    /api/storage/stat?path=...
//
// The broker only sees encrypted blobs.
// ============================================================

import {
  RemoteObjectStore,
  assertSafeRemotePath,
  normalizeRemotePath,
  bytesFromData,
  remoteEntrySort,
} from './object-store.js';

export class BrokerObjectStore extends RemoteObjectStore {
  constructor({
    baseUrl = 'http://localhost:8787',
    token = '',
    fetchImpl = null,
  } = {}) {
    super();

    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.token = token || '';
    this.fetchImpl = fetchImpl || fetch.bind(globalThis);
  }

  async init() {
    const res = await this.fetchImpl(this.baseUrl + '/healthz', {
      method: 'GET',
      headers: this.headers(),
    });

    if (!res.ok) {
      throw new Error(`Broker health check failed: ${res.status}`);
    }
  }

  headers(extra = {}) {
    const h = {
      ...extra,
    };

    if (this.token) {
      h.authorization = `Bearer ${this.token}`;
    }

    return h;
  }

  url(pathname, params = {}) {
    const url = new URL(this.baseUrl + pathname);

    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      url.searchParams.set(k, String(v));
    }

    return url.href;
  }

  async list(prefix = '') {
    const cleanPrefix = normalizeRemotePath(prefix);

    const res = await this.fetchImpl(
      this.url('/api/storage/list', { prefix: cleanPrefix }),
      {
        method: 'GET',
        headers: this.headers(),
      }
    );

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'Broker list failed');
    }

    const json = await res.json();

    return (json.entries || []).sort(remoteEntrySort);
  }

  async get(path) {
    const p = assertSafeRemotePath(path);

    const res = await this.fetchImpl(
      this.url('/api/storage/object', { path: p }),
      {
        method: 'GET',
        headers: this.headers(),
      }
    );

    if (res.status === 404) {
      const err = new Error(`Remote object not found: ${p}`);
      err.code = 'ENOENT';
      throw err;
    }

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'Broker get failed');
    }

    return new Uint8Array(await res.arrayBuffer());
  }

  async put(path, data, options = {}) {
    const p = assertSafeRemotePath(path);
    const bytes = await bytesFromData(data);

    const res = await this.fetchImpl(
      this.url('/api/storage/object', {
        path: p,
        ifAbsent: options.ifAbsent ? '1' : '',
      }),
      {
        method: 'PUT',
        headers: this.headers({
          'content-type': 'application/octet-stream',
        }),
        body: bytes,
      }
    );

    if (res.status === 409) {
      const err = new Error(`Remote object already exists: ${p}`);
      err.code = 'EEXIST';
      throw err;
    }

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'Broker put failed');
    }
  }

  async delete(path) {
    const p = assertSafeRemotePath(path);

    const res = await this.fetchImpl(
      this.url('/api/storage/object', { path: p }),
      {
        method: 'DELETE',
        headers: this.headers(),
      }
    );

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'Broker delete failed');
    }
  }

  async stat(path) {
    const p = assertSafeRemotePath(path);

    const res = await this.fetchImpl(
      this.url('/api/storage/stat', { path: p }),
      {
        method: 'GET',
        headers: this.headers(),
      }
    );

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'Broker stat failed');
    }

    const json = await res.json();

    return json.entry || null;
  }

  async errorFromResponse(res, fallback) {
    let message = fallback;

    try {
      const json = await res.json();
      message = json.message || json.error || message;
    } catch {
      try {
        message = await res.text();
      } catch {}
    }

    const err = new Error(`${fallback}: ${res.status} ${message}`);
    err.status = res.status;

    return err;
  }
}
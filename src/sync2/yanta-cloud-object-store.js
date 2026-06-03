// ============================================================
// YANTA Sync2 — YantaCloudObjectStore
//
// Frontend RemoteObjectStore implementation for managed YANTA Cloud.
//
// The app talks to:
//   VITE_YANTA_CLOUD_API_BASE_URL
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

    const res = await this.fetchImpl(this.url('/api/me'), {
      method: 'GET',
      credentials: 'include',
    });

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

  async list(prefix = '') {
    const cleanPrefix = normalizeRemotePath(prefix);

    const res = await this.fetchImpl(
      this.url('/api/storage/list', {
        prefix: cleanPrefix,
      }),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
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

    const res = await this.fetchImpl(
      this.url('/api/storage/object', {
        path: p,
      }),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
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

    const res = await this.fetchImpl(
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

    const res = await this.fetchImpl(
      this.url('/api/storage/object', {
        path: p,
      }),
      {
        method: 'DELETE',
        credentials: 'include',
        headers: this.headers(),
      }
    );

    if (!res.ok) {
      throw await this.errorFromResponse(res, 'YANTA Cloud delete failed');
    }
  }

  async stat(path) {
    const p = assertSafeRemotePath(path);

    const res = await this.fetchImpl(
      this.url('/api/storage/stat', {
        path: p,
      }),
      {
        method: 'GET',
        credentials: 'include',
        headers: this.headers(),
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
    let payload = null;

    try {
      payload = await res.json();

      message =
        payload?.message ||
        payload?.error?.message ||
        payload?.error ||
        message;
    } catch {
      try {
        const text = await res.text();
        if (text) message = text;
      } catch {}
    }

    const err = new Error(`${fallback}: ${res.status} ${message}`);

    err.status = res.status;
    err.response = payload || null;

    return err;
  }
}
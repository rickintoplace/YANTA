import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoogleDriveObjectStore } from '../../src/sync2/google-drive-object-store.js';

/*
  A tiny fake of the Drive v3 endpoints the store uses, with a hook to
  script failures per request.
*/
function fakeDrive() {
  const files = new Map();
  let nextId = 1;
  let clock = Date.parse('2026-01-01T00:00:00Z');

  const drive = {
    files,
    calls: [],
    failNext: null, // (method, url) => Response | Error | null

    add(name, data = 'x') {
      const id = `f${nextId++}`;
      clock += 1000;
      files.set(id, { id, name, data, modifiedTime: new Date(clock).toISOString() });
      return id;
    },

    async fetch(input, init = {}) {
      const url = new URL(String(input));
      const method = (init.method || 'GET').toUpperCase();
      drive.calls.push(`${method} ${url.pathname}`);

      const scripted = drive.failNext?.(method, url);
      if (scripted) {
        drive.failNext = null;
        if (scripted instanceof Error) throw scripted;
        return scripted;
      }

      const json = (body, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

      const idMatch = url.pathname.match(/\/files\/([^/]+)$/);

      if (method === 'GET' && url.pathname.endsWith('/drive/v3/files')) {
        const q = url.searchParams.get('q') || '';
        const nameMatch = q.match(/name = '([^']+)'/);
        const list = [...files.values()]
          .filter((f) => !nameMatch || f.name === nameMatch[1])
          .map(({ id, name, modifiedTime, data }) => ({ id, name, modifiedTime, size: String(data.length) }));
        return json({ files: list });
      }

      if (method === 'GET' && idMatch) {
        const f = files.get(decodeURIComponent(idMatch[1]));
        return f ? new Response(f.data) : json({ error: { message: 'not found' } }, 404);
      }

      if (method === 'POST' && url.pathname.endsWith('/upload/drive/v3/files')) {
        const text = await init.body.text();
        const name = JSON.parse(text.split('\r\n\r\n')[1].split('\r\n')[0]).name;
        drive.add(name, 'created');
        return json({ id: 'new' });
      }

      if (method === 'PATCH' && idMatch) {
        const f = files.get(decodeURIComponent(idMatch[1]));
        clock += 1000;
        f.data = 'patched';
        f.modifiedTime = new Date(clock).toISOString();
        return json({ id: f.id });
      }

      if (method === 'DELETE' && idMatch) {
        files.delete(decodeURIComponent(idMatch[1]));
        return new Response(null, { status: 204 });
      }

      return json({ error: { message: `unhandled ${method} ${url}` } }, 500);
    },
  };

  return drive;
}

const errorResponse = (status, reason) =>
  new Response(JSON.stringify({ error: { code: status, message: reason, errors: [{ reason }] } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('GoogleDriveObjectStore', () => {
  let drive;
  let store;
  let fetchBefore;

  beforeEach(() => {
    drive = fakeDrive();
    fetchBefore = globalThis.fetch;
    globalThis.fetch = (...args) => drive.fetch(...args);

    store = new GoogleDriveObjectStore({ clientId: 'test' });
    store.ready = true;
    store.accessToken = 'token';
  });

  afterEach(() => {
    globalThis.fetch = fetchBefore;
    vi.useRealTimers();
  });

  it('reports one entry per path when Drive holds duplicates', async () => {
    const path = 'yanta-sync-v1/vault/heads/dev-a.yhead.enc';
    // Real file names are encoded; take the store's own encoding.
    await store.put(path, new Uint8Array([1]));
    const [{ name }] = [...drive.files.values()];
    drive.add(name, 'newer duplicate');

    const listed = await store.list('yanta-sync-v1/vault/heads/');
    expect(listed.filter((e) => e.path === path)).toHaveLength(1);

    const index = await store.index();
    expect(index.filter((e) => e.path === path)).toHaveLength(1);
  });

  it('cleans up duplicates when it overwrites a path', async () => {
    const path = 'yanta-sync-v1/vault/heads/dev-a.yhead.enc';
    await store.put(path, new Uint8Array([1]));
    const [{ name }] = [...drive.files.values()];
    drive.add(name, 'duplicate');

    await store.put(path, new Uint8Array([2]));

    const same = [...drive.files.values()].filter((f) => f.name === name);
    expect(same).toHaveLength(1);
    expect(same[0].data).toBe('patched');
  });

  it('does not retry a create after a network error', async () => {
    drive.failNext = (method) => (method === 'POST' ? new TypeError('Failed to fetch') : null);

    await expect(store.put('yanta-sync-v1/a.enc', new Uint8Array([1]), { ifAbsent: true }))
      .rejects.toThrow('Failed to fetch');

    expect(drive.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
  });

  it('maps a full Drive to EQUOTA', async () => {
    drive.failNext = (method) => (method === 'POST' ? errorResponse(403, 'storageQuotaExceeded') : null);

    await expect(store.put('yanta-sync-v1/a.enc', new Uint8Array([1])))
      .rejects.toMatchObject({ code: 'EQUOTA' });
  });

  it('retries a 403 rate limit', async () => {
    drive.failNext = (method) => (method === 'GET' ? errorResponse(403, 'userRateLimitExceeded') : null);

    await expect(store.list('')).resolves.toEqual([]);
    expect(drive.calls.filter((c) => c.startsWith('GET'))).toHaveLength(2);
  });
});

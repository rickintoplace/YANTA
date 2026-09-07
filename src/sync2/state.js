// ============================================================
// YANTA Sync2 — Persistent local sync state
//
// Separate IndexedDB database for Sync2 runtime state.
// This avoids touching core.js DB migrations.
//
// Stores:
// - kv:    generic key/value settings for sync2
// - seen:  remote object paths already processed
//
// This is intentionally small and provider-independent.
// ============================================================

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export class Sync2LocalStateStore {
  constructor({
    dbName = 'yanta-sync2-state',
    dbVersion = 1,
  } = {}) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
    this.db = null;

    this.seenCache = new Set();
    this.seenLoaded = false;
  }

  async init() {
    if (this.db) return this.db;

    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);

      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains('seen')) {
          db.createObjectStore('seen', { keyPath: 'path' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.db;
  }

  tx(storeName, mode = 'readonly') {
    if (!this.db) {
      throw new Error('Sync2LocalStateStore not initialized');
    }

    return this.db.transaction(storeName, mode);
  }

  async get(key, fallback = null) {
    await this.init();

    const tx = this.tx('kv', 'readonly');
    const rec = await reqToPromise(tx.objectStore('kv').get(key));

    return rec ? rec.value : fallback;
  }

  async set(key, value) {
    await this.init();

    const tx = this.tx('kv', 'readwrite');

    tx.objectStore('kv').put({
      key,
      value,
      updated: Date.now(),
    });

    await txDone(tx);
  }

  async delete(key) {
    await this.init();

    const tx = this.tx('kv', 'readwrite');

    tx.objectStore('kv').delete(key);

    await txDone(tx);
  }

  async loadSeenCache() {
    await this.init();

    if (this.seenLoaded) return;

    const tx = this.tx('seen', 'readonly');
    const all = await reqToPromise(tx.objectStore('seen').getAll());

    this.seenCache = new Set(all.map((r) => r.path));
    this.seenLoaded = true;
  }

  async hasSeen(path) {
    await this.loadSeenCache();
    return this.seenCache.has(path);
  }

  async markSeen(path, extra = {}) {
    await this.init();
    await this.loadSeenCache();

    const p = String(path || '');
    if (!p) return;

    this.seenCache.add(p);

    const tx = this.tx('seen', 'readwrite');

    tx.objectStore('seen').put({
      path: p,
      seenAt: Date.now(),
      ...extra,
    });

    await txDone(tx);
  }

  /*
    Accepts plain paths or per-entry records ({ path, size, etag, ... }).
    One transaction for the whole batch: a fresh device marks ~1000 objects
    seen, and one IndexedDB transaction each is a measurable part of the
    first sync.
  */
  async markManySeen(entries, extra = {}) {
    await this.init();
    await this.loadSeenCache();

    const tx = this.tx('seen', 'readwrite');
    const store = tx.objectStore('seen');
    const seenAt = Date.now();

    for (const entry of entries) {
      const record = typeof entry === 'string'
        ? { path: entry }
        : (entry || {});

      const p = String(record.path || '');
      if (!p) continue;

      this.seenCache.add(p);

      store.put({
        ...extra,
        ...record,
        path: p,
        seenAt,
      });
    }

    await txDone(tx);
  }

  async seenCount() {
    await this.loadSeenCache();
    return this.seenCache.size;
  }

  async listSeen() {
    await this.init();

    const tx = this.tx('seen', 'readonly');
    const all = await reqToPromise(tx.objectStore('seen').getAll());

    return all.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  }

  async clearSeen() {
    await this.init();

    const tx = this.tx('seen', 'readwrite');

    tx.objectStore('seen').clear();

    await txDone(tx);

    this.seenCache.clear();
    this.seenLoaded = true;
  }

  async clearAllForDebugOnly() {
    await this.init();

    {
      const tx = this.tx('kv', 'readwrite');
      tx.objectStore('kv').clear();
      await txDone(tx);
    }

    {
      const tx = this.tx('seen', 'readwrite');
      tx.objectStore('seen').clear();
      await txDone(tx);
    }

    this.seenCache.clear();
    this.seenLoaded = true;
  }
}

/*
  Buffered writer for the seen store.

  The parallel download loops apply objects in order and record each one
  here instead of opening an IndexedDB transaction per object. The batch
  flushes every `size` entries, so an interrupted first sync keeps most of
  its progress rather than re-downloading everything on the next attempt.
*/
export function createSeenBatch(engine, { size = 128 } = {}) {
  let buffer = [];

  const flush = async () => {
    if (!buffer.length) return;

    const batch = buffer;
    buffer = [];

    await engine.markManySeen(batch);
  };

  return {
    async add(record) {
      buffer.push(record);
      if (buffer.length >= size) await flush();
    },
    flush,
  };
}

// ============================================================
// YANTA — sealing what was stored before the lock was turned on
//
// New writes are sealed from the moment the key exists. This pass seals
// the rest: core records, every Yjs document database, thumbnails and
// the sealed localStorage entries (the semantic worker seals its own
// rows when it starts).
//
// Crash-safe by construction: readers accept sealed and plain values, and
// each record is replaced in a transaction that first checks it is still
// the plain record that was read — so a record the app rewrote (sealed)
// or deleted meanwhile is left alone. Interrupted, it resumes at the next
// start until it has gone through once (lock.v1.atRest.migratedAt).
// ============================================================

import { atRestStoreInternals } from '../core.js';
import { atRestActive, isSealed, sealBytes, sealRecord, sealValue } from './at-rest.js';
import { getLockConfig, atRestMigrationPending, markAtRestMigrated } from './lock-keys.js';
import { sealLocalEntries } from './sealed-local.js';

const BATCH = 50;
const Y_DB_PREFIXES = ['yanta-note-', 'yanta-space-'];
const Y_DB_NAMES = ['yanta-vault-v1'];

function readRows(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const keysReq = store.getAllKeys();
    const valuesReq = store.getAll();
    tx.oncomplete = () => resolve(keysReq.result.map((key, i) => ({ key, value: valuesReq.result[i] })));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('read aborted'));
  });
}

/** Replaces each row that is still plain; resolves with how many were sealed. */
function replaceIfPlain(db, storeName, rows) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    let count = 0;

    for (const { key, sealed, inline } of rows) {
      const r = store.get(key);
      r.onsuccess = () => {
        if (r.result === undefined || isSealed(r.result)) return;
        if (inline) store.put(sealed);
        else store.put(sealed, key);
        count++;
      };
    }

    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('write aborted'));
  });
}

async function sealCoreStore(storeName) {
  const { db, PLAIN_SETTINGS, sealFor, sealImage, queueWrite } = atRestStoreInternals;
  const handle = db();
  if (!handle) return 0;

  const plain = (await readRows(handle, storeName)).filter(({ value }) =>
    value && !isSealed(value) && !(storeName === 'settings' && PLAIN_SETTINGS.has(value.key))
  );

  let count = 0;
  for (let i = 0; i < plain.length; i += BATCH) {
    const batch = await Promise.all(plain.slice(i, i + BATCH).map(async ({ key, value }) => ({
      key,
      inline: true,
      sealed: storeName === 'images' ? await sealImage(value) : await sealFor(storeName, value),
    })));

    // Values that cannot be sealed (sealFor kept them plain) are skipped.
    const sealable = batch.filter((row) => isSealed(row.sealed));
    // In line with the app's own writes to this store.
    count += await queueWrite(storeName, () => replaceIfPlain(handle, storeName, sealable));
  }
  return count;
}

function openExisting(name) {
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    // Opening a name that does not exist creates it: undo that.
    req.onupgradeneeded = () => {
      req.transaction.abort();
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function yDocDatabaseNames() {
  if (typeof indexedDB.databases === 'function') {
    try {
      const all = await indexedDB.databases();
      return all.map((d) => d.name).filter((name) =>
        name && (Y_DB_NAMES.includes(name) || Y_DB_PREFIXES.some((prefix) => name.startsWith(prefix)))
      );
    } catch {}
  }

  // No databases() (older Firefox): every note, the vault, and every space.
  const { store } = await import('../core.js');
  const notes = await store.notes.all().catch(() => []);
  const spaces = await store.spaces.all().catch(() => []);
  return [
    ...Y_DB_NAMES,
    ...notes.map((n) => `yanta-note-${n.id}`),
    ...spaces.flatMap((s) => ['workspace', 'calendar', 'people'].map((kind) => `yanta-space-${kind}-${s.spaceId}`)),
  ];
}

async function sealYDatabase(name) {
  const db = await openExisting(name);
  if (!db) return 0;

  let count = 0;
  try {
    if (db.objectStoreNames.contains('updates')) {
      const plain = (await readRows(db, 'updates')).filter(({ value }) => value && !isSealed(value));
      for (let i = 0; i < plain.length; i += BATCH) {
        const batch = await Promise.all(plain.slice(i, i + BATCH).map(async ({ key, value }) => ({
          key,
          sealed: await sealBytes(value, name),
        })));
        count += await replaceIfPlain(db, 'updates', batch);
      }
    }

    if (db.objectStoreNames.contains('custom')) {
      const plain = (await readRows(db, 'custom')).filter(({ value }) => value !== undefined && !isSealed(value));
      const batch = [];
      for (const { key, value } of plain) {
        try {
          batch.push({ key, sealed: await sealValue(value, `${name}:custom`) });
        } catch {}
      }
      if (batch.length) count += await replaceIfPlain(db, 'custom', batch);
    }
  } finally {
    db.close();
  }
  return count;
}

async function sealThumbs() {
  const db = await openExisting('yanta-thumbs');
  if (!db) return 0;
  try {
    if (!db.objectStoreNames.contains('thumbs')) return 0;
    const plain = (await readRows(db, 'thumbs')).filter(({ value }) => value && !isSealed(value));
    const batch = await Promise.all(plain.map(async ({ key, value }) => ({
      key,
      inline: true,
      sealed: await sealRecord(value, ['key'], 'thumbs'),
    })));
    return batch.length ? replaceIfPlain(db, 'thumbs', batch) : 0;
  } finally {
    db.close();
  }
}

let running = null;

/** Seals everything still plain. Safe to call repeatedly; runs once at a time. */
export function migrateAtRest() {
  if (running) return running;

  running = (async () => {
    if (!atRestActive()) return null;

    const counts = { core: 0, docs: 0, thumbs: 0 };

    for (const storeName of ['settings', 'notes', 'folders', 'shares', 'spaces', 'images']) {
      counts.core += await sealCoreStore(storeName);
    }

    for (const name of await yDocDatabaseNames()) {
      counts.docs += await sealYDatabase(name);
    }

    counts.thumbs = await sealThumbs();
    await sealLocalEntries();

    await markAtRestMigrated();
    console.info('[YANTA] Stored data sealed', counts);
    return counts;
  })().finally(() => {
    running = null;
  });

  return running;
}

/** At start (after unlocking): finish an interrupted or pending migration in the background. */
export async function resumeAtRestMigration() {
  const config = await getLockConfig();
  if (!atRestMigrationPending(config)) return;
  migrateAtRest().catch((err) => console.warn('[YANTA] Sealing stored data paused', err));
}

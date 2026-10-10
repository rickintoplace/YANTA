import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';

const atRest = await import('../../src/lock/at-rest.js');
const core = await import('../../src/core.js');
const { IndexeddbPersistence } = await import('../../src/sync2/y-idb-persistence.js');
const { migrateAtRest } = await import('../../src/lock/at-rest-migrate.js');

const SECRET = 'Geheimprojekt Kolibri';

function rawAll(dbName, storeName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      const r = db.transaction(storeName).objectStore(storeName).getAll();
      r.onsuccess = () => { db.close(); resolve(r.result); };
      r.onerror = () => reject(r.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function containsSecret(value) {
  const seen = (v) => {
    if (v == null) return false;
    if (typeof v === 'string') return v.includes(SECRET);
    if (v instanceof Uint8Array) return new TextDecoder().decode(v).includes(SECRET);
    if (typeof v === 'object') return Object.values(v).some(seen);
    return false;
  };
  return seen(value);
}

async function loadDoc(name) {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(name, doc);
  await persistence.whenSynced;
  return { doc, persistence };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  atRest.clearAtRestKey();
  await core.openDB();
});

describe('encryption at rest', () => {
  it('round-trips values with bytes, dates, maps, sets and blobs', async () => {
    await atRest.setAtRestKeyFromLdk(crypto.getRandomValues(new Uint8Array(32)));
    const value = {
      text: SECRET,
      bytes: new Uint8Array([1, 2, 3]),
      when: new Date(1_700_000_000_000),
      map: new Map([['a', 1]]),
      set: new Set(['x']),
      nested: [{ n: null, u: undefined }],
      blob: new Blob(['hello'], { type: 'text/plain' }),
    };

    const sealed = await atRest.sealValue(value, 'test');
    expect(atRest.isSealed(sealed)).toBe(true);
    expect(containsSecret(sealed)).toBe(false);

    const opened = await atRest.openValue(sealed, 'test');
    expect(opened.text).toBe(SECRET);
    expect([...opened.bytes]).toEqual([1, 2, 3]);
    expect(opened.when.getTime()).toBe(1_700_000_000_000);
    expect(opened.map.get('a')).toBe(1);
    expect(opened.set.has('x')).toBe(true);
    expect(await opened.blob.text()).toBe('hello');

    await expect(atRest.openValue(sealed, 'other')).rejects.toThrow();
    atRest.clearAtRestKey();
    await expect(atRest.openValue(sealed, 'test')).rejects.toMatchObject({ code: 'ELOCKED' });
  });

  it('passes everything through while inactive', async () => {
    expect(await atRest.sealValue({ a: 1 })).toEqual({ a: 1 });
    await core.store.notes.put({ id: 'n1', title: SECRET, folderId: null, updated: 1 });
    const raw = await rawAll('yanta', 'notes');
    expect(raw[0].title).toBe(SECRET);
  });

  it('seals core records but keeps keys, index fields and boot settings readable', async () => {
    await atRest.setAtRestKeyFromLdk(crypto.getRandomValues(new Uint8Array(32)));

    await core.store.notes.put({ id: 'n1', title: SECRET, folderId: 'f1', updated: 5, tags: ['x'] });
    await core.store.notes.put({ id: 'n1', title: `${SECRET} 2`, folderId: 'f1', updated: 6, tags: ['x'] });
    await core.store.settings.set('sync2.syncKey', SECRET);
    await core.store.settings.set('sync2.provider', 'yanta-cloud');
    await core.store.images.put({ id: 'i1', name: SECRET, blob: new Blob([SECRET], { type: 'image/png' }) });

    const notes = await rawAll('yanta', 'notes');
    expect(notes).toHaveLength(1);
    expect(containsSecret(notes)).toBe(false);
    expect(notes[0]).toMatchObject({ id: 'n1', folderId: 'f1', updated: 6 });

    const settings = await rawAll('yanta', 'settings');
    expect(containsSecret(settings)).toBe(false);
    expect(settings.find((s) => s.key === 'sync2.provider').value).toBe('yanta-cloud');

    expect(containsSecret(await rawAll('yanta', 'images'))).toBe(false);

    expect((await core.store.notes.all())[0].title).toBe(`${SECRET} 2`);
    expect(await core.store.settings.get('sync2.syncKey')).toBe(SECRET);
    expect(await core.store.settings.get('missing', 'fallback')).toBe('fallback');

    const image = await core.store.images.get('i1');
    expect(image.name).toBe(SECRET);
    expect(await image.blob.text()).toBe(SECRET);
    expect(image.blob.type).toBe('image/png');
    const [meta] = await core.store.images.allMeta();
    expect(meta).toEqual({ id: 'i1', name: SECRET });
  });

  it('seals Yjs updates and reads a mix of plain and sealed ones', async () => {
    const plain = await loadDoc('yanta-note-a');
    plain.doc.getText('markdown').insert(0, 'before ');
    await plain.persistence.destroy();

    await atRest.setAtRestKeyFromLdk(crypto.getRandomValues(new Uint8Array(32)));

    const mixed = await loadDoc('yanta-note-a');
    expect(mixed.doc.getText('markdown').toString()).toBe('before ');
    mixed.doc.getText('markdown').insert(7, SECRET);
    await mixed.persistence.set('meta', { title: SECRET });
    await mixed.persistence.destroy();

    const updates = await rawAll('yanta-note-a', 'updates');
    expect(updates.some((u) => atRest.isSealed(u))).toBe(true);
    expect(containsSecret(updates)).toBe(false);
    expect(containsSecret(await rawAll('yanta-note-a', 'custom'))).toBe(false);

    const again = await loadDoc('yanta-note-a');
    expect(again.doc.getText('markdown').toString()).toBe(`before ${SECRET}`);
    expect((await again.persistence.get('meta')).title).toBe(SECRET);
    await again.persistence.destroy();
  });

  it('migration seals what was written before, and everything stays readable', async () => {
    await core.store.notes.put({ id: 'n1', title: SECRET, folderId: null, updated: 1 });
    await core.store.settings.set('sync2.syncKey', SECRET);
    await core.store.settings.set('lock.v1', { enabled: true });
    const before = await loadDoc('yanta-note-n1');
    before.doc.getText('markdown').insert(0, SECRET);
    await before.persistence.destroy();

    await atRest.setAtRestKeyFromLdk(crypto.getRandomValues(new Uint8Array(32)));
    const counts = await migrateAtRest();
    expect(counts.core).toBe(2);
    expect(counts.docs).toBeGreaterThan(0);

    expect(containsSecret(await rawAll('yanta', 'notes'))).toBe(false);
    expect(containsSecret(await rawAll('yanta', 'settings'))).toBe(false);
    expect(containsSecret(await rawAll('yanta-note-n1', 'updates'))).toBe(false);

    expect((await core.store.notes.all())[0].title).toBe(SECRET);
    expect(await core.store.settings.get('sync2.syncKey')).toBe(SECRET);
    expect((await core.store.settings.get('lock.v1')).atRest.migratedAt).toBeGreaterThan(0);
    const after = await loadDoc('yanta-note-n1');
    expect(after.doc.getText('markdown').toString()).toBe(SECRET);
    await after.persistence.destroy();

    // A second run finds nothing left to do.
    expect((await migrateAtRest()).core).toBe(0);
  });
});

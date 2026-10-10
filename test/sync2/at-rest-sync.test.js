import { describe, it, expect } from 'vitest';
import { bootApp, createOrigin, IndexedMemoryObjectStore, newSyncKey, restartApp } from './harness.js';

/*
  A device with the app lock on stores everything sealed (lock/at-rest.js)
  and syncs with devices that do not. Nothing about sync may change.
*/

const SECRET = 'Kolibri-Geheimnis';

function rawRows(dbName, storeName) {
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

function mentions(value, text) {
  if (value == null) return false;
  if (typeof value === 'string') return value.includes(text);
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).includes(text);
  if (typeof value === 'object') return Object.values(value).some((v) => mentions(v, text));
  return false;
}

describe('sync with encryption at rest', () => {
  it('a sealed device and a plain device exchange notes and bodies', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();
    const ldk = crypto.getRandomValues(new Uint8Array(32));

    let laptop = await bootApp(createOrigin('laptop'), { remote, syncKey, deviceId: 'dev-laptop', atRestLdk: ldk });
    await laptop.createNote({ id: 'n1', title: SECRET }, `${SECRET} body`);
    await laptop.sync();

    const phone = await bootApp(createOrigin('phone'), { remote, syncKey, deviceId: 'dev-phone' });
    await phone.sync();
    expect(phone.core.state.notes.get('n1')?.title).toBe(SECRET);
    phone.activate();
    const body = phone.yjs.getNoteDoc('n1');
    await body.ready;
    expect(body.doc.getText('markdown').toString()).toBe(`${SECRET} body`);

    await phone.createNote({ id: 'n2', title: 'Vom Telefon' }, 'Telefontext');
    await phone.sync();

    laptop.activate();
    await laptop.sync();
    expect(laptop.core.state.notes.get('n2')?.title).toBe('Vom Telefon');

    // What the laptop stored is sealed — and survives a restart.
    laptop = await restartApp(laptop);
    laptop.activate();
    const noteRows = await rawRows('yanta', 'notes');
    expect(noteRows.length).toBeGreaterThan(0);
    expect(noteRows.every((row) => row.__yse === 1)).toBe(true);
    expect(mentions(noteRows, SECRET)).toBe(false);
    expect(mentions(await rawRows('yanta-note-n1', 'updates'), SECRET)).toBe(false);
    expect(mentions(await rawRows('yanta-vault-v1', 'updates'), SECRET)).toBe(false);

    expect(laptop.core.state.notes.get('n1')?.title).toBe(SECRET);
    expect(laptop.core.state.notes.get('n2')?.title).toBe('Vom Telefon');
    const fromPhone = laptop.yjs.getNoteDoc('n2');
    await fromPhone.ready;
    expect(fromPhone.doc.getText('markdown').toString()).toBe('Telefontext');

    await laptop.shutdown();
    phone.activate();
    await phone.shutdown();
  });
});

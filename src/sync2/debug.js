// ============================================================
// YANTA Sync2 — Debug simulation
//
// This file gives you a provider-independent sync proof-of-concept:
// two fake devices sync over one shared MemoryObjectStore.
//
// Run in browser console while Vite dev server is running:
//
//   import('/src/sync2/debug.js').then(m => m.runSync2DebugSimulation())
//
// This does NOT modify the real YANTA app state.
// It is intentionally isolated.
// ============================================================

import * as Y from 'yjs';

import { MemoryObjectStore } from './memory-store.js';
import {
  generateSyncKey,
  deriveKeys,
  encryptBytes,
  decryptBytes,
  utf8Encode,
} from './crypto.js';

import {
  createDeviceId,
  createVaultId,
  bootstrapPath,
  vaultUpdatePath,
  docUpdatePath,
  vaultUpdatesPrefix,
  docUpdatesPrefix,
} from './ids.js';

import {
  createAndEncodeUpdatePack,
  decodePack,
} from './pack.js';

const SYNC_REMOTE_ORIGIN = 'sync2-remote';
const LOCAL_ORIGIN = 'sync2-local';

function nowIso() {
  return new Date().toISOString();
}

function cloneJson(v) {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v ?? null));
  }
}

function noteText(doc) {
  return doc.getText('markdown').toString();
}

export class Sync2DebugDevice {
  constructor({
    name,
    remote,
    syncKey,
    deviceId = createDeviceId(name || 'dev'),
    vaultId = createVaultId(),
  }) {
    if (!remote) throw new Error('remote store required');
    if (!syncKey) throw new Error('syncKey required');

    this.name = name || deviceId;
    this.deviceId = deviceId;
    this.vaultId = vaultId;
    this.remote = remote;
    this.syncKey = syncKey;

    this.keys = null;

    this.vaultDoc = new Y.Doc();
    this.noteDocs = new Map();

    this.seq = 0;
    this.outbox = [];
    this.seen = new Set();

    this.ready = false;
  }

  async init() {
    if (this.ready) return;

    await this.remote.init();
    this.keys = await deriveKeys(this.syncKey);

    this.observeVault();

    await this.ensureBootstrap();

    this.ready = true;
  }

  async ensureBootstrap() {
    const path = bootstrapPath();
    const existing = await this.remote.stat(path);

    if (existing) return;

    const bootstrap = {
      format: 'yanta-sync',
      version: 1,
      vaultId: this.vaultId,
      created: nowIso(),
      encryption: {
        alg: 'AES-GCM',
        kdf: 'raw-256',
      },
    };

    await this.remote.put(
      path,
      utf8Encode(JSON.stringify(bootstrap, null, 2)),
      { ifAbsent: true }
    ).catch((err) => {
      // Another device may have created it first.
      if (err?.code !== 'EEXIST') throw err;
    });
  }

  observeVault() {
    this.vaultDoc.on('update', (update, origin) => {
      if (origin === SYNC_REMOTE_ORIGIN) return;

      this.outbox.push({
        kind: 'vault',
        update: new Uint8Array(update),
        created: Date.now(),
      });
    });
  }

  get notesMap() {
    return this.vaultDoc.getMap('notes');
  }

  get foldersMap() {
    return this.vaultDoc.getMap('folders');
  }

  get imagesMap() {
    return this.vaultDoc.getMap('images');
  }

  get settingsMap() {
    return this.vaultDoc.getMap('settings');
  }

  get tombstonesMap() {
    return this.vaultDoc.getMap('tombstones');
  }

  getNoteDoc(noteId) {
    let doc = this.noteDocs.get(noteId);

    if (doc) return doc;

    doc = new Y.Doc();

    doc.on('update', (update, origin) => {
      if (origin === SYNC_REMOTE_ORIGIN) return;

      this.outbox.push({
        kind: 'note',
        noteId,
        update: new Uint8Array(update),
        created: Date.now(),
      });
    });

    this.noteDocs.set(noteId, doc);

    return doc;
  }

  listNotes() {
    return [...this.notesMap.entries()]
      .map(([id, meta]) => ({ id, ...cloneJson(meta) }))
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }

  readNote(noteId) {
    const doc = this.getNoteDoc(noteId);
    return noteText(doc);
  }

  createNote(noteId, title, markdown = '') {
    const created = Date.now();

    this.vaultDoc.transact(() => {
      this.notesMap.set(noteId, {
        id: noteId,
        title: title || 'Untitled',
        type: 'markdown',
        folderId: null,
        tags: [],
        pinned: false,
        created,
        updated: created,
      });
    }, LOCAL_ORIGIN);

    const doc = this.getNoteDoc(noteId);
    const ytext = doc.getText('markdown');

    doc.transact(() => {
      if (markdown) ytext.insert(0, markdown);
    }, LOCAL_ORIGIN);
  }

  appendMarkdown(noteId, text) {
    const doc = this.getNoteDoc(noteId);
    const ytext = doc.getText('markdown');

    doc.transact(() => {
      ytext.insert(ytext.length, text);
    }, LOCAL_ORIGIN);

    const meta = this.notesMap.get(noteId);

    if (meta) {
      this.vaultDoc.transact(() => {
        this.notesMap.set(noteId, {
          ...cloneJson(meta),
          updated: Date.now(),
        });
      }, LOCAL_ORIGIN);
    }
  }

  renameNote(noteId, title) {
    const meta = this.notesMap.get(noteId);
    if (!meta) return;

    this.vaultDoc.transact(() => {
      this.notesMap.set(noteId, {
        ...cloneJson(meta),
        title: title || 'Untitled',
        updated: Date.now(),
      });
    }, LOCAL_ORIGIN);
  }

  createFolder(folderId, name, parentId = null) {
    const created = Date.now();

    this.vaultDoc.transact(() => {
      this.foldersMap.set(folderId, {
        id: folderId,
        name: name || 'Folder',
        parentId,
        created,
        updated: created,
      });
    }, LOCAL_ORIGIN);
  }

  renameFolder(folderId, name) {
    const folder = this.foldersMap.get(folderId);
    if (!folder) return;

    this.vaultDoc.transact(() => {
      this.foldersMap.set(folderId, {
        ...cloneJson(folder),
        name: name || 'Folder',
        updated: Date.now(),
      });
    }, LOCAL_ORIGIN);
  }

  moveNoteToFolder(noteId, folderId) {
    const meta = this.notesMap.get(noteId);
    if (!meta) return;

    this.vaultDoc.transact(() => {
      this.notesMap.set(noteId, {
        ...cloneJson(meta),
        folderId: folderId || null,
        updated: Date.now(),
      });
    }, LOCAL_ORIGIN);
  }

  deleteNote(noteId) {
    const meta = this.notesMap.get(noteId);

    this.vaultDoc.transact(() => {
      this.notesMap.delete(noteId);
      this.tombstonesMap.set(noteId, {
        id: noteId,
        type: 'note',
        title: meta?.title || '',
        deletedAt: Date.now(),
        deletedBy: this.deviceId,
      });
    }, LOCAL_ORIGIN);
  }

  async sync() {
    await this.init();

    await this.uploadOutbox();
    await this.downloadVaultUpdates();
    await this.downloadKnownNoteUpdates();

    return {
      device: this.name,
      outbox: this.outbox.length,
      seen: this.seen.size,
      notes: this.listNotes(),
    };
  }

  async uploadOutbox() {
    while (this.outbox.length) {
      const item = this.outbox.shift();
      const seq = ++this.seq;

      let path;

      if (item.kind === 'vault') {
        path = vaultUpdatePath(this.deviceId, seq);
      } else if (item.kind === 'note') {
        path = await docUpdatePath(
          this.keys.nameKey,
          item.noteId,
          this.deviceId,
          seq
        );
      } else {
        throw new Error(`Unknown outbox item kind: ${item.kind}`);
      }

      const packBytes = createAndEncodeUpdatePack({
        kind: item.kind,
        deviceId: this.deviceId,
        seq,
        docId: item.noteId || 'vault',
        updates: [item.update],
        meta: {
          debugDeviceName: this.name,
        },
      });

      const encrypted = await encryptBytes(
        this.keys.contentKey,
        packBytes,
        path
      );

      await this.remote.put(path, encrypted, { ifAbsent: true });

      // Own uploaded object is considered seen.
      this.seen.add(path);
    }
  }

  async downloadVaultUpdates() {
    const entries = await this.remote.list(vaultUpdatesPrefix());

    for (const entry of entries) {
      if (this.seen.has(entry.path)) continue;

      const encrypted = await this.remote.get(entry.path);
      const plain = await decryptBytes(
        this.keys.contentKey,
        encrypted,
        entry.path
      );

      const pack = decodePack(plain);

      if (pack.kind !== 'vault') {
        this.seen.add(entry.path);
        continue;
      }

      for (const update of pack.updates) {
        Y.applyUpdate(this.vaultDoc, update, SYNC_REMOTE_ORIGIN);
      }

      this.seen.add(entry.path);
    }
  }

  async downloadKnownNoteUpdates() {
    const notes = this.listNotes();

    for (const note of notes) {
      await this.downloadNoteUpdates(note.id);
    }
  }

  async downloadNoteUpdates(noteId) {
    const prefix = await docUpdatesPrefix(this.keys.nameKey, noteId);
    const entries = await this.remote.list(prefix);

    for (const entry of entries) {
      if (this.seen.has(entry.path)) continue;

      const encrypted = await this.remote.get(entry.path);
      const plain = await decryptBytes(
        this.keys.contentKey,
        encrypted,
        entry.path
      );

      const pack = decodePack(plain);

      if (pack.kind !== 'note') {
        this.seen.add(entry.path);
        continue;
      }

      const doc = this.getNoteDoc(noteId);

      for (const update of pack.updates) {
        Y.applyUpdate(doc, update, SYNC_REMOTE_ORIGIN);
      }

      this.seen.add(entry.path);
    }
  }

  debugState() {
    const notes = this.listNotes().map((n) => ({
      ...n,
      body: this.readNote(n.id),
    }));

    return {
      name: this.name,
      deviceId: this.deviceId,
      seq: this.seq,
      outbox: this.outbox.length,
      seen: this.seen.size,
      notes,
      folders: [...this.foldersMap.entries()].map(([id, f]) => ({
        id,
        ...cloneJson(f),
      })),
      tombstones: [...this.tombstonesMap.entries()].map(([id, t]) => ({
        id,
        ...cloneJson(t),
      })),
    };
  }
}

/**
 * Browser-console test:
 *
 *   import('/src/sync2/debug.js').then(m => m.runSync2DebugSimulation())
 */
export async function runSync2DebugSimulation() {
  console.group('YANTA Sync2 Debug Simulation');

  const remote = new MemoryObjectStore();
  const syncKey = generateSyncKey();

  const deviceA = new Sync2DebugDevice({
    name: 'mac',
    remote,
    syncKey,
  });

  const deviceB = new Sync2DebugDevice({
    name: 'phone',
    remote,
    syncKey,
  });

  await deviceA.init();
  await deviceB.init();

  console.log('syncKey', syncKey);

  console.group('1. Device A creates note');
  deviceA.createFolder('folder_research', 'Research');
  deviceA.createNote('note_hello', 'Hello Sync2', '# Hello from device A\n');
  deviceA.moveNoteToFolder('note_hello', 'folder_research');

  await deviceA.sync();
  await deviceB.sync();

  console.log('A', deviceA.debugState());
  console.log('B', deviceB.debugState());

  if (deviceB.readNote('note_hello') !== '# Hello from device A\n') {
    throw new Error('Step 1 failed: B did not receive note body');
  }

  console.groupEnd();

  console.group('2. Offline concurrent edits');
  deviceA.appendMarkdown('note_hello', '\nA offline edit.\n');
  deviceB.appendMarkdown('note_hello', '\nB offline edit.\n');

  await deviceA.sync();
  await deviceB.sync();
  await deviceA.sync();
  await deviceB.sync();

  const aBody = deviceA.readNote('note_hello');
  const bBody = deviceB.readNote('note_hello');

  console.log('A body', aBody);
  console.log('B body', bBody);

  if (aBody !== bBody) {
    throw new Error('Step 2 failed: A and B diverged');
  }

  if (!aBody.includes('A offline edit') || !aBody.includes('B offline edit')) {
    throw new Error('Step 2 failed: merged text missing one edit');
  }

  console.groupEnd();

  console.group('3. Folder rename');
  deviceB.renameFolder('folder_research', 'Research Notes');

  await deviceB.sync();
  await deviceA.sync();

  console.log('A folders', deviceA.debugState().folders);
  console.log('B folders', deviceB.debugState().folders);

  const folderA = deviceA.foldersMap.get('folder_research');

  if (folderA?.name !== 'Research Notes') {
    throw new Error('Step 3 failed: folder rename did not sync');
  }

  console.groupEnd();

  console.group('4. Delete/tombstone');
  deviceA.deleteNote('note_hello');

  await deviceA.sync();
  await deviceB.sync();

  console.log('A', deviceA.debugState());
  console.log('B', deviceB.debugState());

  if (deviceB.notesMap.has('note_hello')) {
    throw new Error('Step 4 failed: note was resurrected on B');
  }

  if (!deviceB.tombstonesMap.has('note_hello')) {
    throw new Error('Step 4 failed: tombstone missing on B');
  }

  console.groupEnd();

  console.group('Remote object dump');
  console.log(remote.dumpText());
  console.groupEnd();

  console.log('✅ Sync2 debug simulation passed');

  console.groupEnd();

  return {
    remote,
    syncKey,
    deviceA,
    deviceB,
  };
}
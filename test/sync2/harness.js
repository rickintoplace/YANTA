// ============================================================
// Multi-device harness for sync2.
//
// Every simulated device (or browser tab) gets the real app modules —
// core store, VaultDoc, store bridge, sync engine — in a fresh module
// graph, backed by its own fake IndexedDB "origin". Devices share one
// in-memory remote, so a test can drive real sync cycles between them.
//
// Constraints:
// - Only one *origin* may be active at a time: y-indexeddb and the
//   sync2 state store look up the global `indexedDB` when they open a
//   database, so switching origins mid-operation would cross wires.
//   Always drive one device to completion (`await`) before the next.
//   Tabs of the same origin share a factory and may run concurrently.
// - UI modules (notes.js, tree.js) are stubbed; everything sync-related
//   is the production code.
// ============================================================

import { vi } from 'vitest';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';

import { MemoryObjectStore } from '../../src/sync2/memory-store.js';
import { normalizeRemotePath } from '../../src/sync2/object-store.js';

const SRC = resolve(__dirname, '../../src');
const src = (p) => resolve(SRC, p);

/*
  Mirrors YantaCloudObjectStore: it exposes index(), which is what
  enables the head-based pruning paths (MemoryObjectStore alone does not).
*/
export class IndexedMemoryObjectStore extends MemoryObjectStore {
  async index() {
    return this.list('');
  }

  paths(prefix = '') {
    const p = normalizeRemotePath(prefix);
    return [...this.objects.keys()].filter((k) => !p || k.startsWith(p)).sort();
  }
}

// Minimal Web Locks implementation shared by all tabs of one origin:
// exclusive/shared modes, FIFO granting, ifAvailable.
export class FakeLockManager {
  constructor() {
    this.locks = new Map(); // name -> { held: [{ mode }], queue: [] }
  }

  state(name) {
    if (!this.locks.has(name)) this.locks.set(name, { held: [], queue: [] });
    return this.locks.get(name);
  }

  grantable(st, mode, { ignoreQueue = false } = {}) {
    if (!ignoreQueue && st.queue.length) return false;
    if (mode === 'shared') return st.held.every((h) => h.mode === 'shared');
    return st.held.length === 0;
  }

  pump(name) {
    const st = this.state(name);

    while (st.queue.length) {
      const next = st.queue[0];
      if (!this.grantable(st, next.mode, { ignoreQueue: true })) break;
      st.queue.shift();
      next.grant();
    }
  }

  async request(name, optionsOrFn, maybeFn) {
    const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
    const options = typeof optionsOrFn === 'function' ? {} : (optionsOrFn || {});
    const mode = options.mode === 'shared' ? 'shared' : 'exclusive';
    const st = this.state(name);

    if (options.ifAvailable && !this.grantable(st, mode)) {
      return fn(null);
    }

    const entry = { mode };

    if (this.grantable(st, mode)) {
      st.held.push(entry);
    } else {
      await new Promise((grant) => {
        st.queue.push({ mode, grant: () => { st.held.push(entry); grant(); } });
      });
    }

    try {
      return await fn({ name, mode });
    } finally {
      st.held.splice(st.held.indexOf(entry), 1);
      this.pump(name);
    }
  }
}

export function createOrigin(name) {
  return {
    name,
    idb: new IDBFactory(),
    locks: new FakeLockManager(),
  };
}

export function activateOrigin(origin) {
  globalThis.indexedDB = origin.idb;

  Object.defineProperty(globalThis.navigator, 'locks', {
    value: origin.locks,
    configurable: true,
  });
}

function stubUiModules() {
  vi.doMock(src('notes.js'), () => ({
    isNoteTitleFieldFocused: () => false,
    rebuildWikilinkIndex: () => {},
  }));

  vi.doMock(src('tree.js'), () => ({
    renderTree: () => {},
  }));
}

/*
  Boot one app instance the way main.js does: open the core DB, prepare
  the VaultDoc, install the store bridge, load the local cache into
  state, seed + hydrate, then start a sync engine.
*/
export async function bootApp(origin, {
  remote,
  syncKey,
  deviceId,
  startEngine = true,
  // Extra src-relative modules this app instance needs (loaded into its
  // own module graph; importing later would hit another device's graph).
  modules = [],
  // A Local Data Key: this device runs with the app lock on, so
  // everything it stores is sealed (lock/at-rest.js).
  atRestLdk = null,
} = {}) {
  activateOrigin(origin);

  // The bits of index.html that core UI helpers expect (toast).
  if (!document.getElementById('toast')) {
    document.body.insertAdjacentHTML('beforeend', '<div id="toast" hidden></div>');
  }

  vi.resetModules();
  stubUiModules();

  const atRest = await import(src('lock/at-rest.js'));
  if (atRestLdk) await atRest.setAtRestKeyFromLdk(atRestLdk);

  const core = await import(src('core.js'));
  const vaultDoc = await import(src('sync2/vault-doc.js'));
  const bridge = await import(src('sync2/store-bridge.js'));
  const yjs = await import(src('yjs.js'));
  const engineMod = await import(src('sync2/app-engine.js'));
  const stateMod = await import(src('sync2/state.js'));
  const startup = await import(src('sync2/startup-hydrate.js'));
  const heads = await import(src('sync2/heads.js'));
  const compaction = await import(src('sync2/cloud-compaction.js'));

  const mods = {};
  for (const rel of modules) mods[rel] = await import(src(rel));

  await core.openDB();
  await vaultDoc.prepareVaultDoc();
  await bridge.installVaultStoreBridge();

  const [notes, folders, images] = await Promise.all([
    core.store.notes.all(),
    core.store.folders.all(),
    core.store.images.allMeta(),
  ]);

  for (const n of notes) core.state.notes.set(n.id, n);
  for (const f of folders) core.state.folders.set(f.id, f);
  for (const im of images) core.state.imagesMeta.set(im.id, im);

  await bridge.seedVaultFromLocalState();
  await startup.hydrateLocalMetadataFromVaultDocOnStartup();

  const app = {
    origin,
    core,
    vaultDoc,
    bridge,
    yjs,
    engineMod,
    heads,
    compaction,
    mods,
    modules,
    atRestLdk,
    engine: null,
    remote,
    deviceId,

    activate() {
      activateOrigin(origin);
    },

    async compact(options = {}) {
      activateOrigin(origin);
      return compaction.compactYantaCloudStorage(app.engine, options);
    },

    async sync(options = {}) {
      activateOrigin(origin);
      return app.engine.syncNow({ verbose: false, ...options });
    },

    // Local user edits go through the real store (and thus the bridge).
    async createNote(meta, body = '') {
      activateOrigin(origin);
      const now = Date.now();
      const note = {
        type: 'markdown',
        folderId: null,
        tags: [],
        pinned: false,
        created: now,
        updated: now,
        ...meta,
      };

      core.state.notes.set(note.id, note);
      await core.store.notes.put(note);

      if (body) {
        const entry = yjs.getNoteDoc(note.id);
        await entry.ready;
        await app.engine?.observeNote(note.id);
        entry.doc.getText('markdown').insert(0, body);
      }

      return note;
    },

    async updateNote(id, patch) {
      activateOrigin(origin);
      const note = { ...core.state.notes.get(id), ...patch, updated: Date.now() };
      core.state.notes.set(id, note);
      await core.store.notes.put(note);
      return note;
    },

    async cachedNote(id) {
      activateOrigin(origin);
      return core.store.notes.get(id);
    },

    vaultNote(id) {
      return vaultDoc.vaultNotesMap().get(id) || null;
    },

    isTombstoned(id) {
      return vaultDoc.vaultTombstonesMap().has(id);
    },

    async shutdown() {
      activateOrigin(origin);
      app.engine?.stop();
      // Let y-indexeddb flush queued writes before closing.
      await new Promise((r) => setTimeout(r, 20));
      try {
        await vaultDoc.getVaultEntry().persistence.destroy();
      } catch {}
    },
  };

  if (startEngine) {
    const localState = new stateMod.Sync2LocalStateStore({
      dbName: 'yanta-sync2-state',
    });

    app.engine = new engineMod.Sync2AppEngine({
      remote,
      localState,
      syncKey,
      deviceId,
    });

    await app.engine.start();
  }

  return app;
}

export async function restartApp(app) {
  await app.shutdown();

  // A restart closes the tab; the browser drops every lock it held.
  app.origin.locks = new FakeLockManager();

  return bootApp(app.origin, {
    remote: app.remote,
    syncKey: app.engine?.syncKey,
    deviceId: app.deviceId,
    startEngine: !!app.engine,
    modules: app.modules,
    atRestLdk: app.atRestLdk,
  });
}

export async function newSyncKey() {
  const { generateSyncKey } = await import('../../src/sync2/crypto.js');
  return generateSyncKey();
}

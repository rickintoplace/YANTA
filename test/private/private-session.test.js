import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('../../src/core.js', () => ({
  state: { notes: new Map(), folders: new Map(), searchIndex: new Map(), expandedFolders: new Set(), spaces: new Map() },
  store: { notes: {}, folders: {} },
  toast: () => {},
  uid: () => Math.random().toString(36).slice(2),
  isPrivateItem: (item) => !!item?.privateFolderId,
  isPrivateCarrier: (note) => !!note?.privateCarrierFor,
}));
vi.mock('../../src/yjs.js', () => ({
  adoptExternalNoteDoc: () => {},
  releaseExternalNoteDoc: () => {},
  getNoteDoc: () => ({ doc: new Y.Doc(), ready: Promise.resolve() }),
}));
vi.mock('../../src/sync2/vault-doc.js', () => ({
  getVaultEntry: () => ({ ready: Promise.resolve(), persistence: null }),
  vaultNotesMap: () => new Map(),
  vaultTombstonesMap: () => new Map(),
}));

const { PrivateSessionForTests: Session } = await import('../../src/private/private-folders.js');
const { generateFolderKey } = await import('../../src/private/private-crypto.js');

/** Two devices' carrier docs, synced on demand like the sync engine would. */
function syncDocs(a, b) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'remote');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), 'remote');
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('private folder session', () => {
  it('two devices edit, one compacts meanwhile, nothing is lost', async () => {
    const key = generateFolderKey();
    const carrierA = new Y.Doc();
    const carrierB = new Y.Doc();

    const a = new Session('pf', new Uint8Array(key), carrierA);
    await a.load();
    a.putNote({ id: 'n1', title: 'Eins', folderId: 'pf', created: 1, updated: 1 });
    a.bodyDoc('n1').getText('markdown').insert(0, 'A1 ');
    await a.flushNow();
    syncDocs(carrierA, carrierB);

    const b = new Session('pf', new Uint8Array(key), carrierB);
    await b.load();
    expect(b.bodyDoc('n1').getText('markdown').toString()).toBe('A1 ');

    // Concurrent: A writes a lot and compacts; B writes too, not yet synced.
    for (let i = 0; i < 30; i++) {
      a.bodyDoc('n1').getText('markdown').insert(0, 'x');
      await a.flushNow();
    }
    b.putNote({ id: 'n2', title: 'Zwei', folderId: 'pf', created: 2, updated: 2 });
    b.bodyDoc('n2').getText('markdown').insert(0, 'B2');
    await b.flushNow();

    await a.compact();
    syncDocs(carrierA, carrierB);
    await settle();
    await a.applying;
    await b.applying;

    // A fresh device reads the merged log.
    const carrierC = new Y.Doc();
    Y.applyUpdate(carrierC, Y.encodeStateAsUpdate(carrierA));
    const c = new Session('pf', new Uint8Array(key), carrierC);
    await c.load();

    expect(c.bodyDoc('n1').getText('markdown').toString()).toBe('x'.repeat(30) + 'A1 ');
    expect(c.bodyDoc('n2').getText('markdown').toString()).toBe('B2');
    expect([...c.container.getMap('notes').keys()].sort()).toEqual(['n1', 'n2']);

    // B, live, also sees A's edits.
    expect(b.bodyDoc('n1').getText('markdown').toString()).toBe('x'.repeat(30) + 'A1 ');

    // The log shrank on A's side of the compaction.
    expect(carrierC.getArray('privateLog').length).toBeLessThan(10);
  });

  it('a wrong key reads nothing', async () => {
    const carrier = new Y.Doc();
    const a = new Session('pf', generateFolderKey(), carrier);
    await a.load();
    a.putNote({ id: 'n1', title: 'Geheim', folderId: 'pf', created: 1, updated: 1 });
    await a.flushNow();

    const other = new Session('pf', generateFolderKey(), carrier);
    await other.load();
    expect(other.container.getMap('notes').size).toBe(0);
  });
});

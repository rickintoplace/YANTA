import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { bootApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

// Pretend every remote object was written `ms` ago (compaction applies
// safety delays based on the stored timestamps).
function ageRemote(remote, ms) {
  for (const rec of remote.objects.values()) {
    rec.updated -= ms;
  }
}

describe('cloud compaction', () => {
  it('never deletes another device\'s pack that no head contains', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();

    const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });
    await a.createNote({ id: 'base', title: 'Base' }, 'written on A');
    await a.sync();

    const b = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' });
    await b.sync();

    /*
      B types into the note and uploads the update pack, then its sync
      dies before it gets to upload its head (tab closed, offline, quota).
    */
    const before = new Set(remote.paths());
    b.activate();
    b.yjs.getNoteDoc('base').doc.getText('markdown').insert(0, 'typed on B\n');
    await b.createNote({ id: 'from-b', title: 'Only in a pack' });
    await b.engine.withSyncLock(() => b.engine.uploadOutbox());

    const bPacks = remote.paths().filter((p) => !before.has(p));
    expect(bPacks.some((p) => p.includes('/docs/'))).toBe(true);
    expect(bPacks.some((p) => p.includes('/vault/'))).toBe(true);

    // Hold B's packs back so they land between A's pull and A's head upload.
    const stash = new Map(bPacks.map((p) => [p, remote.objects.get(p)]));
    for (const p of bPacks) remote.objects.delete(p);

    ageRemote(remote, 10 * 60 * 1000);

    const putOriginal = remote.put.bind(remote);
    remote.put = async (path, data, options) => {
      if (stash.size && String(path).includes('/heads/')) {
        for (const [p, rec] of stash) {
          remote.objects.set(p, { ...rec, updated: Date.now() - 10 * 60 * 1000 });
        }
        stash.clear();
      }
      return putOriginal(path, data, options);
    };

    await a.compact();
    remote.put = putOriginal;

    // No head contains B's packs, so none of them may be gone.
    for (const p of bPacks) {
      expect(remote.objects.has(p), p).toBe(true);
    }

    const c = await bootApp(createOrigin('C'), { remote, syncKey, deviceId: 'dev-c' });
    await c.sync();

    const md = c.yjs.noteMarkdown('base');
    expect(md).toContain('written on A');
    expect(md).toContain('typed on B');
  });

  it('still prunes the journal this device has applied, and others converge', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();

    const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });

    for (let i = 1; i <= 5; i++) {
      await a.createNote({ id: `n${i}`, title: `Note ${i}` }, `body ${i}`);
      await a.engine.withSyncLock(() => a.engine.uploadOutbox());
    }

    const packsBefore = remote.paths().filter((p) => p.includes('/updates/')).length;
    expect(packsBefore).toBeGreaterThan(0);

    ageRemote(remote, 10 * 60 * 1000);
    await a.compact();

    const packsAfter = remote.paths().filter((p) => p.includes('/updates/')).length;
    expect(packsAfter).toBeLessThan(packsBefore);

    const c = await bootApp(createOrigin('C'), { remote, syncKey, deviceId: 'dev-c' });
    await c.sync();

    for (let i = 1; i <= 5; i++) {
      expect(c.core.state.notes.get(`n${i}`)?.title).toBe(`Note ${i}`);
      expect(c.yjs.noteMarkdown(`n${i}`)).toBe(`body ${i}`);
    }
  });

  it('removes the journal and heads of permanently deleted notes', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();

    const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });
    await a.createNote({ id: 'doomed', title: 'Doomed' }, 'some body');
    await a.sync();

    const { docUpdatesPrefix, docHeadsPrefix } = await import(resolve(__dirname, '../../src/sync2/ids.js'));
    const updatesPrefix = await docUpdatesPrefix(a.engine.keys.nameKey, 'doomed');
    const headsPrefix = await docHeadsPrefix(a.engine.keys.nameKey, 'doomed');

    expect(remote.paths(headsPrefix).length).toBeGreaterThan(0);

    a.activate();
    a.core.state.notes.delete('doomed');
    await a.core.store.notes.del('doomed');
    await a.sync();

    ageRemote(remote, 10 * 60 * 1000);
    await a.compact();

    expect(remote.paths(updatesPrefix)).toEqual([]);
    expect(remote.paths(headsPrefix)).toEqual([]);
  });
});

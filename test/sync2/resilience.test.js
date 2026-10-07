import { describe, it, expect } from 'vitest';
import { bootApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

async function setup() {
  const remote = new IndexedMemoryObjectStore();
  const syncKey = await newSyncKey();

  const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });
  await a.createNote({ id: 'n1', title: 'Hello' }, 'body');
  await a.sync();

  return { remote, syncKey, a };
}

describe('sync resilience', () => {
  it('an object pruned between listing and download does not abort the sync', async () => {
    const { remote, syncKey } = await setup();

    // The index still lists an object another device already deleted.
    const phantom = 'yanta-sync-v1/vault/updates/dev-x-00000007.ypack.enc';
    const indexOriginal = remote.index.bind(remote);
    remote.index = async () => [
      ...(await indexOriginal()),
      { path: phantom, size: 10, updated: Date.now(), etag: 'x' },
    ];

    const b = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' });
    await expect(b.sync()).resolves.toBeTruthy();

    expect(b.core.state.notes.get('n1')?.title).toBe('Hello');
    expect(b.yjs.noteMarkdown('n1')).toBe('body');
    expect(await b.engine.hasSeen(phantom)).toBe(false);
  });

  it('one unreadable object does not stall every later sync', async () => {
    const { remote, syncKey, a } = await setup();

    const garbage = new TextEncoder().encode('{"v":1,"alg":"AES-GCM","iv":"AAAA","ct":"AAAA"}');
    const badVault = 'yanta-sync-v1/vault/updates/dev-x-00000001.ypack.enc';
    const badHead = 'yanta-sync-v1/vault/heads/dev-x.yhead.enc';
    await remote.put(badVault, garbage);
    await remote.put(badHead, new TextEncoder().encode('truncated'));

    const b = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' });
    await expect(b.sync()).resolves.toBeTruthy();
    expect(b.core.state.notes.get('n1')?.title).toBe('Hello');

    // Later changes keep flowing.
    await a.updateNote('n1', { title: 'Renamed' });
    await a.sync();
    await expect(b.sync()).resolves.toBeTruthy();
    expect(b.core.state.notes.get('n1')?.title).toBe('Renamed');

    // Never marked seen: nothing was applied, so nothing may prune it as covered.
    expect(await b.engine.hasSeen(badVault)).toBe(false);
  });

  it('forgets seen objects other devices have deleted', async () => {
    const { remote, syncKey, a } = await setup();
    const b = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' });

    for (let i = 0; i < 5; i++) {
      await a.updateNote('n1', { title: `T${i}` });
      await a.engine.withSyncLock(() => a.engine.uploadOutbox());
      await b.sync();   // B sees A's pack…
      await a.sync();   // …then A's head covers it and A prunes it.
    }

    await b.sync();

    b.activate();
    const seen = await b.engine.localState.listSeen();
    const present = new Set(remote.paths());
    const stale = seen.filter((r) => r.path.includes('/updates/') && !present.has(r.path));

    expect(stale).toEqual([]);
  });
});

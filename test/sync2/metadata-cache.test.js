import { describe, it, expect } from 'vitest';
import { bootApp, restartApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

async function twoDevices() {
  const remote = new IndexedMemoryObjectStore();
  const syncKey = await newSyncKey();

  const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });
  const b = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' });

  return { remote, syncKey, a, b };
}

describe('vault metadata → local cache', () => {
  it('writes pulled metadata into the local cache, not only into memory', async () => {
    const { a, b } = await twoDevices();

    await a.createNote({ id: 'n1', title: 'Hello' });
    await a.sync();
    await b.sync();

    expect(b.core.state.notes.get('n1')?.title).toBe('Hello');
    expect((await b.cachedNote('n1'))?.title).toBe('Hello');
  });

  it('a remote rename survives a restart of the receiving device', async () => {
    const { a, b } = await twoDevices();

    await a.createNote({ id: 'n1', title: 'Old' });
    await a.sync();
    await b.sync();

    await a.updateNote('n1', { title: 'New' });
    await a.sync();
    await b.sync();

    expect(b.core.state.notes.get('n1')?.title).toBe('New');

    const b2 = await restartApp(b);

    expect(b2.core.state.notes.get('n1')?.title).toBe('New');
    expect(b2.vaultNote('n1')?.title).toBe('New');

    // …and B must not push the stale title back to A.
    await b2.sync();
    a.activate();
    await a.sync();
    expect(a.core.state.notes.get('n1')?.title).toBe('New');
  });

  it('a remote trash survives a restart of the receiving device', async () => {
    const { a, b } = await twoDevices();

    await a.createNote({ id: 'n1', title: 'Doomed' });
    await a.sync();
    await b.sync();

    await a.updateNote('n1', { trashed: true, deletedAt: Date.now() });
    await a.sync();
    await b.sync();

    const b2 = await restartApp(b);

    expect(b2.core.state.notes.get('n1')?.trashed).toBe(true);
    expect(b2.vaultNote('n1')?.trashed).toBe(true);
  });

  it('a stale cache entry never clears a tombstone at boot', async () => {
    const { a, b } = await twoDevices();

    await a.createNote({ id: 'n1', title: 'Gone' });
    await a.sync();
    await b.sync();

    // Permanent delete on A → tombstone.
    a.activate();
    a.core.state.notes.delete('n1');
    await a.core.store.notes.del('n1');
    await a.sync();

    /*
      B applies the tombstone to its VaultDoc, but the run stops before the
      cache refresh (crash, closed tab): simulate by pulling vault updates
      only, then restarting with the note still in the cache.
    */
    b.activate();
    b.engine.clearRemoteIndex();
    await b.heads.downloadVaultHeads(b.engine);
    await b.engine.downloadVaultUpdates();
    expect(b.isTombstoned('n1')).toBe(true);
    expect(await b.cachedNote('n1')).toBeTruthy();

    const b2 = await restartApp(b);

    expect(b2.isTombstoned('n1')).toBe(true);
    expect(b2.core.state.notes.has('n1')).toBe(false);
    expect(await b2.cachedNote('n1')).toBeFalsy();
  });

  it('keeps AI provenance through a restart', async () => {
    const { a, b } = await twoDevices();

    await a.createNote({ id: 'n1', title: 'Digest', aiGenerated: true, aiSource: 'pulse' });
    await a.sync();
    await b.sync();

    const b2 = await restartApp(b);

    expect(b2.vaultNote('n1')?.aiGenerated).toBe(true);
    expect(b2.core.state.notes.get('n1')?.aiGenerated).toBe(true);
  });

  it('alternating renames on two devices always converge on the newest title', async () => {
    // Each round is a coin flip under the fresh-doc LWW race, so ten
    // rounds make an unguarded merge fail with ~99.9% probability.
    const { a, b } = await twoDevices();

    await a.createNote({ id: 'n1', title: 'v0' });
    await a.sync();
    await b.sync();

    for (let round = 1; round <= 10; round++) {
      const [writer, reader] = round % 2 ? [a, b] : [b, a];
      const title = `v${round}`;

      await writer.updateNote('n1', { title });
      await writer.sync();
      await reader.sync();

      expect(reader.core.state.notes.get('n1')?.title, `round ${round}`).toBe(title);
      expect((await reader.cachedNote('n1'))?.title, `round ${round}`).toBe(title);
    }
  });
});

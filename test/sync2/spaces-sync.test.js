import { describe, it, expect } from 'vitest';
import { bootApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

describe('shared-space records in the vault', () => {
  it('a new space record reaches the other devices', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();

    const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });
    await a.createNote({ id: 'n1', title: 'Hello' });
    await a.sync();

    const b = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' });
    await b.sync();

    // A shares a folder: only the spaces map changes.
    a.activate();
    await a.core.store.spaces.put({ spaceId: 'sp-1', rootKey: 'k-123', role: 'owner', updated: Date.now() });
    await a.sync();

    await b.sync();
    expect(b.vaultDoc.vaultSpacesMap().get('sp-1')?.rootKey).toBe('k-123');
  });
});

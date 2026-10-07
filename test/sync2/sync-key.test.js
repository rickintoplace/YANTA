import { describe, it, expect } from 'vitest';
import { bootApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

const KEYCHECK = 'yanta-sync-v1/keycheck.enc';

describe('sync key check', () => {
  it('rejects a different key for an existing vault', async () => {
    const remote = new IndexedMemoryObjectStore();
    await bootApp(createOrigin('A'), { remote, syncKey: await newSyncKey(), deviceId: 'dev-a' });

    await expect(
      bootApp(createOrigin('B'), { remote, syncKey: await newSyncKey(), deviceId: 'dev-b' })
    ).rejects.toMatchObject({ code: 'EWRONGKEY' });
  });

  it('does not report a failed download as a wrong key', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();
    await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });

    const getOriginal = remote.get.bind(remote);
    remote.get = async (path) => {
      if (path === KEYCHECK) throw Object.assign(new Error('Failed to fetch'), { status: 503 });
      return getOriginal(path);
    };

    const err = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' })
      .then(() => null, (e) => e);

    expect(err).toBeTruthy();
    expect(err.code).not.toBe('EWRONGKEY');
  });

  it('still verifies the key when another device created the key check first', async () => {
    const remote = new IndexedMemoryObjectStore();
    await bootApp(createOrigin('A'), { remote, syncKey: await newSyncKey(), deviceId: 'dev-a' });

    // B's read races A's create: the key check looks absent at first.
    const getOriginal = remote.get.bind(remote);
    let hidden = true;
    remote.get = async (path) => {
      if (path === KEYCHECK && hidden) {
        hidden = false;
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
      return getOriginal(path);
    };

    await expect(
      bootApp(createOrigin('B'), { remote, syncKey: await newSyncKey(), deviceId: 'dev-b' })
    ).rejects.toMatchObject({ code: 'EWRONGKEY' });
  });

  it('keeps the replaced key when a new one is stored', async () => {
    const remote = new IndexedMemoryObjectStore();
    const first = await newSyncKey();
    const a = await bootApp(createOrigin('A'), { remote, syncKey: first, deviceId: 'dev-a' });

    a.activate();
    await a.engineMod.setSync2SyncKey(first);
    const second = await newSyncKey();
    await a.engineMod.setSync2SyncKey(second);

    const previous = await a.core.store.settings.get('sync2.syncKey.previous', null);
    expect(previous?.syncKey).toBe(first);
    expect(await a.engineMod.hasDifferentStoredSync2SyncKey(first)).toBe(true);
    expect(await a.engineMod.hasDifferentStoredSync2SyncKey(second)).toBe(false);
  });
});

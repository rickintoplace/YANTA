import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { bootApp, restartApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

// Grow the VaultDoc history well past the local compaction threshold.
// Two clients overwriting one key in turn (as device presence did) leave
// struct history Yjs cannot merge. Built in scratch docs and applied as
// ONE update: y-indexeddb writes each update separately, and tens of
// thousands of fake-IndexedDB writes take minutes.
function bloat(app) {
  app.activate();

  const a = new Y.Doc({ gc: true });
  const b = new Y.Doc({ gc: true });

  for (let i = 0; i < 20000; i++) {
    const [writer, reader] = i % 2 ? [a, b] : [b, a];
    const sv = Y.encodeStateVector(reader);
    const devices = writer.getMap('devices');

    writer.transact(() => {
      for (let k = 0; k < 4; k++) devices.set(`churn-${k}`, { i, lastSeenAt: i });
    });

    Y.applyUpdate(reader, Y.encodeStateAsUpdate(writer, sv));
  }

  Y.applyUpdate(app.vaultDoc.getVaultDoc(), Y.encodeStateAsUpdate(a), 'test-churn');
  a.destroy();
  b.destroy();
}

function encodedSize(app) {
  return Y.encodeStateAsUpdate(app.vaultDoc.getVaultDoc()).length;
}

describe('local VaultDoc compaction at boot', () => {
  it('compacts a bloated history and keeps every live value', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();

    const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });
    await a.createNote({ id: 'n1', title: 'Keep me' });
    a.vaultDoc.vaultSpacesMap().set('space-1', { spaceId: 'space-1', rootKey: 'secret', updated: 1 });
    bloat(a);

    const before = encodedSize(a);
    expect(before).toBeGreaterThan(512 * 1024);

    const a2 = await restartApp(a);

    expect(encodedSize(a2)).toBeLessThan(before / 4);
    expect(a2.vaultNote('n1')?.title).toBe('Keep me');
    expect(a2.vaultDoc.vaultSpacesMap().get('space-1')?.rootKey).toBe('secret');

    // The compacted store keeps working across another restart.
    await a2.updateNote('n1', { title: 'Still here' });
    const a3 = await restartApp(a2);
    expect(a3.vaultNote('n1')?.title).toBe('Still here');
  });

  it('leaves the history alone while another tab has the VaultDoc open', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();
    const origin = createOrigin('A');

    const tab1 = await bootApp(origin, { remote, syncKey, deviceId: 'dev-a' });
    await tab1.createNote({ id: 'n1', title: 'Base' });
    bloat(tab1);

    // A second tab boots while tab1 stays open…
    const tab2 = await bootApp(origin, { remote, syncKey, deviceId: 'dev-a' });
    expect(encodedSize(tab2)).toBeGreaterThan(512 * 1024);

    // …and tab1's later writes still persist.
    await tab1.createNote({ id: 'n2', title: 'Written after tab 2 booted' });
    await new Promise((r) => setTimeout(r, 30));

    const tab3 = await bootApp(origin, { remote, syncKey, deviceId: 'dev-a' });
    expect(tab3.vaultNote('n2')?.title).toBe('Written after tab 2 booted');
  });
});

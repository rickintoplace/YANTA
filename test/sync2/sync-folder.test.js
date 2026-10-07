import { describe, it, expect } from 'vitest';
import { bootApp, restartApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';
import { FakeDirectoryHandle } from './fake-fs.js';

/*
  Device B mirrors its notes into a local sync folder (Syncthing/Dropbox)
  and also syncs through sync2. The folder copy must never override what
  sync2 delivered.
*/
async function setup() {
  const remote = new IndexedMemoryObjectStore();
  const syncKey = await newSyncKey();
  const folder = new FakeDirectoryHandle('YANTA');

  const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });
  await a.createNote({ id: 'n1', title: 'Old' }, 'body of n1');
  await a.sync();

  const b = await bootApp(createOrigin('B'), {
    remote, syncKey, deviceId: 'dev-b', modules: ['sync.js'],
  });
  await b.sync();

  const folderSync = b.mods['sync.js'];
  folderSync.sync.handle = folder;
  await folderSync.syncFull(false);

  return { remote, syncKey, folder, a, b };
}

async function newSession(app, folder) {
  const next = await restartApp(app);
  next.mods['sync.js'].sync.handle = folder;
  return next;
}

describe('sync folder next to sync2', () => {
  it('mirrors note bodies, even for docs not loaded yet', async () => {
    const { folder, b } = await setup();

    const files = await folder.findFiles('notes');
    expect(files).toHaveLength(1);
    expect(await folder.readText(`notes/${files[0].name}`)).toContain('body of n1');

    // Fresh session: the note doc is not loaded when the mirror is written.
    const b2 = await newSession(b, folder);
    await b2.mods['sync.js'].syncWriteNote(b2.core.state.notes.get('n1'));

    expect(await folder.readText(`notes/${files[0].name}`)).toContain('body of n1');
  });

  it('a stale mirror file does not revert a rename that arrived through sync2', async () => {
    const { folder, a, b } = await setup();

    await a.updateNote('n1', { title: 'New' });
    await a.sync();
    await b.sync();
    expect(b.core.state.notes.get('n1')?.title).toBe('New');

    const b2 = await newSession(b, folder);
    await b2.mods['sync.js'].syncFull(false);

    expect(b2.core.state.notes.get('n1')?.title).toBe('New');
    expect(b2.vaultNote('n1')?.title).toBe('New');
  });

  it('a stale mirror file does not resurrect a note deleted through sync2', async () => {
    const { folder, a, b } = await setup();

    a.activate();
    a.core.state.notes.delete('n1');
    await a.core.store.notes.del('n1');
    await a.sync();

    await b.sync();
    expect(b.core.state.notes.has('n1')).toBe(false);

    const b2 = await newSession(b, folder);
    await b2.mods['sync.js'].syncFull(false);

    expect(b2.core.state.notes.has('n1')).toBe(false);
    expect(b2.isTombstoned('n1')).toBe(true);
  });
});

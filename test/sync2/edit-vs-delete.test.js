import { describe, it, expect } from 'vitest';
import { bootApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

/*
  Policy: a permanent delete is final. Writes that merely touch a deleted
  note's metadata never bring it back; work done on a device after the
  delete is rescued into a new note instead of being lost.
*/
async function setup() {
  const remote = new IndexedMemoryObjectStore();
  const syncKey = await newSyncKey();

  const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });
  await a.createNote({ id: 'n1', title: 'Shared note' }, 'original body');
  await a.sync();

  const b = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' });
  await b.sync();

  return { remote, syncKey, a, b };
}

async function permanentlyDelete(app, id) {
  app.activate();
  app.core.state.notes.delete(id);
  await app.core.store.notes.del(id);
}

const titles = (app) => [...app.core.state.notes.values()].map((n) => n.title).sort();

describe('edit vs. delete', () => {
  it('a stray metadata write does not resurrect a deleted note', async () => {
    const { a, b } = await setup();

    await permanentlyDelete(a, 'n1');
    await a.sync();

    // B still holds the note in memory and writes metadata (pin, layout…)
    // before it has pulled the delete.
    b.activate();
    const stale = { ...b.core.state.notes.get('n1'), pinned: true };
    await b.sync();
    await b.core.store.notes.put(stale);
    await b.sync();

    await a.sync();

    expect(a.isTombstoned('n1')).toBe(true);
    expect(a.core.state.notes.has('n1')).toBe(false);
    expect(b.isTombstoned('n1')).toBe(true);
    expect(b.core.state.notes.has('n1')).toBe(false);
  });

  it('work done after the delete is rescued into a new note on every device', async () => {
    const { a, b } = await setup();

    await permanentlyDelete(a, 'n1');
    await a.sync();

    // B, not yet aware of the delete, keeps writing.
    await new Promise((r) => setTimeout(r, 5));
    b.activate();
    b.yjs.getNoteDoc('n1').doc.getText('markdown').insert(0, 'typed on B after the delete\n');
    await b.updateNote('n1', {});

    await b.sync();
    await a.sync();

    for (const app of [a, b]) {
      expect(app.core.state.notes.has('n1')).toBe(false);

      const rescued = [...app.core.state.notes.values()].find((n) => n.title === 'Shared note (recovered)');
      expect(rescued, `rescued note on ${app.deviceId}`).toBeTruthy();

      const md = app.yjs.noteMarkdown(rescued.id);
      expect(md).toContain('typed on B after the delete');
      expect(md).toContain('original body');
    }
  });

  it('an idle device just lets the note go', async () => {
    const { a, b } = await setup();

    await new Promise((r) => setTimeout(r, 5));
    await permanentlyDelete(a, 'n1');
    await a.sync();
    await b.sync();

    expect(titles(b)).not.toContain('Shared note (recovered)');
    expect(b.core.state.notes.has('n1')).toBe(false);
  });

  it('re-importing a backup brings a deleted note back, as a new note', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();

    const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a', modules: ['io.js'] });
    await a.createNote({ id: 'n1', title: 'Shared note' }, 'original body');
    await a.sync();

    const b = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' });
    await b.sync();

    await permanentlyDelete(a, 'n1');
    await a.sync();

    const bundle = {
      yanta: 1,
      folders: [],
      notes: [{ id: 'n1', title: 'Shared note', type: 'markdown', tags: [], created: 1, updated: 2, body: 'from the backup' }],
      images: [],
    };

    a.activate();
    await a.mods['io.js'].importBundleFile({ text: async () => JSON.stringify(bundle) });
    await a.sync();
    await b.sync();

    for (const app of [a, b]) {
      expect(app.isTombstoned('n1')).toBe(true);

      const restored = [...app.core.state.notes.values()].find((n) => n.title === 'Shared note');
      expect(restored, `restored on ${app.deviceId}`).toBeTruthy();
      expect(restored.id).not.toBe('n1');
      expect(app.yjs.noteMarkdown(restored.id)).toBe('from the backup');
    }
  });
});

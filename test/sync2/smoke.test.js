import { describe, it, expect } from 'vitest';
import { bootApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

describe('sync2 harness', () => {
  it('syncs a note and its body from one device to another', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();

    const a = await bootApp(createOrigin('A'), { remote, syncKey, deviceId: 'dev-a' });
    await a.createNote({ id: 'n1', title: 'Hello' }, 'body from A');
    await a.sync();

    const b = await bootApp(createOrigin('B'), { remote, syncKey, deviceId: 'dev-b' });
    await b.sync();

    expect(b.core.state.notes.get('n1')?.title).toBe('Hello');
    expect(b.yjs.noteMarkdown('n1')).toBe('body from A');
  });
});

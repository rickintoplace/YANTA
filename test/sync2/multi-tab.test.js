import { describe, it, expect } from 'vitest';
import { bootApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

/*
  Two tabs (or a tab plus the installed PWA window) of one origin share
  IndexedDB — device id, seq, seen-state — but each holds its own
  in-memory VaultDoc and outbox.
*/
async function setup() {
  const remote = new IndexedMemoryObjectStore();
  const syncKey = await newSyncKey();
  const origin = createOrigin('laptop');

  const tab1 = await bootApp(origin, { remote, syncKey, deviceId: 'dev-laptop' });
  await tab1.sync();

  const tab2 = await bootApp(origin, { remote, syncKey, deviceId: 'dev-laptop' });
  await tab2.sync();

  return { remote, syncKey, origin, tab1, tab2 };
}

async function freshDevice(remote, syncKey) {
  const other = await bootApp(createOrigin('phone'), { remote, syncKey, deviceId: 'dev-phone' });
  await other.sync();
  return other;
}

describe('two tabs of one origin', () => {
  it('edits from both tabs reach another device (sequential syncs)', async () => {
    const { remote, syncKey, tab1, tab2 } = await setup();

    await tab1.createNote({ id: 'from-tab1', title: 'Tab 1' });
    await tab2.createNote({ id: 'from-tab2', title: 'Tab 2' });

    await tab1.sync();
    await tab2.sync();

    const phone = await freshDevice(remote, syncKey);

    expect(phone.core.state.notes.get('from-tab1')?.title).toBe('Tab 1');
    expect(phone.core.state.notes.get('from-tab2')?.title).toBe('Tab 2');
  });

  it('edits from both tabs reach another device (concurrent syncs)', async () => {
    const { remote, syncKey, tab1, tab2 } = await setup();

    await tab1.createNote({ id: 'from-tab1', title: 'Tab 1' });
    await tab2.createNote({ id: 'from-tab2', title: 'Tab 2' });

    await Promise.all([tab1.sync(), tab2.sync()]);

    const phone = await freshDevice(remote, syncKey);

    expect(phone.core.state.notes.get('from-tab1')?.title).toBe('Tab 1');
    expect(phone.core.state.notes.get('from-tab2')?.title).toBe('Tab 2');
  });

  it('note bodies typed in both tabs reach another device', async () => {
    const { remote, syncKey, tab1, tab2 } = await setup();

    await tab1.createNote({ id: 'shared', title: 'Shared' }, 'line from tab 1');
    await tab1.sync();
    await tab2.sync();

    // tab2 loads the note and types; tab1 keeps typing too.
    tab2.activate();
    const doc2 = tab2.yjs.getNoteDoc('shared');
    await doc2.ready;
    await tab2.engine.observeNote('shared');
    doc2.doc.getText('markdown').insert(0, 'tab 2 says hi\n');

    tab1.activate();
    tab1.yjs.getNoteDoc('shared').doc.getText('markdown').insert(0, 'tab 1 again\n');

    await tab1.sync();
    await tab2.sync();

    const phone = await freshDevice(remote, syncKey);
    const md = phone.yjs.noteMarkdown('shared');

    expect(md).toContain('line from tab 1');
    expect(md).toContain('tab 1 again');
    expect(md).toContain('tab 2 says hi');
  });

  it('alternating edits and syncs in both tabs all reach another device', async () => {
    const { remote, syncKey, tab1, tab2 } = await setup();

    for (let i = 1; i <= 6; i++) {
      const tab = i % 2 ? tab1 : tab2;
      await tab.createNote({ id: `n${i}`, title: `Note ${i}` });
      await tab.sync();
    }

    const phone = await freshDevice(remote, syncKey);

    for (let i = 1; i <= 6; i++) {
      expect(phone.core.state.notes.get(`n${i}`)?.title, `n${i}`).toBe(`Note ${i}`);
    }
  });
});

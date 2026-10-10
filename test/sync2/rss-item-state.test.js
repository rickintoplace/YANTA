import { describe, it, expect } from 'vitest';
import { bootApp, createOrigin, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

const MODULES = ['rss/rss-store.js', 'rss/rss-item-sync.js'];

const article = (id, extra = {}) => ({
  id,
  feedId: 'feed-1',
  title: `Article ${id}`,
  url: `https://example.org/${id}`,
  publishedAt: Date.now(),
  read: false,
  ...extra,
});

async function fetchArticles(app, items) {
  app.activate();
  await app.mods['rss/rss-store.js'].upsertRssItems(items);
}

async function item(app, id) {
  app.activate();
  return app.mods['rss/rss-store.js'].getRssItem(id);
}

describe('article state across devices', () => {
  it('read, starred and saved on one device show up on the other', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();

    const a = await bootApp(createOrigin('RA'), { remote, syncKey, deviceId: 'dev-ra', modules: MODULES });
    await a.sync();
    const b = await bootApp(createOrigin('RB'), { remote, syncKey, deviceId: 'dev-rb', modules: MODULES });
    await b.sync();

    // Both devices fetched the same feed: same item ids.
    await fetchArticles(a, [article('i1'), article('i2'), article('i3')]);
    await fetchArticles(b, [article('i1'), article('i2'), article('i3')]);

    a.activate();
    const store = a.mods['rss/rss-store.js'];
    const sync = a.mods['rss/rss-item-sync.js'];
    await sync.publishRssItemState(await store.patchRssItem('i1', { read: true }));
    await sync.publishRssItemState(await store.patchRssItem('i2', { starred: true }));
    await sync.publishRssItemState(await store.patchRssItem('i3', { read: true, savedNoteId: 'note-9' }));
    await a.sync();

    await b.sync();
    b.activate();
    const changed = await b.mods['rss/rss-item-sync.js'].applyRssItemStateFromVault();

    expect(changed).toBe(3);
    expect(await item(b, 'i1')).toMatchObject({ read: true });
    expect(await item(b, 'i2')).toMatchObject({ starred: true, read: false });
    expect(await item(b, 'i3')).toMatchObject({ read: true, savedNoteId: 'note-9' });
  });

  it('an article fetched later arrives already read, and the newer change wins', async () => {
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();

    const a = await bootApp(createOrigin('RC'), { remote, syncKey, deviceId: 'dev-rc', modules: MODULES });
    await a.sync();
    const b = await bootApp(createOrigin('RD'), { remote, syncKey, deviceId: 'dev-rd', modules: MODULES });
    await b.sync();

    await fetchArticles(a, [article('j1')]);
    a.activate();
    await a.mods['rss/rss-item-sync.js'].publishRssItemState(
      await a.mods['rss/rss-store.js'].patchRssItem('j1', { read: true })
    );
    await a.sync();
    await b.sync();

    // B fetches the article only now.
    await fetchArticles(b, [article('j1')]);
    b.activate();
    await b.mods['rss/rss-item-sync.js'].applyRssItemStateFromVault();
    expect(await item(b, 'j1')).toMatchObject({ read: true });

    // B marks it unread again afterwards; that is the newer statement.
    await new Promise((r) => setTimeout(r, 5));
    b.activate();
    await b.mods['rss/rss-item-sync.js'].publishRssItemState(
      await b.mods['rss/rss-store.js'].patchRssItem('j1', { read: false })
    );
    await b.sync();
    await a.sync();

    a.activate();
    await a.mods['rss/rss-item-sync.js'].applyRssItemStateFromVault();
    expect(await item(a, 'j1')).toMatchObject({ read: false });

    // And applying again changes nothing.
    expect(await a.mods['rss/rss-item-sync.js'].applyRssItemStateFromVault()).toBe(0);
  });
});

// ============================================================
// YANTA Sources / RSS — app actions
// ============================================================

import {
    uid,
    state,
    store,
    toast,
  } from '../core.js';
  
  import {
    getNoteDoc,
  } from '../yjs.js';
  
  import {
    renderTree,
  } from '../tree.js';
  
  import {
    getRssFeeds,
    upsertRssFeed,
    saveRssFeeds,
    getRssSettings,
  } from './rss-settings.js';
  
  import {
    parseFeed,
  } from './rss-parser.js';
  
  import {
    discoverRssFeeds,
    fetchRssFeed,
  } from './rss-fetcher.js';
  
  import {
    getRssItem,
    upsertRssItems,
    patchRssItem,
    listRssItems,
    pruneRssItems,
  } from './rss-store.js';
  
  function now() {
    return Date.now();
  }
  
  function base64Url(bytes) {
    let bin = '';
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  
    for (let i = 0; i < u8.length; i++) {
      bin += String.fromCharCode(u8[i]);
    }
  
    return btoa(bin)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  
  async function hashString(text) {
    const bytes = new TextEncoder().encode(String(text || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return base64Url(new Uint8Array(digest)).slice(0, 32);
  }
  
  function isoDate(ms) {
    const t = Number(ms || 0);
    if (!t) return '';
    try {
      return new Date(t).toISOString();
    } catch {
      return '';
    }
  }
  
  function stripHtml(html = '') {
    const tmp = document.createElement('div');
    tmp.innerHTML = String(html || '');
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  }
  
  function itemMarkdown(item, feed) {
    const source = item.url
      ? `[${feed?.title || item.feedTitle || 'Source'}](${item.url})`
      : (feed?.title || item.feedTitle || 'Source');
  
    const published = item.publishedAt
      ? isoDate(item.publishedAt).slice(0, 10)
      : '';
  
    const lines = [
      `# ${item.title || 'Untitled'}`,
      '',
      `Source: ${source}`,
      published ? `Published: ${published}` : '',
      item.author ? `Author: ${item.author}` : '',
      '',
      '## Notes',
      '',
      '',
      '## Excerpt',
      '',
      item.summaryText || stripHtml(item.summaryHtml || item.contentHtml || '').slice(0, 2400),
      '',
      item.url ? `Original: ${item.url}` : '',
    ].filter((line) => line !== '');
  
    if (item.imageUrl) {
      lines.splice(6, 0, '', `![Article image](${item.imageUrl})`);
    }
  
    return lines.join('\n').trim() + '\n';
  }
  
  async function normalizeFetchedItems(feed, parsed) {
    const out = [];
  
    for (const raw of parsed.items || []) {
      const basis = [
        feed.id,
        raw.guid || raw.url || raw.title,
      ].join('|');
  
      const id = 'rssitem_' + await hashString(basis);
  
      out.push({
        id,
        feedId: feed.id,
        feedTitle: parsed.feed?.title || feed.title,
  
        guid: raw.guid || raw.url || id,
        url: raw.url || '',
        canonicalUrl: raw.canonicalUrl || raw.url || '',
  
        title: raw.title || 'Untitled',
        author: raw.author || '',
        publishedAt: raw.publishedAt || 0,
  
        summaryHtml: raw.summaryHtml || '',
        summaryText: raw.summaryText || '',
  
        contentHtml: raw.contentHtml || '',
        contentText: raw.contentText || '',
  
        imageUrl: raw.imageUrl || '',
  
        read: false,
        starred: false,
        archived: false,
        savedNoteId: null,
  
        discoveredAt: now(),
      });
    }
  
    return out;
  }
  
  export async function addRssFeedFromUrl(inputUrl, {
    folderId = null,
    tags = [],
  } = {}) {
    const candidates = await discoverRssFeeds(inputUrl);
    const first = candidates[0];
  
    if (!first) {
      throw new Error('No RSS/Atom/JSON feed found.');
    }
  
    await upsertRssFeed({
      title: first.title || first.feedUrl || inputUrl,
      feedUrl: first.feedUrl || first.url,
      siteUrl: first.siteUrl || '',
      description: first.description || '',
      folderId,
      tags,
      icon: 'rss',
      color: '#f59e0b',
    });
  
    const feeds = await getRssFeeds();
    const feed = feeds.find((f) => f.feedUrl === (first.feedUrl || first.url));
  
    if (feed) {
      await refreshRssFeed(feed.id, {
        force: true,
      });
    }
  
    return feed || null;
  }
  
  export async function refreshRssFeed(feedId, {
    force = false,
  } = {}) {
    const settings = await getRssSettings();
    const feeds = await getRssFeeds();
    const feed = feeds.find((f) => f.id === feedId);
  
    if (!feed) throw new Error('Feed not found.');
    if (!feed.enabled && !force) return { feedId, skipped: true };
  
    const minMs = Number(settings.minRefreshIntervalMinutes || 30) * 60000;
  
    if (!force && feed.lastFetchedAt && Date.now() - feed.lastFetchedAt < minMs) {
      return { feedId, skipped: true, reason: 'fresh' };
    }
  
    try {
      const fetched = await fetchRssFeed(feed);
  
      if (fetched.notModified) {
        feed.lastFetchedAt = now();
        feed.lastError = '';
        await saveRssFeeds(feeds);
        return { feedId, notModified: true, count: 0 };
      }
  
      const parsed = parseFeed(fetched.body, {
        url: fetched.finalUrl || feed.feedUrl,
      });
  
      feed.title = parsed.feed.title || feed.title;
      feed.description = parsed.feed.description || feed.description || '';
      feed.siteUrl = parsed.feed.siteUrl || feed.siteUrl || '';
      feed.feedUrl = fetched.finalUrl || feed.feedUrl;
      feed.etag = fetched.etag || '';
      feed.lastModified = fetched.lastModified || '';
      feed.lastFetchedAt = now();
      feed.lastError = '';
      feed.updated = now();
  
      const items = await normalizeFetchedItems(feed, parsed);
  
      await upsertRssItems(items);
      await saveRssFeeds(feeds);
  
      await pruneRssItems({
        maxItemsPerFeed: settings.maxItemsPerFeed,
        keepItemsDays: settings.keepItemsDays,
      });
  
      window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
        detail: {
          feedId,
          count: items.length,
        },
      }));
  
      return {
        feedId,
        count: items.length,
      };
    } catch (err) {
      feed.lastFetchedAt = now();
      feed.lastError = err?.message || String(err);
      feed.updated = now();
  
      await saveRssFeeds(feeds);
  
      window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
        detail: {
          feedId,
          error: feed.lastError,
        },
      }));
  
      throw err;
    }
  }
  
  export async function refreshAllRssFeeds({
    force = false,
  } = {}) {
    const feeds = await getRssFeeds();
    const out = [];
  
    for (const feed of feeds) {
      try {
        out.push(await refreshRssFeed(feed.id, { force }));
      } catch (err) {
        out.push({
          feedId: feed.id,
          error: err?.message || String(err),
        });
      }
    }
  
    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: {
        all: true,
      },
    }));
  
    return out;
  }
  
  export async function markRssItemRead(itemId, read = true) {
    const item = await patchRssItem(itemId, {
      read: !!read,
    });
  
    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: {
        itemId,
      },
    }));
  
    return item;
  }
  
  export async function toggleRssItemStar(itemId) {
    const item = await getRssItem(itemId);
    if (!item) throw new Error('RSS item not found.');
  
    const next = await patchRssItem(itemId, {
      starred: !item.starred,
    });
  
    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: {
        itemId,
      },
    }));
  
    return next;
  }
  
  export async function archiveRssItem(itemId, archived = true) {
    const item = await patchRssItem(itemId, {
      archived: !!archived,
      read: true,
    });
  
    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: {
        itemId,
      },
    }));
  
    return item;
  }
  
  export async function saveRssItemAsNote(itemId, {
    folderId = undefined,
  } = {}) {
    const item = await getRssItem(itemId);
    if (!item) throw new Error('RSS item not found.');
  
    const feeds = await getRssFeeds();
    const feed = feeds.find((f) => f.id === item.feedId);
  
    const id = uid();
  
    const note = {
      id,
      title: item.title || 'Article',
      type: 'markdown',
      folderId: folderId !== undefined ? folderId : (feed?.folderId || null),
      tags: [...new Set(['rss', ...(feed?.tags || [])])],
      pinned: false,
      icon: feed?.icon || 'rss',
      color: feed?.color || '#f59e0b',
      created: now(),
      updated: now(),
    };
  
    state.notes.set(id, note);
    await store.notes.put(note);
  
    const entry = getNoteDoc(id);
    await entry.ready;
  
    const body = itemMarkdown(item, feed);
    entry.doc.getText('markdown').insert(0, body);
  
    state.searchIndex.set(
      id,
      [
        note.title || '',
        (note.tags || []).join(' '),
        body,
      ].join(' ').toLowerCase()
    );
  
    await patchRssItem(itemId, {
      read: true,
      savedNoteId: id,
    });
  
    renderTree();
  
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: {
        noteId: id,
        reason: 'rss-save-as-note',
        source: 'rss',
      },
    }));
  
    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
      detail: {
        reason: 'rss-save-as-note',
        noteId: id,
      },
    }));
  
    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: {
        itemId,
        savedNoteId: id,
      },
    }));
  
    toast('Saved RSS item as note', 'success');
  
    return note;
  }
  
  export async function appendRssItemToCurrentNote(itemId) {
    if (!state.currentNoteId) {
      throw new Error('Open a note first.');
    }
  
    const item = await getRssItem(itemId);
    if (!item) throw new Error('RSS item not found.');
  
    const ytext = getNoteDoc(state.currentNoteId).doc.getText('markdown');
  
    const snippet = [
      '',
      `## ${item.title || 'Source item'}`,
      '',
      item.url ? `[Open original](${item.url})` : '',
      '',
      item.summaryText || stripHtml(item.summaryHtml || '').slice(0, 1200),
      '',
    ].filter((x) => x !== '').join('\n');
  
    const prefix = ytext.length > 0 && !ytext.toString().endsWith('\n')
      ? '\n\n'
      : '';
  
    ytext.insert(ytext.length, prefix + snippet);
  
    await patchRssItem(itemId, {
      read: true,
    });
  
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: {
        noteId: state.currentNoteId,
        reason: 'rss-append',
        source: 'rss',
      },
    }));
  
    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: {
        itemId,
      },
    }));
  
    toast('Added RSS item to current note', 'success');
  }
  
  // AI action wrappers
  
  export async function rssSearchItemsAction(args = {}) {
    const items = await listRssItems({
      query: args.query || '',
      unreadOnly: args.unreadOnly !== false,
      starredOnly: !!args.starredOnly,
      archived: !!args.includeArchived,
      since: args.since || '',
      limit: args.limit || 20,
    });
  
    return {
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        feedId: item.feedId,
        feedTitle: item.feedTitle,
        title: item.title,
        author: item.author,
        url: item.url,
        publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
        summary: item.summaryText || item.contentText?.slice(0, 800) || '',
        read: !!item.read,
        starred: !!item.starred,
        savedNoteId: item.savedNoteId || null,
      })),
    };
  }
  
  export async function rssReadItemAction({ itemId } = {}) {
    const item = await getRssItem(itemId);
    if (!item) throw new Error('RSS item not found.');
  
    return {
      id: item.id,
      feedId: item.feedId,
      feedTitle: item.feedTitle,
      title: item.title,
      author: item.author,
      url: item.url,
      publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
      summaryText: item.summaryText || '',
      contentText: item.contentText || '',
      read: !!item.read,
      starred: !!item.starred,
      savedNoteId: item.savedNoteId || null,
    };
  }
  
  export async function rssSaveItemAsNoteAction(args = {}) {
    return saveRssItemAsNote(args.itemId, {
      folderId: args.folderId,
    });
  }
  
  export async function rssMarkItemReadAction({ itemId, read = true } = {}) {
    return markRssItemRead(itemId, read);
  }
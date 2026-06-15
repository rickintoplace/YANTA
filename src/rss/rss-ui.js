// ============================================================
// YANTA Sources / RSS — native UI
// ============================================================

import DOMPurify from 'dompurify';

import {
  el,
  escapeHtml,
  lucide,
  toast,
  state,
} from '../core.js';

import {
  openSidePane,
} from '../side-pane.js';

import {
  openNote,
} from '../notes.js';

import {
  getRssSettings,
  getRssFeeds,
} from './rss-settings.js';

import {
  listRssItems,
  getRssItem,
} from './rss-store.js';

import {
  rssImageProxyUrl,
} from './rss-fetcher.js';

import {
  addRssFeedFromUrl,
  refreshAllRssFeeds,
  refreshRssFeed,
  markRssItemRead,
  toggleRssItemStar,
  archiveRssItem,
  saveRssItemAsNote,
  appendRssItemToCurrentNote,
} from './rss-actions.js';
import {
    cloudMe,
} from '../cloud/cloud-api.js';

let initialized = false;
let currentMode = 'unread';
let currentFeedId = '';
let root = null;

function fmtDate(ms) {
  if (!ms) return '';

  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';

  return d.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function sanitizeItemHtml(html = '') {
  return DOMPurify.sanitize(String(html || ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed'],
    ADD_ATTR: ['target', 'rel', 'loading', 'referrerpolicy'],
  });
}

async function imageSrc(url) {
  const settings = await getRssSettings();
  if (!settings.showImages || !url) return '';

  return rssImageProxyUrl(url);
}

function injectCss() {
  if (document.getElementById('yanta-rss-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-rss-css';
  style.textContent = `
.yanta-rss-root {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  color: var(--text);
}

.yanta-rss-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yanta-rss-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  overflow: auto;
}

.yanta-rss-tab {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.yanta-rss-tab.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev-2));
}

.yanta-rss-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}

.yanta-rss-item {
  width: 100%;
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  margin-bottom: 8px;
}

.yanta-rss-item:hover {
  border-color: var(--border-strong);
  background: var(--bg-elev-3);
}

.yanta-rss-item.read {
  opacity: 0.72;
}

.yanta-rss-thumb {
  width: 76px;
  height: 58px;
  border-radius: 9px;
  background: var(--bg);
  border: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
}

.yanta-rss-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.yanta-rss-item-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.yanta-rss-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--text);
  line-height: 1.3;
}

.yanta-rss-meta {
  font-size: 11px;
  color: var(--text-faint);
}

.yanta-rss-excerpt {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.42;
  overflow-wrap: anywhere;
}

.yanta-rss-actions {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 5px;
}

.yanta-rss-reader {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yanta-rss-reader-head {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
}

.yanta-rss-reader-head h3 {
  margin: 0 0 6px;
  font-size: 17px;
  line-height: 1.25;
}

.yanta-rss-reader-content {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.yanta-rss-reader-content img {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
}

.yanta-rss-add-row {
  display: flex;
  gap: 8px;
  padding: 10px;
}

.yanta-rss-add-row input {
  flex: 1;
}

@media (max-width: 640px) {
  .yanta-rss-item {
    grid-template-columns: 58px minmax(0, 1fr);
  }

  .yanta-rss-thumb {
    width: 58px;
    height: 48px;
  }
}
.yanta-rss-cloud-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  margin: 10px;
  padding: 11px 12px;

  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
  border-radius: 12px;

  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
  color: var(--text);
}

.yanta-rss-cloud-notice-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.yanta-rss-cloud-notice-main {
  flex: 1;
  min-width: 0;
}

.yanta-rss-cloud-notice-main strong {
  display: block;
  font-size: 13px;
  color: var(--text);
  margin-bottom: 3px;
}

.yanta-rss-cloud-notice-main p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-dim);
}

.yanta-rss-cloud-notice-main small {
  display: block;
  margin-top: 6px;
  color: var(--yellow);
  font-size: 11px;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .yanta-rss-cloud-notice {
    flex-direction: column;
  }

  .yanta-rss-cloud-notice .btn {
    width: 100%;
    justify-content: center;
  }
}
`;
  document.head.append(style);
}

async function renderItemCard(item) {
  const btn = el('button', {
    type: 'button',
    class: 'yanta-rss-item' + (item.read ? ' read' : ''),
  });

  btn.addEventListener('click', () => renderReader(item.id));

  const thumb = el('div', { class: 'yanta-rss-thumb' });
  const src = await imageSrc(item.imageUrl);

  if (src) {
    thumb.append(el('img', {
      src,
      alt: '',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
    }));
  } else {
    thumb.innerHTML = lucide('rss', 24);
  }

  const main = el('div', { class: 'yanta-rss-item-main' });

  main.append(
    el('div', { class: 'yanta-rss-title' }, item.title || 'Untitled'),
    el('div', { class: 'yanta-rss-meta' },
      [
        item.feedTitle || 'Source',
        item.author || '',
        fmtDate(item.publishedAt || item.discoveredAt),
      ].filter(Boolean).join(' · ')
    )
  );

  if (item.summaryText || item.contentText) {
    main.append(el('div', { class: 'yanta-rss-excerpt' },
      (item.summaryText || item.contentText || '').slice(0, 240)
    ));
  }

  const actions = el('div', { class: 'yanta-rss-actions' });

  const star = el('button', { class: 'btn', type: 'button' });
  star.innerHTML = `${lucide(item.starred ? 'star' : 'star', 13)} ${item.starred ? 'Starred' : 'Star'}`;
  star.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleRssItemStar(item.id);
    await renderInbox();
  });

  const save = el('button', { class: 'btn primary', type: 'button' });
  save.innerHTML = `${lucide('file-plus', 13)} Save`;
  save.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const note = await saveRssItemAsNote(item.id);
    if (note?.id) await openNote(note.id);
  });

  const archive = el('button', { class: 'btn', type: 'button' });
  archive.innerHTML = `${lucide('archive', 13)} Archive`;
  archive.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await archiveRssItem(item.id, true);
    await renderInbox();
  });

  actions.append(star, save, archive);
  main.append(actions);

  btn.append(thumb, main);

  return btn;
}

async function renderInbox() {
  if (!root) return;

  const body = root.querySelector('[data-rss-body]');
  if (!body) return;

  body.replaceChildren();

  const items = await listRssItems({
    feedId: currentFeedId,
    unreadOnly: currentMode === 'unread',
    starredOnly: currentMode === 'starred',
    archived: currentMode === 'archived',
    limit: 100,
  });

  if (!items.length) {
    body.append(el('div', { class: 'tree-empty' },
      currentMode === 'unread'
        ? 'No unread source items.'
        : 'No source items.'
    ));
    return;
  }

  for (const item of items) {
    body.append(await renderItemCard(item));
  }
}

async function renderReader(itemId) {
  if (!root) return;

  const body = root.querySelector('[data-rss-body]');
  if (!body) return;

  const item = await getRssItem(itemId);
  if (!item) return;

  await markRssItemRead(item.id, true);

  body.replaceChildren();

  const wrap = el('div', { class: 'yanta-rss-reader' });

  const head = el('div', { class: 'yanta-rss-reader-head' });

  head.innerHTML = `
    <h3>${escapeHtml(item.title || 'Untitled')}</h3>
    <div class="yanta-rss-meta">${escapeHtml([
      item.feedTitle || 'Source',
      item.author || '',
      fmtDate(item.publishedAt || item.discoveredAt),
    ].filter(Boolean).join(' · '))}</div>
  `;

  const actions = el('div', { class: 'compress-actions', style: { justifyContent: 'flex-start', flexWrap: 'wrap', marginTop: '10px' } });

  const back = el('button', { class: 'btn' });
  back.innerHTML = `${lucide('arrow-left', 14)} Back`;
  back.addEventListener('click', renderInbox);

  const original = el('a', {
    class: 'btn',
    href: item.url || '#',
    target: '_blank',
    rel: 'noopener noreferrer',
  });
  original.innerHTML = `${lucide('external-link', 14)} Original`;

  const save = el('button', { class: 'btn primary' });
  save.innerHTML = `${lucide('file-plus', 14)} Save as note`;
  save.addEventListener('click', async () => {
    const note = await saveRssItemAsNote(item.id);
    if (note?.id) await openNote(note.id);
  });

  const append = el('button', { class: 'btn' });
  append.innerHTML = `${lucide('list-plus', 14)} Append to current note`;
  append.addEventListener('click', async () => {
    try {
      await appendRssItemToCurrentNote(item.id);
    } catch (err) {
      toast(err?.message || 'Could not append item', 'error');
    }
  });

  actions.append(back, original, save, append);
  head.append(actions);

  wrap.append(head);

  const content = el('div', { class: 'yanta-rss-reader-content' });
  const html = item.contentHtml || item.summaryHtml || '';

  if (html) {
    content.innerHTML = sanitizeItemHtml(html);
  } else {
    content.textContent = item.contentText || item.summaryText || 'No preview content available.';
  }

  wrap.append(content);
  body.append(wrap);
}

async function rssCloudAuthState() {
    try {
      const me = await cloudMe();
  
      return {
        authenticated: !!me?.authenticated,
        me,
        error: '',
      };
    } catch (err) {
      return {
        authenticated: false,
        me: null,
        error: err?.message || String(err),
      };
    }
  }
  
  async function openYantaCloudLoginForSources() {
    try {
      const mod = await import('../sync2/yanta-cloud-setup-ui.js');
      await mod.openYantaCloudSetup();
    } catch (err) {
      console.error('[YANTA RSS] Could not open YANTA Cloud setup', err);
      toast('Could not open YANTA Cloud login', 'error');
    }
  }
  
  function renderRssCloudLoginNotice({
    error = '',
  } = {}) {
    const box = el('div', {
      class: 'yanta-rss-cloud-notice',
    });
  
    box.innerHTML = `
      <div class="yanta-rss-cloud-notice-icon">
        ${lucide('cloud', 20)}
      </div>
  
      <div class="yanta-rss-cloud-notice-main">
        <strong>Sign in to YANTA Cloud to use Sources</strong>
        <p>
          YANTA fetches RSS/Atom feeds through a privacy-protected cloud proxy.
          This avoids browser CORS problems, strips request credentials, and protects the proxy from abuse.
        </p>
        ${
          error
            ? `<small>${escapeHtml(error)}</small>`
            : ''
        }
      </div>
  
      <button class="btn primary" data-rss-cloud-login>
        ${lucide('log-in', 14)}
        Sign in
      </button>
    `;
  
    box.querySelector('[data-rss-cloud-login]')?.addEventListener('click', () => {
      openYantaCloudLoginForSources();
    });
  
    return box;
  }
  
async function renderShell() {
  injectCss();

  const body = openSidePane({
    kind: 'rss',
    title: 'Sources',
    icon: 'rss',
    className: 'yanta-rss-side-pane',
  });

  if (!body) return;

  body.innerHTML = '';
  root = el('div', { class: 'yanta-rss-root' });

  const toolbar = el('div', { class: 'yanta-rss-toolbar' });

  const addInput = el('input', {
    class: 'text-input',
    placeholder: 'Add website or feed URL…',
  });

  const addBtn = el('button', { class: 'btn primary' });
  addBtn.innerHTML = `${lucide('plus', 14)} Add`;

  addBtn.addEventListener('click', async () => {
    const url = addInput.value.trim();
    if (!url) return;

    addBtn.disabled = true;

    try {
      await addRssFeedFromUrl(url);
      addInput.value = '';
      toast('Source added', 'success');
      await renderShell();
    } catch (err) {
      toast(err?.message || 'Could not add source', 'error');
    } finally {
      addBtn.disabled = false;
    }
  });

  const refresh = el('button', { class: 'btn' });
  refresh.innerHTML = `${lucide('refresh-cw', 14)} Refresh`;
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;

    try {
      await refreshAllRssFeeds({ force: true });
      await renderInbox();
      toast('Sources refreshed', 'success');
    } catch (err) {
      toast(err?.message || 'Refresh failed', 'error');
    } finally {
      refresh.disabled = false;
    }
  });

  toolbar.append(addInput, addBtn, refresh);

  const tabs = el('div', { class: 'yanta-rss-tabs' });

  const feeds = await getRssFeeds();

  const settings = await getRssSettings();
  const cloudAuth = settings.fetchProvider === 'yanta-cloud'
    ? await rssCloudAuthState()
    : {
        authenticated: true,
        me: null,
        error: '',
      };

  const tabDefs = [
    { id: 'unread', label: 'Inbox' },
    { id: 'all', label: 'All' },
    { id: 'starred', label: 'Starred' },
    { id: 'archived', label: 'Archived' },
  ];

  for (const t of tabDefs) {
    const btn = el('button', {
      class: 'yanta-rss-tab' + (currentMode === t.id && !currentFeedId ? ' active' : ''),
    }, t.label);

    btn.addEventListener('click', async () => {
      currentMode = t.id;
      currentFeedId = '';
      await renderShell();
    });

    tabs.append(btn);
  }

  for (const feed of feeds) {
    const btn = el('button', {
      class: 'yanta-rss-tab' + (currentFeedId === feed.id ? ' active' : ''),
      title: feed.feedUrl,
    }, feed.title);

    btn.addEventListener('click', async () => {
      currentFeedId = feed.id;
      currentMode = 'all';

      try {
        await refreshRssFeed(feed.id);
      } catch {}

      await renderShell();
    });

    tabs.append(btn);
  }

  const listBody = el('div', {
    class: 'yanta-rss-body',
    dataset: {
      rssBody: '1',
    },
  });

  root.append(toolbar);

  if (settings.fetchProvider === 'yanta-cloud' && !cloudAuth.authenticated) {
    root.append(renderRssCloudLoginNotice({
      error: cloudAuth.error,
    }));
  
    addBtn.disabled = true;
    refresh.disabled = true;
    addInput.disabled = true;
    addInput.placeholder = 'Sign in to YANTA Cloud first…';
  }
  
  root.append(tabs, listBody);
  body.append(root);

  await renderInbox();
}

export async function openRssInbox() {
  await renderShell();
}

export function setupRss() {
  if (initialized) return;
  initialized = true;

  window.yantaRss = {
    open: openRssInbox,
    refreshAll: refreshAllRssFeeds,
  };

  window.addEventListener('yanta-open-rss', () => {
    openRssInbox().catch((err) => {
      console.error(err);
      toast('Could not open Sources', 'error');
    });
  });

  window.addEventListener('yanta-rss-updated', () => {
    if (root?.isConnected) {
      renderInbox().catch(() => {});
    }
  });

  // Startup refresh, cheap and interval-limited.
  window.setTimeout(async () => {
    try {
      const settings = await getRssSettings();
      if (settings.enabled && settings.refreshOnStartup) {
        await refreshAllRssFeeds({ force: false });
      }
    } catch {
      // silent
    }
  }, 3500);
}
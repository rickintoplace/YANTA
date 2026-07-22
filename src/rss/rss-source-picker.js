// ============================================================
// YANTA Sources / RSS — Universal source input dropdown + browser
// ============================================================

import {
  el,
  escapeHtml,
  escapeAttr,
  lucide,
  toast,
} from '../core.js';

import {
  addRssFeedFromUniversalInput,
  addRssFeedCandidate,
} from './rss-actions.js';

import {
  searchYoutubeChannelsDetailed,
  rssImageProxyUrl,
} from './rss-fetcher.js';

import {
  getRssFeeds,
} from './rss-settings.js';

import {
  ensureRssCatalogLoaded,
  searchRssCatalog,
  searchRssCatalogFacets,
  feedsForRssCatalogFacet,
  listRssCatalogCategories,
  listRssCatalogCountries,
  domainForRssCandidate,
  primaryFacetLabelsForCandidate,
  iconForRssCatalogFacet,
  isProbablyUrlOrDomain,
  rssCatalogStats,
  knownSearchExamples,
} from './rss-catalog-search.js';

let dropdown = null;
let browserModal = null;
let cssInjected = false;

// Live YouTube channel search state. Debounced and quota-aware: the actual API
// call fires ~550ms after the last keystroke, in-flight requests are aborted,
// and the last result is cached in `ytState` so the 80ms dropdown re-renders
// neither flicker nor re-fetch. `key` is the normalized query the state belongs
// to; a mismatch with the current input means the state is stale.
let ytSearchTimer = 0;
let ytAbort = null;
let ytState = {
  key: '',
  status: 'idle', // idle | loading | done | limited | auth | error
  channels: [],
  limited: null, // 'user' | 'global' | null
  message: '',
};

const YT_MIN_QUERY_LENGTH = 3;
const YT_SEARCH_DEBOUNCE_MS = 550;

function ensureCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-rss-source-picker-css';
  style.textContent = `
.yanta-rss-source-dropdown {
  position: fixed;
  z-index: 620;

  width: min(520px, calc(100vw - 20px));
  max-height: min(520px, calc(100dvh - 24px));

  display: flex;
  flex-direction: column;
  overflow: hidden;

  border: 1px solid var(--border);
  border-radius: 14px;

  background: var(--bg-elev);
  color: var(--text);

  box-shadow: 0 24px 90px rgba(0,0,0,0.42);
}

.yanta-rss-source-dropdown[hidden] {
  display: none !important;
}

.yanta-rss-source-dropdown-head {
  display: flex;
  align-items: center;
  gap: 8px;

  padding: 10px 11px;
  border-bottom: 1px solid var(--border);

  background: var(--bg-elev-2);
  color: var(--text-dim);

  font-size: 12px;
}

.yanta-rss-source-dropdown-list {
  overflow: auto;
  padding: 7px;
}

.yanta-rss-source-section-title {
  display: flex;
  align-items: center;
  gap: 6px;

  padding: 7px 8px 5px;

  color: var(--text-faint);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.yanta-rss-source-result {
  width: 100%;
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 10px;

  padding: 9px 10px;
  margin-bottom: 5px;

  border: 1px solid transparent;
  border-radius: 11px;

  background: transparent;
  color: var(--text);

  cursor: pointer;
  text-align: left;
}

.yanta-rss-source-result:hover,
.yanta-rss-source-result.active {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev-2));
}

.yanta-rss-source-result-icon {
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

.yanta-rss-source-result-main {
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-rss-source-result-main strong {
  min-width: 0;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  color: var(--text);
  font-size: 13px;
  line-height: 1.25;
}

.yanta-rss-source-result-main small {
  min-width: 0;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.3;
}

.yanta-rss-source-result-badge {
  flex: 0 0 auto;

  padding: 3px 7px;
  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 11%, transparent);

  font-size: 10px;
  font-weight: 850;
}

.yanta-rss-source-result-icon.yanta-yt-avatar {
  overflow: hidden;
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 14%, transparent);
}

.yanta-rss-source-result-icon.yanta-yt-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}

.yanta-rss-source-section-title .yanta-rss-source-section-spinner {
  display: inline-flex;
  margin-left: auto;
  color: var(--text-faint);
  animation: yanta-rss-spin 0.9s linear infinite;
}

@keyframes yanta-rss-spin {
  to { transform: rotate(360deg); }
}

.yanta-rss-source-note {
  display: flex;
  gap: 9px;

  padding: 10px 11px;
  margin: 3px 7px 7px;

  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  border-radius: 11px;

  background: color-mix(in srgb, var(--accent) 6%, var(--bg-elev-2));
  color: var(--text-dim);

  font-size: 11.5px;
  line-height: 1.5;
}

.yanta-rss-source-note svg {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--accent);
}

.yanta-rss-source-note strong {
  color: var(--text);
}

.yanta-rss-source-note a {
  color: var(--accent);
  text-decoration: none;
  font-weight: 700;
}

.yanta-rss-source-note a:hover {
  text-decoration: underline;
}

.yanta-rss-source-empty {
  padding: 14px;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-rss-source-empty strong {
  color: var(--text);
}

.yanta-rss-source-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  margin-top: 9px;
}

.yanta-rss-source-chip {
  border: 1px solid var(--border);
  border-radius: 999px;

  background: var(--bg-elev-2);
  color: var(--text-dim);

  padding: 4px 8px;

  font-size: 11px;
  cursor: pointer;
}

.yanta-rss-source-chip:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.yanta-rss-browser-modal {
  position: fixed;
  inset: 0;
  z-index: 610;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));

  background: rgba(0,0,0,0.52);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
}

.yanta-rss-browser-modal[hidden] {
  display: none !important;
}

.yanta-rss-browser-card {
  width: min(940px, 96vw);
  height: min(760px, 92dvh);

  display: flex;
  flex-direction: column;
  overflow: hidden;

  border: 1px solid var(--border);
  border-radius: 16px;

  background: var(--bg-elev);
  color: var(--text);

  box-shadow: 0 28px 110px rgba(0,0,0,0.48);
}

.yanta-rss-browser-head {
  flex: 0 0 auto;

  display: flex;
  align-items: center;
  gap: 10px;

  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yanta-rss-browser-title {
  flex: 1;
  min-width: 0;
}

.yanta-rss-browser-title strong {
  display: block;
  color: var(--text);
  font-size: 15px;
}

.yanta-rss-browser-title small {
  display: block;
  color: var(--text-faint);
  font-size: 11px;
}

.yanta-rss-browser-body {
  flex: 1 1 auto;
  min-height: 0;

  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
}

.yanta-rss-browser-sidebar {
  min-height: 0;
  overflow: auto;

  border-right: 1px solid var(--border);
  background: var(--bg-elev-2);
  padding: 10px;
}

.yanta-rss-browser-content {
  min-height: 0;
  overflow: auto;

  padding: 12px;
}

.yanta-rss-browser-search {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.yanta-rss-browser-search input {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.yanta-rss-browser-facet {
  width: 100%;

  display: flex;
  align-items: center;
  gap: 8px;

  padding: 8px 9px;
  margin-bottom: 5px;

  border: 1px solid transparent;
  border-radius: 10px;

  background: transparent;
  color: var(--text-dim);

  text-align: left;
  cursor: pointer;
}

.yanta-rss-browser-facet:hover,
.yanta-rss-browser-facet.active {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev));
  color: var(--text);
}

.yanta-rss-browser-facet span {
  flex: 1;
  min-width: 0;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  font-size: 12px;
  font-weight: 760;
}

.yanta-rss-browser-facet small {
  color: var(--text-faint);
  font-size: 10px;
}

.yanta-rss-browser-source {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;

  padding: 10px;
  margin-bottom: 8px;

  border: 1px solid var(--border);
  border-radius: 12px;

  background: var(--bg-elev-2);
}

.yanta-rss-browser-source-icon {
  width: 38px;
  height: 38px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.yanta-rss-browser-source-main {
  min-width: 0;
}

.yanta-rss-browser-source-main strong {
  display: block;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  color: var(--text);
  font-size: 13px;
}

.yanta-rss-browser-source-main small {
  display: block;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  color: var(--text-faint);
  font-size: 11px;
  margin-top: 2px;
}

.yanta-rss-browser-source-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.yanta-rss-browser-footer {
  flex: 0 0 auto;

  display: flex;
  align-items: center;
  gap: 8px;

  padding: 10px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-elev-2);
}

@media (max-width: 760px) {
  .yanta-rss-browser-body {
    grid-template-columns: 1fr;
  }

  .yanta-rss-browser-sidebar {
    max-height: 210px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .yanta-rss-browser-source {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .yanta-rss-browser-source-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
  `;

  document.head.append(style);
}

function ensureDropdown() {
  ensureCss();

  if (dropdown) return dropdown;

  dropdown = document.createElement('div');
  dropdown.className = 'yanta-rss-source-dropdown';
  dropdown.hidden = true;

  document.body.append(dropdown);

  document.addEventListener('pointerdown', (e) => {
    if (!dropdown || dropdown.hidden) return;
    if (dropdown.contains(e.target)) return;
    if (e.target?.closest?.('[data-rss-source-input]')) return;

    closeRssSourceDropdown();
  }, true);

  return dropdown;
}

function closeRssSourceDropdown() {
  if (!dropdown) return;

  // Reset (not just abort) so a mid-flight query never leaves the state stuck on
  // "loading" for the next open. Reopening the same query hits the shared cache.
  resetYoutubeState();

  dropdown.hidden = true;
  dropdown.replaceChildren();
}

function positionDropdown(input) {
  if (!dropdown || !input) return;

  const r = input.getBoundingClientRect();

  dropdown.style.left = `${Math.max(10, Math.min(window.innerWidth - 530, r.left))}px`;
  dropdown.style.top = `${Math.min(window.innerHeight - 20, r.bottom + 7)}px`;
  dropdown.style.width = `${Math.min(520, Math.max(280, r.width))}px`;
}

function metaLineForCandidate(candidate) {
  return [
    ...primaryFacetLabelsForCandidate(candidate).slice(0, 2),
    domainForRssCandidate(candidate),
  ].filter(Boolean).join(' · ');
}

function resultButton({
  icon = 'rss',
  title,
  subtitle = '',
  badge = '',
  onClick,
}) {
  const btn = el('button', {
    type: 'button',
    class: 'yanta-rss-source-result',
  });

  btn.innerHTML = `
    <span class="yanta-rss-source-result-icon">${lucide(icon, 17)}</span>
    <span class="yanta-rss-source-result-main">
      <strong>${escapeHtml(title)}</strong>
      ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}
    </span>
    ${badge ? `<span class="yanta-rss-source-result-badge">${escapeHtml(badge)}</span>` : ''}
  `;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    await onClick?.();
  });

  return btn;
}

function sectionTitle(label, icon = 'rss') {
  const node = el('div', { class: 'yanta-rss-source-section-title' });

  node.innerHTML = `${lucide(icon, 12)} ${escapeHtml(label)}`;

  return node;
}

async function addCandidate(candidate, {
  onAdded,
} = {}) {
  if (!candidate?.feedUrl) {
    toast('Source has no feed URL', 'error');
    return;
  }

  await addRssFeedFromUniversalInput(candidate.feedUrl);

  toast('Source added', 'success');

  await onAdded?.(candidate);
}

export async function addBestRssSourceFromInput(input, {
  onAdded,
} = {}) {
  const raw = String(input || '').trim();

  if (!raw) return null;

  if (!isProbablyUrlOrDomain(raw)) {
    await ensureRssCatalogLoaded();

    const [hit] = searchRssCatalog(raw, {
      limit: 1,
    });

    if (hit?.feedUrl) {
      await addCandidate(hit, {
        onAdded,
      });

      return hit;
    }
  }

  const feed = await addRssFeedFromUniversalInput(raw);

  await onAdded?.(feed);

  return feed;
}

function normalizeYtQuery(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function shouldOfferYoutubeSearch(value = '') {
  const raw = String(value || '').trim();

  if (raw.length < YT_MIN_QUERY_LENGTH) return false;

  // URLs / domains / channel IDs resolve through the discover + resolve paths
  // (which cost no search quota), so we never spend a channel-search call there.
  return !isProbablyUrlOrDomain(raw);
}

function formatSubscriberCount(count) {
  const n = Number(count || 0);

  if (!n) return '';

  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  }

  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  }

  return String(n);
}

function abortYoutubeSearch() {
  clearTimeout(ytSearchTimer);
  ytSearchTimer = 0;

  if (ytAbort) {
    ytAbort.abort();
    ytAbort = null;
  }
}

function resetYoutubeState() {
  abortYoutubeSearch();
  ytState = { key: '', status: 'idle', channels: [], limited: null, message: '' };
}

// Kicks off (or reuses) a debounced channel search for `value`. Safe to call on
// every keystroke — an unchanged query neither reschedules nor re-fetches.
function ensureYoutubeSearch(input, value, { onAdded } = {}) {
  const key = normalizeYtQuery(value);

  // Already loading or showing results for this exact query — nothing to do.
  if (ytState.key === key && ytState.status !== 'idle') return;

  abortYoutubeSearch();

  ytState = { key, status: 'loading', channels: [], limited: null, message: '' };

  ytSearchTimer = window.setTimeout(async () => {
    if (!input.isConnected) return;
    if (normalizeYtQuery(input.value) !== key) return; // user moved on

    const controller = new AbortController();
    ytAbort = controller;

    let next = null;

    try {
      const result = await searchYoutubeChannelsDetailed(value, {
        limit: 6,
        signal: controller.signal,
      });

      // Pre-resolve proxied avatar URLs so rendering stays synchronous and the
      // user's image-proxy privacy setting is honoured.
      const channels = await Promise.all(
        (result.channels || []).map(async (channel) => ({
          ...channel,
          thumbProxied: channel.thumbnail
            ? await rssImageProxyUrl(channel.thumbnail).catch(() => '')
            : '',
        }))
      );

      next = {
        key,
        status: result.limited ? 'limited' : 'done',
        channels,
        limited: result.limited,
        message: result.message || '',
      };
    } catch (err) {
      if (controller.signal.aborted) return;

      next = err?.code === 'EAUTH_REQUIRED'
        ? { key, status: 'auth', channels: [], limited: null, message: '' }
        : { key, status: 'error', channels: [], limited: null, message: '' };
    } finally {
      if (ytAbort === controller) ytAbort = null;
    }

    if (!next) return;

    // Discard if the query changed while we were fetching.
    if (normalizeYtQuery(input.value) !== key) return;

    ytState = next;

    if (dropdown && !dropdown.hidden) {
      renderDropdown(input, { onAdded });
    }
  }, YT_SEARCH_DEBOUNCE_MS);
}

async function addYoutubeChannel(channel, { onAdded } = {}) {
  if (!channel?.feedUrl) {
    toast('Channel has no feed URL', 'error');
    return;
  }

  // All channel metadata already came from the search response, so adding costs
  // no further YouTube API quota.
  await addRssFeedCandidate({
    title: channel.title || 'YouTube Channel',
    feedUrl: channel.feedUrl,
    siteUrl: channel.siteUrl || '',
    description: channel.description || '',
    channelId: channel.channelId || channel.id || '',
    source: 'youtube-data-api',
  }, {
    originalInput: channel.title || '',
  });

  toast('Channel added', 'success');

  await onAdded?.(channel);
}

function youtubeResultButton(channel, { onClick } = {}) {
  const btn = el('button', {
    type: 'button',
    class: 'yanta-rss-source-result',
  });

  const subs = formatSubscriberCount(channel.subscriberCount);
  const meta = [channel.handle || '', subs ? `${subs} subscribers` : '']
    .filter(Boolean)
    .join(' · ');

  const avatar = channel.thumbProxied
    ? `<img src="${escapeAttr(channel.thumbProxied)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : lucide('youtube', 17);

  btn.innerHTML = `
    <span class="yanta-rss-source-result-icon yanta-yt-avatar">${avatar}</span>
    <span class="yanta-rss-source-result-main">
      <strong>${escapeHtml(channel.title || 'YouTube Channel')}</strong>
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ''}
    </span>
    <span class="yanta-rss-source-result-badge">Add</span>
  `;

  const img = btn.querySelector('img');
  if (img) {
    img.addEventListener('error', () => {
      const holder = img.parentElement;
      if (holder) holder.innerHTML = lucide('youtube', 17);
    });
  }

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    await onClick?.();
  });

  return btn;
}

function youtubeLimitNote(state) {
  const note = el('div', { class: 'yanta-rss-source-note' });

  const isAuth = state.status === 'auth';

  const headline = isAuth
    ? 'Sign in to search YouTube'
    : state.limited === 'global'
      ? 'YouTube search is busy right now'
      : 'Daily YouTube search limit reached';

  const body = isAuth
    ? 'Connect YANTA Cloud to search channels by name.'
    : 'You can still add any channel directly — open it on '
      + '<a href="https://www.youtube.com" target="_blank" rel="noopener noreferrer">YouTube</a>, '
      + 'copy the URL from your browser’s address bar, and paste it here.';

  note.innerHTML = `
    ${lucide(isAuth ? 'log-in' : 'info', 15)}
    <span><strong>${escapeHtml(headline)}.</strong> ${body}</span>
  `;

  return note;
}

function renderYoutubeSection(list, input, value, { onAdded } = {}) {
  const key = normalizeYtQuery(value);

  // Only trust the state if it belongs to the query currently in the input.
  const state = ytState.key === key
    ? ytState
    : { status: 'loading', channels: [], limited: null, message: '' };

  const title = el('div', { class: 'yanta-rss-source-section-title' });
  title.innerHTML = `
    ${lucide('youtube', 12)} YouTube channels
    ${state.status === 'loading' ? `<span class="yanta-rss-source-section-spinner">${lucide('loader-circle', 12)}</span>` : ''}
  `;
  list.append(title);

  if (state.status === 'limited' || state.status === 'auth') {
    list.append(youtubeLimitNote(state));
    return;
  }

  if (state.status === 'error') {
    const note = el('div', { class: 'yanta-rss-source-empty' });
    note.textContent = 'YouTube search is unavailable right now. Paste a channel URL to add it directly.';
    list.append(note);
    return;
  }

  if (state.status === 'done' && !state.channels.length) {
    const note = el('div', { class: 'yanta-rss-source-empty' });
    note.innerHTML = `No YouTube channels found for “${escapeHtml(value)}”.`;
    list.append(note);
    return;
  }

  for (const channel of state.channels) {
    list.append(
      youtubeResultButton(channel, {
        onClick: async () => {
          closeRssSourceDropdown();

          try {
            await addYoutubeChannel(channel, { onAdded });
          } catch (err) {
            toast(err?.message || 'Could not add channel', 'error');
          }
        },
      })
    );
  }
}

function renderDropdown(input, {
  onAdded,
} = {}) {
  const dd = ensureDropdown();
  const value = input.value.trim();

  positionDropdown(input);
  dd.replaceChildren();

  const stats = rssCatalogStats();

  const head = el('div', { class: 'yanta-rss-source-dropdown-head' });
  head.innerHTML = `${lucide('sparkles', 14)} Curated catalog · ${stats.count} sources`;
  dd.append(head);

  const list = el('div', { class: 'yanta-rss-source-dropdown-list' });

  if (!value) {
    resetYoutubeState();

    const examples = knownSearchExamples().slice(0, 10);

    list.append(
      resultButton({
        icon: 'layout-grid',
        title: 'Browse curated sources',
        subtitle: 'Explore categories and countries',
        badge: 'Browse',
        onClick: async () => {
          closeRssSourceDropdown();
          await openRssSourceBrowser({
            onAdded,
          });
        },
      })
    );

    list.append(sectionTitle('Try searching', 'search'));

    const empty = el('div', { class: 'yanta-rss-source-empty' });
    empty.innerHTML = `
      <strong>Tip:</strong> Simply paste a YouTube Channel URL or search for topics.
      <br>
      Examples:
      <div class="yanta-rss-source-examples">
        ${examples.map((x) => `<button class="yanta-rss-source-chip" data-example="${escapeAttr(x)}">${escapeHtml(x)}</button>`).join('')}
      </div>
    `;

    empty.querySelectorAll('[data-example]').forEach((btn) => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.example || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
    });

    list.append(empty);
    dd.append(list);
    dd.hidden = false;
    return;
  }

  if (isProbablyUrlOrDomain(value)) {
    list.append(
      resultButton({
        icon: 'globe',
        title: `Discover feeds from ${value}`,
        subtitle: 'YANTA Cloud will inspect the website or feed URL',
        badge: 'Discover',
        onClick: async () => {
          closeRssSourceDropdown();

          try {
            await addBestRssSourceFromInput(value, {
              onAdded,
            });
          } catch (err) {
            toast(err?.message || 'Could not add source', 'error');
          }
        },
      })
    );
  }

  // Live YouTube channel search (debounced + quota-aware). Placed high so a
  // creator name surfaces the channel immediately; skipped for URL/domain input.
  const offerYoutube = shouldOfferYoutubeSearch(value);

  if (offerYoutube) {
    ensureYoutubeSearch(input, value, { onAdded });
    renderYoutubeSection(list, input, value, { onAdded });
  } else {
    resetYoutubeState();
  }

  const facets = searchRssCatalogFacets(value, {
    limit: 5,
  });

  const feeds = searchRssCatalog(value, {
    limit: 10,
  });

  if (facets.length) {
    list.append(sectionTitle('Categories & countries', 'layout-list'));

    for (const facet of facets) {
      list.append(
        resultButton({
          icon: iconForRssCatalogFacet(facet),
          title: facet.label,
          subtitle: `${facet.count} source${facet.count === 1 ? '' : 's'}`,
          badge: 'Browse',
          onClick: async () => {
            closeRssSourceDropdown();

            await openRssSourceBrowser({
              initialFacet: facet,
              onAdded,
            });
          },
        })
      );
    }
  }

  if (feeds.length) {
    list.append(sectionTitle('Matching sources', 'rss'));

    for (const feed of feeds) {
      list.append(
        resultButton({
          icon: 'rss',
          title: feed.title,
          subtitle: metaLineForCandidate(feed),
          badge: 'Add',
          onClick: async () => {
            closeRssSourceDropdown();

            try {
              await addCandidate(feed, {
                onAdded,
              });
            } catch (err) {
              toast(err?.message || 'Could not add source', 'error');
            }
          },
        })
      );
    }
  }

  if (!facets.length && !feeds.length && !isProbablyUrlOrDomain(value) && !offerYoutube) {
    const empty = el('div', { class: 'yanta-rss-source-empty' });
    empty.innerHTML = `
      <strong>No curated source found for “${escapeHtml(value)}”.</strong><br>
      Try a broader topic like <strong>tech</strong>, <strong>science</strong>, <strong>news</strong>,
      or paste a website URL.
    `;

    list.append(empty);
  }

  dd.append(list);
  dd.hidden = false;
}

export function attachRssSourcePicker(input, {
  onAdded,
} = {}) {
  if (!input || input.dataset.rssSourcePickerBound === '1') return;

  input.dataset.rssSourcePickerBound = '1';
  input.dataset.rssSourceInput = '1';

  // Katalog im Hintergrund laden, bevor der User zu tippen beginnt.
  ensureRssCatalogLoaded();

  let timer = 0;

  const refresh = () => {
    clearTimeout(timer);

    timer = window.setTimeout(() => {
      if (!input.isConnected) return;
      renderDropdown(input, {
        onAdded,
      });
    }, 80);
  };

  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      closeRssSourceDropdown();
      return;
    }

    if (e.key !== 'Enter') return;

    e.preventDefault();
    closeRssSourceDropdown();

    try {
      await addBestRssSourceFromInput(input.value, {
        onAdded,
      });

      input.value = '';
    } catch (err) {
      toast(err?.message || 'Could not add source', 'error');
    }
  });

  window.addEventListener('resize', () => {
    if (!dropdown || dropdown.hidden) return;
    positionDropdown(input);
  });
}

function ensureBrowserModal() {
  ensureCss();

  if (browserModal) return browserModal;

  browserModal = document.createElement('div');
  browserModal.className = 'yanta-rss-browser-modal';
  browserModal.hidden = true;

  document.body.append(browserModal);

  browserModal.addEventListener('click', (e) => {
    if (e.target === browserModal) {
      browserModal.hidden = true;
    }

    if (e.target.closest?.('[data-rss-browser-close]')) {
      browserModal.hidden = true;
    }
  });

  return browserModal;
}

async function alreadyAddedFeedUrls() {
  const feeds = await getRssFeeds();

  return new Set(feeds.map((f) => String(f.feedUrl || '').toLowerCase()));
}

export async function openRssSourceBrowser({
  initialFacet = null,
  onAdded,
} = {}) {
  await ensureRssCatalogLoaded();

  const modal = ensureBrowserModal();
  let activeFacet =
    initialFacet ||
    listRssCatalogCategories()[0] ||
    listRssCatalogCountries()[0] ||
    null;

  let query = '';

  const render = async () => {
    const added = await alreadyAddedFeedUrls();

    const stats = rssCatalogStats();
    const categories = listRssCatalogCategories();
    const countries = listRssCatalogCountries();

    let sources = [];

    if (query.trim()) {
      sources = searchRssCatalog(query, {
        limit: 80,
      });
    } else if (activeFacet) {
      sources = feedsForRssCatalogFacet(activeFacet, {
        limit: 250,
      });
    } else {
      sources = searchRssCatalog('', {
        includeZeroQuery: true,
        limit: 80,
      });
    }

    modal.innerHTML = `
      <div class="yanta-rss-browser-card">
        <header class="yanta-rss-browser-head">
          <div class="yanta-rss-browser-title">
            <strong>Browse Sources</strong>
            <small>${escapeHtml(stats.count)} curated feeds · ${escapeHtml(stats.source.name)} · ${escapeHtml(stats.source.license)}</small>
          </div>

          <button class="icon-btn" data-rss-browser-close title="Close">
            ${lucide('x', 16)}
          </button>
        </header>

        <main class="yanta-rss-browser-body">
          <aside class="yanta-rss-browser-sidebar">
            <div class="yanta-rss-source-section-title">
              ${lucide('layout-grid', 12)} Recommended
            </div>

            ${categories.slice(0, 50).map((facet) => `
              <button class="yanta-rss-browser-facet ${activeFacet?.type === 'category' && activeFacet?.id === facet.id && !query ? 'active' : ''}"
                data-facet-type="category"
                data-facet-id="${escapeAttr(facet.id)}">
                ${lucide(facet.icon || 'rss', 13)}
                <span>${escapeHtml(facet.label)}</span>
                <small>${facet.count}</small>
              </button>
            `).join('')}

            <div class="yanta-rss-source-section-title" style="margin-top:10px">
              ${lucide('map-pin', 12)} Countries
            </div>

            ${countries.map((facet) => `
              <button class="yanta-rss-browser-facet ${activeFacet?.type === 'country' && activeFacet?.id === facet.id && !query ? 'active' : ''}"
                data-facet-type="country"
                data-facet-id="${escapeAttr(facet.id)}">
                ${lucide(facet.icon || 'map-pin', 13)}
                <span>${escapeHtml(facet.label)}</span>
                <small>${facet.count}</small>
              </button>
            `).join('')}
          </aside>

          <section class="yanta-rss-browser-content">
            <div class="yanta-rss-browser-search">
              <input class="text-input" data-rss-browser-search value="${escapeAttr(query)}" placeholder="Search curated sources…" />
              <button class="btn" data-rss-browser-clear ${query ? '' : 'hidden'}>${lucide('x', 14)} Clear</button>
            </div>

            ${
              activeFacet && !query
                ? `<div class="yanta-settings-group-title">${escapeHtml(activeFacet.label)} · ${sources.length} source${sources.length === 1 ? '' : 's'}</div>`
                : `<div class="yanta-settings-group-title">${query ? `Search results · ${sources.length}` : 'Sources'}</div>`
            }

            <div data-rss-browser-sources>
              ${
                sources.length
                  ? sources.map((source) => {
                      const isAdded = added.has(String(source.feedUrl || '').toLowerCase());
                      const meta = metaLineForCandidate(source);

                      return `
                        <div class="yanta-rss-browser-source">
                          <span class="yanta-rss-browser-source-icon">
                            ${lucide('rss', 17)}
                          </span>

                          <span class="yanta-rss-browser-source-main">
                            <strong>${escapeHtml(source.title || 'Untitled source')}</strong>
                            <small>${escapeHtml(meta || source.feedUrl || '')}</small>
                          </span>

                          <span class="yanta-rss-browser-source-actions">
                            <button class="btn ${isAdded ? '' : 'primary'}"
                              data-add-feed-url="${escapeAttr(source.feedUrl)}"
                              ${isAdded ? 'disabled' : ''}>
                              ${lucide(isAdded ? 'check' : 'plus', 14)}
                              ${isAdded ? 'Added' : 'Add'}
                            </button>
                          </span>
                        </div>
                      `;
                    }).join('')
                  : `
                    <div class="yanta-rss-source-empty">
                      No sources found. Try another query or paste a website/feed URL.
                    </div>
                  `
              }
            </div>
          </section>
        </main>

        <footer class="yanta-rss-browser-footer">

          <span class="grow"></span>

          <button class="btn primary" data-rss-browser-close>Done</button>
        </footer>
      </div>
    `;

    const searchInput = modal.querySelector('[data-rss-browser-search]');
    searchInput?.addEventListener('input', () => {
      query = searchInput.value || '';
      render().catch(() => {});
    });

    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        browserModal.hidden = true;
      }
    });

    modal.querySelector('[data-rss-browser-clear]')?.addEventListener('click', () => {
      query = '';
      render().catch(() => {});
    });

    modal.querySelectorAll('[data-facet-type][data-facet-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.facetType;
        const id = btn.dataset.facetId;

        const list = type === 'country'
          ? listRssCatalogCountries()
          : listRssCatalogCategories();

        activeFacet = list.find((x) => x.id === id) || {
          type,
          id,
          label: id,
          count: 0,
        };

        query = '';
        render().catch(() => {});
      });
    });

    modal.querySelectorAll('[data-add-feed-url]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const feedUrl = btn.dataset.addFeedUrl || '';
        if (!feedUrl) return;

        btn.disabled = true;
        btn.innerHTML = `${lucide('loader-circle', 14)} Adding…`;

        try {
          await addRssFeedFromUniversalInput(feedUrl);

          await onAdded?.();

          toast('Source added', 'success');
          await render();
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = `${lucide('plus', 14)} Add`;
          toast(err?.message || 'Could not add source', 'error');
        }
      });
    });

    requestAnimationFrame(() => {
      if (query) {
        searchInput?.focus();
      }
    });
  };

  modal.hidden = false;
  await render();
}
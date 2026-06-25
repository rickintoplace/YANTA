// ============================================================
// YANTA Sources / RSS — native UI
//
// Modes:
// - side pane
// - fullscreen
//
// UX:
// - list/grid toggle
// - instant reader open
// - media player for audio/podcast/video
// - YouTube-native feed rendering through YouTube RSS
// ============================================================

import DOMPurify from 'dompurify';

import {
  el,
  escapeHtml,
  escapeAttr,
  lucide,
  toast,
} from '../core.js';

import {
  openSidePane,
  closeSidePane,
  isSidePaneOpen,
} from '../side-pane.js';

import {
  openNote,
} from '../notes.js';

import {
  getRssSettings,
  saveRssSettings,
  getRssFeeds,
  deleteRssFeed,
  setRssFeedTags,
  rssTagCountsFromFeeds,
} from './rss-settings.js';

import {
  listRssItems,
  getRssItem,
} from './rss-store.js';

import {
  rssImageProxyUrl,
} from './rss-fetcher.js';

import {
  refreshAllRssFeeds,
  refreshRssFeed,
  loadMoreRssFeedItems,
  markRssItemRead,
  toggleRssItemStar,
  archiveRssItem,
  saveRssItemAsNote,
  appendRssItemToCurrentNote,
} from './rss-actions.js';

import {
  addBestRssSourceFromInput,
  attachRssSourcePicker,
  openRssSourceBrowser,
} from './rss-source-picker.js';

import {
  getRssCloudAuthState,
  openYantaCloudLoginForSources,
} from './rss-cloud-auth.js';

import {
  yantaConfirm,
} from '../dialogs.js';

import { pushOverlayState, closeTopOverlay } from '../overlay-history.js';

let initialized = false;

let mode = 'pane'; // pane | fullscreen
let currentMode = 'unread';
let currentFeedId = '';
let currentSourceTag = '';
let searchQuery = '';
let layoutMode = 'grid';
let activeReaderItemId = '';
let addToolbarOpen = false;

let root = null;
let fullscreenHost = null;
let sourcesModal = null;
let renderInboxSeq = 0;
let renderInboxTimer = 0;

const VT_NAME = 'yanta-rss-sources';

function supportsViewTransition() {
  return !!document.startViewTransition &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function fmtDate(ms) {
  if (!ms) return '';

  const d = new Date(ms);

  if (Number.isNaN(d.getTime())) return '';

  return d.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function stripHtml(html = '') {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');

  tmp.querySelectorAll('script, style, noscript, iframe, object, embed').forEach((n) => n.remove());

  return (tmp.textContent || tmp.innerText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeUrl(value = '') {
  try {
    return new URL(String(value || '').trim(), location.href).href;
  } catch {
    return String(value || '').trim();
  }
}

function isLikelyTrackingImageUrl(rawUrl = '') {
  const s = String(rawUrl || '').trim();

  if (!s) return true;

  try {
    const url = new URL(s, location.href);
    const path = `${url.hostname}${url.pathname}`.toLowerCase();
    const qs = url.search.toLowerCase();

    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'data:') {
      return true;
    }

    if (
      path.includes('/_/stat') ||
      path.includes('/stat?') ||
      path.includes('/pixel') ||
      path.includes('pixel.') ||
      path.includes('/beacon') ||
      path.includes('/track') ||
      path.includes('/tracking') ||
      path.includes('/analytics') ||
      path.includes('/transparent') ||
      path.includes('/spacer') ||
      path.includes('/blank.') ||
      path.includes('/1x1') ||
      path.includes('doubleclick.net') ||
      path.includes('googletagmanager') ||
      path.includes('google-analytics') ||
      path.includes('facebook.com/tr') ||
      path.includes('medium.com/_/stat')
    ) {
      return true;
    }

    if (
      qs.includes('event=') ||
      qs.includes('clientviewed') ||
      qs.includes('postid=') ||
      qs.includes('referrersource=full_rss')
    ) {
      return true;
    }

    if (
      !/\.(png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i.test(url.href) &&
      (
        path.includes('stat') ||
        path.includes('track') ||
        path.includes('pixel') ||
        path.includes('beacon')
      )
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function isTinyTrackingImage(img) {
  if (!img) return true;

  const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
  if (isLikelyTrackingImageUrl(src)) return true;

  const w = Number(img.getAttribute('width') || img.style?.width?.replace('px', '') || 0);
  const h = Number(img.getAttribute('height') || img.style?.height?.replace('px', '') || 0);

  if ((w && w <= 2) || (h && h <= 2)) return true;
  if (w === 1 && h === 1) return true;

  const alt = String(img.getAttribute('alt') || '').toLowerCase();
  if (alt.includes('tracking') || alt.includes('pixel')) return true;

  return false;
}

function cleanFeedHtml(html = '') {
  const clean = DOMPurify.sanitize(String(html || ''), {
    USE_PROFILES: {
      html: true,
    },

    FORBID_TAGS: [
      'script',
      'iframe',
      'form',
      'object',
      'embed',
      'style',
      'noscript',
    ],

    ADD_TAGS: [
      'audio',
      'video',
      'source',
      'details',
      'summary',
    ],

    ADD_ATTR: [
      'target',
      'rel',
      'loading',
      'referrerpolicy',
      'controls',
      'src',
      'type',
      'poster',
      'preload',
      'open',
    ],
  });

  const tpl = document.createElement('template');
  tpl.innerHTML = clean;

  tpl.content.querySelectorAll('img').forEach((img) => {
    if (isTinyTrackingImage(img)) {
      img.remove();
      return;
    }

    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
  });

  tpl.content.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  tpl.content.querySelectorAll('audio, video').forEach((media) => {
    media.setAttribute('controls', '');
    media.setAttribute('preload', 'metadata');
  });

  return tpl.innerHTML;
}

async function imageSrc(url, settingsOverride = null) {
  const settings = settingsOverride || await getRssSettings();

  if (!settings.showImages || !url) return '';
  if (isLikelyTrackingImageUrl(url)) return '';

  return rssImageProxyUrl(url, settings);
}

function scheduleRenderInbox() {
  window.clearTimeout(renderInboxTimer);

  renderInboxTimer = window.setTimeout(() => {
    renderInbox().catch((err) => {
      console.error('[YANTA RSS] Could not render inbox', err);
    });
  }, 80);
}

function ensureFullscreenHost() {
  if (fullscreenHost) return fullscreenHost;

  fullscreenHost = document.createElement('section');
  fullscreenHost.className = 'yanta-rss-fullscreen';
  fullscreenHost.hidden = true;

  document.body.append(fullscreenHost);

  return fullscreenHost;
}

function ensureRoot() {
  if (root) return root;

  injectCss();

  root = el('div', { class: 'yanta-rss-root' });
  root.dataset.rssRoot = '1';

  return root;
}

async function withRssViewTransition(mutator) {
  const node = ensureRoot();

  if (!supportsViewTransition()) {
    mutator();
    return;
  }

  node.style.viewTransitionName = VT_NAME;
  node.style.contain = 'layout paint';

  try {
    const vt = document.startViewTransition(() => {
      mutator();
    });

    await Promise.allSettled([
      vt.ready,
      vt.updateCallbackDone,
      vt.finished,
    ].filter(Boolean));
  } catch {
    mutator();
  } finally {
    node.style.viewTransitionName = '';
    node.style.contain = '';
  }
}

function syncPreviewPaneSwitcherButton() {
  const switcher = document.querySelector('[data-preview-pane-switcher]');
  if (!switcher) return;

  if (switcher.querySelector('[data-pane-kind="rss"]')) return;

  const sep = switcher.querySelector('.yanta-preview-pane-switcher-sep');

  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.dataset.paneKind = 'rss';
  btn.title = 'Sources';
  btn.innerHTML = lucide('rss', 15);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    openRssPane().catch((err) => {
      console.error(err);
      toast('Could not open Sources', 'error');
    });
  });

  if (sep) {
    switcher.insertBefore(btn, sep);
  } else {
    switcher.append(btn);
  }
}

function installPreviewPaneSwitcherObserver() {
  const run = () => syncPreviewPaneSwitcherButton();

  run();

  const observer = new MutationObserver(run);

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function isAudioItem(item) {
  return String(item.mediaType || '').startsWith('audio/') ||
    /\.(mp3|m4a|aac|ogg|oga|opus|wav)(?:$|[?#])/i.test(item.mediaUrl || '');
}

function videoEmbedUrl(url = '') {
  const s = String(url || '').trim();

  let m;

  if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  }

  if ((m = /(?:youtube\.com|youtube-nocookie\.com)\/embed\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  }

  if ((m = /youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  }

  if ((m = /vimeo\.com\/(\d+)/.exec(s))) {
    return `https://player.vimeo.com/video/${m[1]}`;
  }

  return '';
}

function isVideoItem(item) {
  return String(item.mediaType || '').startsWith('video/') ||
    String(item.mediaType || '') === 'video/youtube' ||
    /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(item.mediaUrl || '') ||
    !!videoEmbedUrl(item.mediaUrl || item.url || '');
}

function mediaBadge(item) {
  if (isAudioItem(item)) return { icon: 'podcast', label: 'Podcast' };
  if (isVideoItem(item)) return { icon: 'play', label: 'Video' };
  return null;
}

async function renderItemCard(item) {
  const btn = el('div', {
    role: 'button',
    tabindex: '0',
    class:
      'yanta-rss-item' +
      (item.read ? ' read' : '') +
      (item.starred ? ' starred' : ''),
  });

  let touchTimer = null;
  let isLongPress = false;
  let startX = 0;
  let startY = 0;

  btn.addEventListener('click', (e) => {
    if (isLongPress) {
      e.preventDefault();
      e.stopPropagation();
      isLongPress = false;
      return;
    }

    if (btn.classList.contains('actions-open')) {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.remove('actions-open');
      return;
    }

    renderReader(item.id).catch((err) => {
      console.error(err);
      toast('Could not open source item', 'error');
    });
  });

  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      btn.click();
    }
  });

  const thumb = el('div', { class: 'yanta-rss-thumb' });
  const src = await imageSrc(item.imageUrl);

  const badge = mediaBadge(item);

  if (src) {
    thumb.append(el('img', {
      src,
      alt: '',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
    }));
  } else if (badge) {
    thumb.innerHTML = lucide(badge.icon, 24);
    thumb.classList.add('media');
  } else {
    thumb.innerHTML = lucide('rss', 24);
  }

  const main = el('div', { class: 'yanta-rss-item-main' });

  const titleRow = el('div', { class: 'yanta-rss-title-row' });

  titleRow.append(el('div', { class: 'yanta-rss-title' }, item.title || 'Untitled'));

  if (badge) {
    const media = el('span', { class: 'yanta-rss-media-badge' });
    media.innerHTML = `${lucide(badge.icon, 11)} ${escapeHtml(badge.label)}`;
    titleRow.append(media);
  }

  main.append(
    titleRow,
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
      (item.summaryText || item.contentText || '').slice(0, 280)
    ));
  }

  const actions = el('div', { class: 'yanta-rss-actions' });

  const star = el('button', { class: 'btn iconish', type: 'button', title: item.starred ? 'Unstar' : 'Star' });
  star.innerHTML = lucide('star', 13);
  star.classList.toggle('active', !!item.starred);

  star.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await toggleRssItemStar(item.id);
      await renderInbox();
    } catch (err) {
      toast(err?.message || 'Could not update item', 'error');
    }
  });

  const save = el('button', { class: 'btn primary compact', type: 'button' });
  save.innerHTML = `${lucide('file-plus', 13)} Save`;

  save.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const note = await saveRssItemAsNote(item.id);
      if (note?.id) await openNote(note.id);
    } catch (err) {
      toast(err?.message || 'Could not save item', 'error');
    }
  });

  const archive = el('button', {
    class: 'btn iconish',
    type: 'button',
    title: item.archived ? 'Restore' : 'Archive',
  });

  archive.innerHTML = lucide(item.archived ? 'archive-restore' : 'archive', 13);

  archive.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await archiveRssItem(item.id, !item.archived);
      await renderInbox();
    } catch (err) {
      toast(err?.message || 'Could not archive item', 'error');
    }
  });

  const handleClose = (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.remove('actions-open');
  };

  actions.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  actions.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
  actions.addEventListener('touchend', (e) => e.stopPropagation());
  actions.addEventListener('click', (e) => e.stopPropagation());

  actions.append(star, save, archive);
  main.append(actions);

  btn.append(thumb, main);

  return btn;
}

function youtubeVideoIdFromUrlForDedupe(raw = '') {
  const s = String(raw || '').trim();

  try {
    const url = new URL(s, location.href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      return url.pathname.replace(/^\//, '').split('/')[0] || '';
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';

      const embed = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{6,})/);
      if (embed) return embed[1];

      const shorts = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
      if (shorts) return shorts[1];
    }
  } catch {}

  let m;

  if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return m[1];
  }

  if ((m = /(?:youtube\.com|youtube-nocookie\.com)\/embed\/([a-zA-Z0-9_-]{6,})/.exec(s))) {
    return m[1];
  }

  return '';
}

function rssDisplayKey(item = {}) {
  const videoId =
    item.videoId ||
    youtubeVideoIdFromUrlForDedupe(item.url || '') ||
    youtubeVideoIdFromUrlForDedupe(item.mediaUrl || '');

  if (videoId) return `yt:${videoId}`;

  const url =
    item.canonicalUrl ||
    item.url ||
    item.mediaUrl ||
    '';

  if (url) return `url:${String(url).trim().toLowerCase()}`;

  const guid = item.guid || item.id || '';

  if (guid) return `guid:${String(guid).trim().toLowerCase()}`;

  return `title:${String(item.feedId || '')}:${String(item.title || '').trim().toLowerCase()}`;
}

function dedupeRssItemsForDisplay(items = []) {
  const out = [];
  const seen = new Set();

  for (const item of items || []) {
    const key = rssDisplayKey(item);

    if (seen.has(key)) continue;

    seen.add(key);
    out.push(item);
  }

  return out;
}

async function loadVisibleItems() {
  const feeds = await getRssFeeds();
  const archivedMode = currentMode === 'archived';

  const tagFeedIds = currentSourceTag
    ? new Set(
        feeds
          .filter((feed) => (feed.tags || []).includes(currentSourceTag))
          .map((feed) => feed.id)
      )
    : null;

  const items = await listRssItems({
    feedId: currentFeedId,
    unreadOnly: currentMode === 'unread',
    starredOnly: currentMode === 'starred',
    archived: archivedMode,
    query: searchQuery,
    limit: 500,
  });

  const filtered = items.filter((item) => {
    if (archivedMode && item.archived !== true) return false;
    if (tagFeedIds && !tagFeedIds.has(item.feedId)) return false;

    return true;
  });

  return dedupeRssItemsForDisplay(filtered);
}

async function renderLoadMoreFooter(feed) {
  const settings = await getRssSettings();

  const wrap = el('div', { class: 'yanta-rss-load-more-footer' });

  const meta = el('div', { class: 'yanta-rss-load-more-meta' });

  meta.innerHTML = `
    <strong>${escapeHtml(feed.title || 'YouTube source')}</strong>
    <small>
      ${feed.youtubeNextPageToken ? 'Load older videos from this channel.' : 'Find older videos from this channel.'}
      Shorts are ${settings.youtubeHideShorts !== false ? 'hidden' : 'included'}.
    </small>
  `;

  const btn = el('button', {
    class: 'btn primary',
    type: 'button',
  });

  btn.innerHTML = `${lucide('list-plus', 14)} Load more videos`;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = `${lucide('loader-circle', 14)} Loading…`;

    try {
      const result = await loadMoreRssFeedItems(feed.id);

      if (result.count) {
        toast(
          `Loaded ${result.count} more video${result.count === 1 ? '' : 's'}`,
          'success'
        );
      } else if (result.skippedDuplicates) {
        toast(
          `No new videos found · skipped ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'}`,
          'success'
        );
      } else {
        toast('No more videos loaded', 'success');
      }

      await renderInbox();
    } catch (err) {
      toast(err?.message || 'Could not load more videos', 'error');

      btn.disabled = false;
      btn.innerHTML = `${lucide('list-plus', 14)} Load more videos`;
    }
  });

  wrap.append(meta, btn);

  return wrap;
}

async function renderInbox() {
  const seq = ++renderInboxSeq;

  if (!root) return;

  root.dataset.rssView = 'list';
  root.dataset.rssLayout = layoutMode;
  activeReaderItemId = '';

  const body = root.querySelector('[data-rss-body]');
  if (!body) return;

  const hadContent = body.childElementCount > 0;

  body.classList.toggle('grid', layoutMode === 'grid');
  body.classList.toggle('is-refreshing', hadContent);

  try {
    const feeds = await getRssFeeds();

    if (seq !== renderInboxSeq || !body.isConnected) return;

    const activeFeed = activeFeedFromList(feeds);
    const items = await loadVisibleItems();

    if (seq !== renderInboxSeq || !body.isConnected) return;

    const fragment = document.createDocumentFragment();

    if (!items.length) {
      fragment.append(el('div', { class: 'yanta-rss-empty' },
        currentMode === 'unread'
          ? 'No unread source items.'
          : searchQuery
            ? 'No source items match your search.'
            : 'No source items.'
      ));
    } else {
      const cards = await Promise.all(items.map((item) => renderItemCard(item)));

      if (seq !== renderInboxSeq || !body.isConnected) return;

      for (const card of cards) {
        fragment.append(card);
      }
    }

    if (activeFeed && isYoutubeFeed(activeFeed)) {
      const footer = await renderLoadMoreFooter(activeFeed);

      if (seq !== renderInboxSeq || !body.isConnected) return;

      fragment.append(footer);
    }

    if (seq !== renderInboxSeq || !body.isConnected) return;

    body.replaceChildren(fragment);
  } finally {
    if (seq === renderInboxSeq && body.isConnected) {
      body.classList.remove('is-refreshing');
    }
  }
}

function readerText(item) {
  return (
    item.contentText ||
    stripHtml(item.contentHtml || '') ||
    item.summaryText ||
    stripHtml(item.summaryHtml || '') ||
    ''
  ).trim();
}

function readerHtml(item) {
  return item.contentHtml || item.summaryHtml || '';
}

function textToReaderHtml(text = '') {
  const safe = escapeHtml(String(text || '').trim());

  if (!safe) return ' ';

  return safe
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function cleanMediaUrl(url = '') {
  const raw = String(url || '').trim();

  if (!raw) return '';

  try {
    const u = new URL(raw, location.href);

    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';

    return u.href;
  } catch {
    return '';
  }
}

function bindCustomAudioPlayer(box, audio) {
  if (!box || !audio || box.dataset.bound === '1') return;

  box.dataset.bound = '1';

  const play = box.querySelector('[data-audio-play]');
  const back = box.querySelector('[data-audio-back]');
  const fwd = box.querySelector('[data-audio-fwd]');
  const range = box.querySelector('[data-audio-range]');
  const current = box.querySelector('[data-audio-current]');
  const duration = box.querySelector('[data-audio-duration]');

  const fmt = (sec) => {
    const n = Math.max(0, Number(sec || 0));
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const update = () => {
    const dur = Number(audio.duration || 0);
    const cur = Number(audio.currentTime || 0);

    if (range) {
      range.max = dur ? String(dur) : '0';
      range.value = String(cur || 0);
    }

    if (current) current.textContent = fmt(cur);
    if (duration) duration.textContent = dur ? fmt(dur) : '0:00';

    if (play) {
      play.innerHTML = lucide(audio.paused ? 'play' : 'pause', 16);
      play.title = audio.paused ? 'Play' : 'Pause';
    }
  };

  play?.addEventListener('click', async () => {
    if (audio.paused) {
      await audio.play().catch(() => {});
    } else {
      audio.pause();
    }

    update();
  });

  back?.addEventListener('click', () => {
    audio.currentTime = Math.max(0, audio.currentTime - 15);
    update();
  });

  fwd?.addEventListener('click', () => {
    audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 30);
    update();
  });

  range?.addEventListener('input', () => {
    audio.currentTime = Number(range.value || 0);
    update();
  });

  audio.addEventListener('timeupdate', update);
  audio.addEventListener('durationchange', update);
  audio.addEventListener('play', update);
  audio.addEventListener('pause', update);

  update();
}

async function renderMediaBlock(item) {
  const mediaUrl = cleanMediaUrl(item.mediaUrl || '');
  const embedUrl = videoEmbedUrl(mediaUrl || item.url || '');

  if (isAudioItem(item) && mediaUrl) {
    const box = el('div', { class: 'yanta-rss-media-player audio rich' });

    const thumbSrc = await imageSrc(item.imageUrl);

    box.innerHTML = `
      <div class="yanta-rss-audio-cover">
        ${
          thumbSrc
            ? `<img src="${escapeAttr(thumbSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
            : lucide('podcast', 38)
        }
      </div>

      <div class="yanta-rss-audio-main">
        <div class="yanta-rss-audio-label">Podcast / Audio</div>
        <div class="yanta-rss-audio-title">${escapeHtml(item.title || 'Audio')}</div>
        <div class="yanta-rss-audio-feed">${escapeHtml(item.feedTitle || '')}</div>

        <audio preload="metadata" src="${escapeAttr(mediaUrl)}"></audio>

        <div class="yanta-rss-audio-controls">
          <div class="yanta-rss-controls-group">
            <button class="icon-btn" data-audio-back="" title="Back 15 seconds">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
            </button>
            
            <button class="icon-btn primary-round" data-audio-play="" title="Play">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
            </button>
            
            <button class="icon-btn" data-audio-fwd="" title="Forward 30 seconds">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>
            </button>
          </div>

          <div class="yanta-rss-timeline-group">
            <span data-audio-current="">0:00</span>
            <div class="range-container">
              <input type="range" min="0" max="3068.839125" value="0" step="0.1" data-audio-range="">
            </div>
            <span data-audio-duration="">51:08</span>
          </div>
        </div>
      </div>
    `;

    requestAnimationFrame(() => {
      bindCustomAudioPlayer(box, box.querySelector('audio'));
    });

    return box;
  }

  if (embedUrl) {
    const box = el('div', { class: 'yanta-rss-media-player video' });

    box.innerHTML = `
      <div class="yanta-rss-media-player-head" style="display:none;">
        ${lucide('play', 15)}
        <strong>Video</strong>
      </div>
      <iframe
        src="${escapeAttr(embedUrl)}"
        allowfullscreen
        frameborder="0"
        allow="autoplay; encrypted-media; picture-in-picture">
      </iframe>
    `;

    return box;
  }

  if (isVideoItem(item) && mediaUrl) {
    const box = el('div', { class: 'yanta-rss-media-player video-native' });

    box.innerHTML = `
      <div class="yanta-rss-media-player-head">
        ${lucide('play', 15)}
        <strong>Video</strong>
      </div>
      <video controls preload="metadata" src="${escapeAttr(mediaUrl)}"></video>
    `;

    return box;
  }

  return null;
}

function contentContainsImage(html = '', imageUrl = '') {
  if (!html || !imageUrl) return false;

  const normalized = normalizeUrl(imageUrl);

  const tpl = document.createElement('template');
  tpl.innerHTML = html;

  for (const img of tpl.content.querySelectorAll('img[src], img[data-src]')) {
    const src = normalizeUrl(img.getAttribute('src') || img.getAttribute('data-src') || '');

    if (src === normalized) return true;
  }

  return false;
}

async function renderMoreFromSameFeed(item) {
  const same = await listRssItems({
    feedId: item.feedId,
    unreadOnly: false,
    archived: false,
    limit: 16,
  });

  const items = dedupeRssItemsForDisplay(
    same.filter((x) => x.id !== item.id)
  ).slice(0, 8);

  if (!items.length) return null;

  const box = el('section', { class: 'yanta-rss-more' });

  box.innerHTML = `
    <div class="yanta-rss-more-head">
      ${lucide('list-video', 15)}
      <strong>More from ${escapeHtml(item.feedTitle || 'this source')}</strong>
    </div>
  `;

  const list = el('div', { class: 'yanta-rss-more-list' });

  for (const x of items) {
    const btn = el('button', {
      class: 'yanta-rss-more-item',
      type: 'button',
    });

    const src = await imageSrc(x.imageUrl);

    btn.innerHTML = `
      <span class="yanta-rss-more-thumb">
        ${
          src
            ? `<img src="${escapeAttr(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
            : lucide(isVideoItem(x) ? 'play' : isAudioItem(x) ? 'podcast' : 'rss', 16)
        }
      </span>
      <span class="yanta-rss-more-main">
        <strong>${escapeHtml(x.title || 'Untitled')}</strong>
        <small>${escapeHtml(fmtDate(x.publishedAt || x.discoveredAt))}</small>
      </span>
    `;

    btn.addEventListener('click', () => {
      renderReader(x.id).catch(() => {});
    });

    list.append(btn);
  }

  box.append(list);
  return box;
}

// Change the signature to accept options
async function renderReader(itemId, { fromHistory = false } = {}) {
  if (!root) return;

  const body = root.querySelector('[data-rss-body]');
  if (!body) return;

  const item = await getRssItem(itemId);
  if (!item) return;

  // Check if we are transitioning from the list to the reader
  const wasInList = root.dataset.rssView !== 'reader';
  
  root.dataset.rssView = 'reader';
  activeReaderItemId = item.id;

  if (!item.read) {
    requestAnimationFrame(() => {
      markRssItemRead(item.id, true).catch(() => {});
    });
  }

  body.replaceChildren();
  body.classList.remove('grid');

  const wrap = el('div', { class: 'yanta-rss-reader' });

  const head = el('div', { class: 'yanta-rss-reader-head' });

  const badge = mediaBadge(item);

  head.innerHTML = `
    <div class="yanta-rss-reader-kicker">
      ${escapeHtml(item.feedTitle || 'Source')}
      ${badge ? `<span>${lucide(badge.icon, 11)} ${escapeHtml(badge.label)}</span>` : ''}
    </div>

    <h2>${escapeHtml(item.title || 'Untitled')}</h2>

    <div class="yanta-rss-meta">
      ${escapeHtml([
        item.author || '',
        fmtDate(item.publishedAt || item.discoveredAt),
      ].filter(Boolean).join(' · '))}
    </div>
  `;

  const actions = el('div', {
    class: 'compress-actions yanta-rss-reader-actions',
  });

  const navGroup = el('div', { class: 'yanta-rss-action-group' });

  const back = el('button', {
    class: 'btn iconish',
    title: 'Back to list',
  });

  back.innerHTML = lucide('arrow-left', 15);
  
  back.addEventListener('click', () => {
    // Let the history router handle closing the reader
    closeTopOverlay(() => {});
  });

  const original = el('a', {
    class: 'btn iconish',
    href: item.url || '#',
    target: '_blank',
    rel: 'noopener noreferrer',
    title: 'Open original',
  });

  original.innerHTML = lucide('external-link', 15);

  navGroup.append(back, original);

  const saveGroup = el('div', { class: 'yanta-rss-action-group' });

  const star = el('button', {
    class: 'btn iconish',
    title: item.starred ? 'Unstar' : 'Star',
  });

  star.innerHTML = lucide('star', 15);
  star.classList.toggle('active', !!item.starred);

  star.addEventListener('click', async () => {
    try {
      await toggleRssItemStar(item.id);
      await renderReader(item.id);
    } catch (err) {
      toast(err?.message || 'Could not update item', 'error');
    }
  });

  const save = el('button', {
    class: 'btn primary compact',
    title: 'Save as note',
  });

  save.innerHTML = `${lucide('file-plus', 14)} <span>Save</span>`;

  save.addEventListener('click', async () => {
    try {
      const note = await saveRssItemAsNote(item.id);
      if (note?.id) await openNote(note.id);
    } catch (err) {
      toast(err?.message || 'Could not save item', 'error');
    }
  });

  const append = el('button', {
    class: 'btn iconish',
    title: 'Append to current note',
  });

  append.innerHTML = lucide('list-plus', 15);

  append.addEventListener('click', async () => {
    try {
      await appendRssItemToCurrentNote(item.id);
    } catch (err) {
      toast(err?.message || 'Could not append item', 'error');
    }
  });

  saveGroup.append(star, save, append);

  actions.append(navGroup, saveGroup);
  head.append(actions);
  wrap.append(head);

  const content = el('article', { class: 'yanta-rss-reader-content' });

  const cleanHtml = cleanFeedHtml(readerHtml(item));
  const text = readerText(item);

  const media = await renderMediaBlock(item);

  if (media) {
    content.append(media);
  }

  const showHero =
    item.imageUrl &&
    !isLikelyTrackingImageUrl(item.imageUrl) &&
    !contentContainsImage(cleanHtml, item.imageUrl) &&
    !isAudioItem(item) &&
    !isVideoItem(item);

  if (showHero) {
    const imgSrc = await imageSrc(item.imageUrl);

    if (imgSrc) {
      const hero = el('img', {
        class: 'yanta-rss-reader-hero',
        src: imgSrc,
        alt: '',
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
      });

      content.append(hero);
    }
  }

  const mainContent = el('div', { class: 'yanta-rss-original-html' });

  mainContent.innerHTML = cleanHtml || textToReaderHtml(text);

  content.append(mainContent);

  const description =
    item.mediaDescription ||
    (isVideoItem(item) ? item.summaryText || text : '');

  if (description && description.length > 420) {
    const details = el('details', { class: 'yanta-rss-description-details' });

    details.innerHTML = `
      <summary>${lucide('align-left', 14)} Description</summary>
      <div>${textToReaderHtml(description)}</div>
    `;

    content.append(details);
  }

  const more = await renderMoreFromSameFeed(item);

  if (more) {
    content.append(more);
  }

  wrap.append(content);
  body.append(wrap);
  
  // Push to history ONLY if we came from the list AND it wasn't triggered by the browser navigating
  if (wasInList && !fromHistory) {
    pushOverlayState('rss-reader', { rssItemId: item.id });
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

  box.querySelector('[data-rss-cloud-login]')?.addEventListener('click', async () => {
    try {
      await openYantaCloudLoginForSources();
      await renderShell();
    } catch (err) {
      console.error('[YANTA RSS] Could not open YANTA Cloud setup', err);
      toast('Could not open YANTA Cloud login', 'error');
    }
  });

  return box;
}

function tabButton(id, label, icon = '') {
  const btn = el('button', {
    class:
      'yanta-rss-tab' +
      (currentMode === id && !currentFeedId ? ' active' : ''),
    type: 'button',
  });

  btn.innerHTML = `${icon ? lucide(icon, 13) : ''}${escapeHtml(label)}`;

  btn.addEventListener('click', async () => {
    currentMode = id;
    currentFeedId = '';

    await renderShell();
  });

  return btn;
}

function isYoutubeFeed(feed = {}) {
  return (
    feed.sourceKind === 'youtube' ||
    !!feed.channelId ||
    /youtube\.com\/feeds\/videos\.xml/i.test(feed.feedUrl || '')
  );
}

function activeFeedFromList(feeds = []) {
  return currentFeedId
    ? feeds.find((f) => f.id === currentFeedId) || null
    : null;
}

function normalizeSourceTagInput(value = '') {
  return String(value || '')
    .trim()
    .replace(/^#/, '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function sourceTagButton({ tag, count }) {
  const btn = el('button', {
    class: 'yanta-rss-tab yanta-rss-tag-tab' + (currentSourceTag === tag ? ' active' : ''),
    type: 'button',
    title: `Filter sources tagged #${tag}`,
  });

  btn.innerHTML = `
    ${lucide('tag', 12)}
    <span>#${escapeHtml(tag)}</span>
    <small>${count}</small>
  `;

  btn.addEventListener('click', async () => {
    currentSourceTag = currentSourceTag === tag ? '' : tag;
    currentFeedId = '';

    await renderShell();
  });

  return btn;
}

function renderSourceTagsEditor(feed, {
  knownTags = [],
  onSaved,
} = {}) {
  let tags = [...new Set(feed.tags || [])];

  const wrap = el('div', { class: 'yanta-rss-source-tags-editor' });
  const chips = el('div', { class: 'yanta-rss-source-tags-chips' });

  const input = el('input', {
    class: 'yanta-rss-source-tags-input',
    placeholder: '+ tag',
    list: `rss-tags-${feed.id}`,
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const datalist = el('datalist', {
    id: `rss-tags-${feed.id}`,
  });

  for (const tag of knownTags) {
    datalist.append(el('option', {
      value: tag,
    }));
  }

  const save = async () => {
    const clean = [...new Set(
      tags
        .map(normalizeSourceTagInput)
        .filter(Boolean)
    )];

    await setRssFeedTags(feed.id, clean);

    tags = clean;

    window.dispatchEvent(new CustomEvent('yanta-rss-updated', {
      detail: {
        feedId: feed.id,
        localOnly: true,
        reason: 'source-tags',
      },
    }));

    await onSaved?.();
  };

  const renderChips = () => {
    chips.replaceChildren();

    for (const tag of tags) {
      const chip = el('button', {
        type: 'button',
        class: 'yanta-rss-source-tag-chip',
        title: `Remove #${tag}`,
      });

      chip.innerHTML = `#${escapeHtml(tag)} ${lucide('x', 11)}`;

      chip.addEventListener('click', async () => {
        tags = tags.filter((x) => x !== tag);
        renderChips();

        try {
          await save();
        } catch (err) {
          toast(err?.message || 'Could not save source tags', 'error');
        }
      });

      chips.append(chip);
    }
  };

  const addCurrentInputTag = async () => {
    const tag = normalizeSourceTagInput(input.value);

    if (!tag) return;

    if (!tags.includes(tag)) {
      tags.push(tag);
      renderChips();

      try {
        await save();
      } catch (err) {
        toast(err?.message || 'Could not save source tags', 'error');
      }
    }

    input.value = '';
  };

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      e.preventDefault();
      await addCurrentInputTag();
      return;
    }

    if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      renderChips();

      try {
        await save();
      } catch (err) {
        toast(err?.message || 'Could not save source tags', 'error');
      }
    }
  });

  input.addEventListener('blur', () => {
    addCurrentInputTag().catch(() => {});
  });

  renderChips();

  wrap.append(chips, input, datalist);

  return wrap;
}

function ensureSourcesModal() {
  if (sourcesModal) return sourcesModal;

  sourcesModal = document.createElement('div');
  sourcesModal.className = 'modal yanta-rss-sources-modal';
  sourcesModal.hidden = true;

  sourcesModal.addEventListener('click', (e) => {
    if (e.target === sourcesModal) {
      closeTopOverlay(closeRssSourcesManagerUI);
    }

    if (e.target.closest?.('[data-rss-sources-close]')) {
      closeTopOverlay(closeRssSourcesManagerUI);
    }
  });

  document.body.append(sourcesModal);

  return sourcesModal;
}

async function openRssSourcesManagerInternal() {
  const modal = ensureSourcesModal();

  const [feeds, settings] = await Promise.all([
    getRssFeeds(),
    getRssSettings(),
  ]);

  const knownTags = rssTagCountsFromFeeds(feeds).map((x) => x.tag);

  modal.innerHTML = `
    <div class="modal-card yanta-rss-sources-card">
      <header class="modal-head">
        <h3>Manage Sources</h3>
        <button class="icon-btn" data-rss-sources-close>&times;</button>
      </header>

      <div class="modal-body yanta-rss-sources-body">
        <section class="yanta-rss-source-settings">
          <label class="yanta-rss-source-toggle">
            <input type="checkbox" data-youtube-hide-shorts ${settings.youtubeHideShorts !== false ? 'checked' : ''} />
            <span>
              <strong>Hide YouTube Shorts</strong>
              <small>Only load normal videos from YouTube channels. Uses YouTube video metadata and is applied on refresh/load-more.</small>
            </span>
          </label>
        </section>

        <section>
          <div class="yanta-rss-source-list">
            ${
              feeds.length
                ? feeds.map((feed) => `
                  <div class="yanta-rss-source-row" data-feed-id="${escapeAttr(feed.id)}">
                    <span class="yanta-rss-source-row-icon">
                      ${lucide(isYoutubeFeed(feed) ? 'play' : 'rss', 17)}
                    </span>

                    <span class="yanta-rss-source-row-main">
                      <strong>${escapeHtml(feed.title || 'Source')}</strong>
                      <small>${escapeHtml(feed.feedUrl || '')}</small>

                      <div data-source-tags-host="${escapeAttr(feed.id)}"></div>

                      ${
                        feed.lastError
                          ? `<em>${escapeHtml(feed.lastError)}</em>`
                          : ''
                      }
                    </span>

                    <span class="yanta-rss-source-row-actions">
                      ${
                        isYoutubeFeed(feed)
                          ? `
                            <button class="btn" data-source-load-more="${escapeAttr(feed.id)}" title="Load more videos">
                              ${lucide('list-plus', 14)}
                              More
                            </button>
                          `
                          : ''
                      }

                      <button class="btn danger" data-source-delete="${escapeAttr(feed.id)}">
                        ${lucide('trash', 14)}
                        Delete
                      </button>
                    </span>
                  </div>
                `).join('')
                : `<div class="tree-empty">No sources yet.</div>`
            }
          </div>
        </section>
      </div>
    </div>
  `;

  for (const feed of feeds) {
    const host = modal.querySelector(
      `[data-source-tags-host="${CSS.escape(feed.id)}"]`
    );

    if (!host) continue;

    host.replaceChildren(
      renderSourceTagsEditor(feed, {
        knownTags,
        onSaved: async () => {
          await renderShell();
        },
      })
    );
  }

  modal.querySelector('[data-youtube-hide-shorts]')?.addEventListener('change', async (e) => {
    await saveRssSettings({
      youtubeHideShorts: !!e.target.checked,
    });

    toast(
      e.target.checked
        ? 'YouTube Shorts will be hidden'
        : 'YouTube Shorts will be included',
      'success'
    );
  });

  modal.querySelectorAll('[data-source-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const feedId = btn.dataset.sourceDelete || '';
      const feed = feeds.find((f) => f.id === feedId);

      if (!feed) return;

      const ok = await yantaConfirm({
        title: 'Delete source?',
        message: `Delete source "${feed.title || 'Source'}"?\n\nCached items may remain locally until cache cleanup.`,
        confirmLabel: 'Delete source',
        cancelLabel: 'Cancel',
        danger: true,
        icon: 'trash',
      });

      if (!ok) return;

      await deleteRssFeed(feedId);

      if (currentFeedId === feedId) {
        currentFeedId = '';
        currentMode = 'unread';
      }

      toast('Source deleted', 'success');

      await renderShell();
      await openRssSourcesManager();
    });
  });

  modal.querySelectorAll('[data-source-load-more]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const feedId = btn.dataset.sourceLoadMore || '';

      btn.disabled = true;
      btn.innerHTML = `${lucide('loader-circle', 14)} Loading…`;

      try {
        const result = await loadMoreRssFeedItems(feedId);

        toast(
          result.count
            ? `Loaded ${result.count} more video${result.count === 1 ? '' : 's'}`
            : 'No more videos loaded',
          'success'
        );

        await renderShell();
        await openRssSourcesManager();
      } catch (err) {
        toast(err?.message || 'Could not load more videos', 'error');

        btn.disabled = false;
        btn.innerHTML = `${lucide('list-plus', 14)} More`;
      }
    });
  });

  modal.hidden = false;
}

export async function openRssSourcesManager() {
  await openRssSourcesManagerInternal();
  pushOverlayState('rss-manage-sources');
}

async function renderShell() {
  injectCss();

  const node = ensureRoot();

  node.replaceChildren();

  const settings = await getRssSettings();
  const cloudAuth = settings.fetchProvider === 'yanta-cloud'
    ? await getRssCloudAuthState()
    : {
        authenticated: true,
        me: null,
        error: '',
      };

  const inSidePane = mode === 'pane';

  const head = el('header', {
    class: 'yanta-rss-head' + (inSidePane ? ' compact' : ''),
  });

  if (!inSidePane) {
    const title = el('div', { class: 'yanta-rss-head-title' });

    title.innerHTML = `
      ${lucide('rss', 17)}
      <span>
        <strong>YANTA Sources</strong>
        <small>RSS, Atom, Podcasts and Videos</small>
      </span>
    `;

    head.append(title);
  }

  // --- START EMBEDDED SEARCH CONTAINER ---
  const searchContainer = el('div', { class: 'yanta-rss-search-container' });
  const searchIcon = el('span', { class: 'yanta-rss-search-icon' });
  searchIcon.innerHTML = lucide('search', 14);

  const search = el('input', {
    class: 'text-input yanta-rss-search',
    type: 'search',
    placeholder: inSidePane ? 'Search…' : 'Search in your Sources…',
    value: searchQuery,
  });

  const searchClear = el('button', {
    class: 'yanta-rss-search-clear',
    type: 'button',
    title: 'Clear search',
  });
  searchClear.innerHTML = lucide('x', 14);
  searchClear.style.display = searchQuery ? 'inline-flex' : 'none';

  searchContainer.append(searchIcon, search, searchClear);

  search.addEventListener('focus', () => {
    head.classList.add('search-active');
  });

  search.addEventListener('blur', () => {
    setTimeout(() => {
      if (!search.value) {
        head.classList.remove('search-active');
      }
    }, 180);
  });

  search.addEventListener('input', () => {
    searchQuery = search.value || '';
    searchClear.style.display = searchQuery ? 'inline-flex' : 'none';
    renderInbox().catch(() => {});
  });

  searchClear.addEventListener('click', (e) => {
    e.stopPropagation();
    search.value = '';
    searchQuery = '';
    searchClear.style.display = 'none';
    renderInbox().catch(() => {});
    head.classList.remove('search-active');
    search.blur();
  });
  // --- END EMBEDDED SEARCH CONTAINER ---

  const refresh = el('button', {
    class: 'btn compact',
    title: 'Refresh sources',
  });

  refresh.innerHTML = lucide('refresh-cw', 15);

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

  const manageBtn = el('button', {
    class: 'btn compact yanta-rss-manage-btn',
    title: 'Manage sources',
  });

  manageBtn.innerHTML = `${lucide('settings-2', 14)} <span>Manage Sources</span>`;

  manageBtn.addEventListener('click', () => {
    openRssSourcesManager().catch((err) => {
      console.error(err);
      toast('Could not open source manager', 'error');
    });
  });

  const toggleAddBtn = el('button', {
    class: 'btn primary compact yanta-rss-add-toggle',
    title: addToolbarOpen ? 'Close add source' : 'Add source',
  });

  toggleAddBtn.innerHTML = addToolbarOpen
    ? `${lucide('x', 14)} <span>Add</span>`
    : `${lucide('grid-2x2-plus', 14)} <span>Add</span>`;

  toggleAddBtn.addEventListener('click', async () => {
    addToolbarOpen = !addToolbarOpen;

    await renderShell();

    if (addToolbarOpen) {
      requestAnimationFrame(() => {
        root?.querySelector('[data-rss-add-input]')?.focus();
      });
    }
  });

  head.append(searchContainer, refresh, manageBtn, toggleAddBtn);

  if (!inSidePane) {
    const expand = el('button', {
      class: mode === 'fullscreen' ? 'icon-btn panel-toggle isfullscreen' : 'icon-btn panel-toggle',
      title: mode === 'fullscreen' ? 'Dock to side pane' : 'Open fullscreen',
    });

    expand.innerHTML = lucide(mode === 'fullscreen' ? 'panel-right' : 'maximize-2', 16);

    expand.addEventListener('click', async () => {
      if (mode === 'fullscreen') {
        await openRssPane();
      } else {
        await openRssFullscreen();
      }
    });

    const close = el('button', {
      class: 'icon-btn',
      title: mode === 'fullscreen' ? 'Close Sources' : 'Close side pane',
    });

    close.innerHTML = lucide('x', 16);

    close.addEventListener('click', () => {
      if (mode === 'fullscreen') closeRssFullscreen();
      else closeSidePane();
    });

    head.append(expand, close);
  }

  node.append(head);

  if (settings.fetchProvider === 'yanta-cloud' && !cloudAuth.authenticated) {
    node.append(renderRssCloudLoginNotice({
      error: cloudAuth.error,
    }));

    return;
  }

  const feeds = await getRssFeeds();
  const activeFeed = activeFeedFromList(feeds);

  if (addToolbarOpen) {
    const toolbar = el('div', { class: 'yanta-rss-toolbar' });

    const addInput = el('input', {
      class: 'text-input',
      placeholder: 'Browse curated Sources or paste a feed / YouTube URL…',
      autocomplete: 'off',
      spellcheck: 'false',
      dataset: {
        rssAddInput: '1',
      },
    });

    const addBtn = el('button', { class: 'btn primary compact' });
    addBtn.innerHTML = `${lucide('grid-2x2-plus', 14)} Add`;

    const browseBtn = el('button', {
      class: 'btn yanta-rss-browse-btn',
      title: 'Browse curated sources',
    });

    browseBtn.innerHTML = `${lucide('layout-grid', 14)} <span>Browse curated Sources</span>`;

    browseBtn.addEventListener('click', async () => {
      await openRssSourceBrowser({
        onAdded: async () => {
          addToolbarOpen = false;
          await renderShell();
        },
      });
    });

    const runAdd = async () => {
      const input = addInput.value.trim();

      if (!input) return;

      addBtn.disabled = true;
      addInput.disabled = true;

      try {
        await addBestRssSourceFromInput(input, {
          onAdded: async () => {
            addInput.value = '';
          },
        });

        addToolbarOpen = false;
        await renderShell();
      } catch (err) {
        toast(err?.message || 'Could not add source', 'error');
      } finally {
        addBtn.disabled = false;
        addInput.disabled = false;
      }
    };

    addBtn.addEventListener('click', runAdd);

    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        addToolbarOpen = false;
        renderShell().catch(() => {});
        return;
      }

      if (e.key !== 'Enter') return;

      e.preventDefault();
      runAdd();
    });

    attachRssSourcePicker(addInput, {
      onAdded: async () => {
        addInput.value = '';
        addToolbarOpen = false;
        await renderShell();
      },
    });

    toolbar.append(addInput, browseBtn);
    node.append(toolbar);
  }

  const tabs = el('div', { class: 'yanta-rss-tabs' });

  tabs.append(
    tabButton('unread', 'Inbox', 'inbox'),
    tabButton('all', 'All', 'list'),
    tabButton('starred', 'Starred', 'star'),
    tabButton('archived', 'Archived', 'archive')
  );

  const tagCounts = rssTagCountsFromFeeds(feeds);

  if (tagCounts.length) {
    tabs.append(el('span', { class: 'yanta-rss-tabs-divider' }));

    for (const tagInfo of tagCounts.slice(0, inSidePane ? 12 : 32)) {
      tabs.append(sourceTagButton(tagInfo));
    }
  }

  if (!inSidePane && feeds.length) {
    tabs.append(el('span', { class: 'yanta-rss-tabs-divider' }));

    for (const feed of feeds) {
      const btn = el('button', {
        class: 'yanta-rss-tab' + (currentFeedId === feed.id ? ' active' : ''),
        title: feed.feedUrl,
        type: 'button',
      });

      btn.innerHTML = `
        ${lucide(isYoutubeFeed(feed) ? 'play' : 'rss', 12)}
        <span>${escapeHtml(feed.title || 'Source')}</span>
      `;

      btn.addEventListener('click', async () => {
        currentFeedId = feed.id;
        currentSourceTag = '';
        currentMode = 'all';

        try {
          await refreshRssFeed(feed.id);
        } catch {}

        await renderShell();
      });

      tabs.append(btn);
    }
  }

  const listBody = el('div', {
    class: 'yanta-rss-body',
    dataset: {
      rssBody: '1',
    },
  });

  node.append(tabs, listBody);

  await renderInbox();
}

export async function openRssPane() {
  ensureRoot();

  await withRssViewTransition(() => {
    const fs = ensureFullscreenHost();
    fs.hidden = true;
    fs.classList.remove('active');
    fs.replaceChildren();

    const body = openSidePane({
      kind: 'rss',
      title: 'Sources',
      icon: 'rss',
      className: 'yanta-rss-side-pane',
      onClose: () => {},
    });

    if (!body) return;

    mode = 'pane';
    body.replaceChildren(root);
  });

  addToolbarOpen = false;

  await renderShell();
}

async function openRssFullscreenInternal() {
  ensureRoot();
  const fs = ensureFullscreenHost();

  await withRssViewTransition(() => {
    if (isSidePaneOpen('rss')) {
      closeSidePane({ silent: true });
    }

    mode = 'fullscreen';
    fs.hidden = false;
    fs.classList.add('active');
    fs.replaceChildren(root);
  });

  await renderShell();
}

export async function openRssFullscreen() {
  await openRssFullscreenInternal();
  pushOverlayState('rss-fullscreen');
}

export function closeRssFullscreenUI() {
  if (!fullscreenHost) return;

  fullscreenHost.hidden = true;
  fullscreenHost.classList.remove('active');
  fullscreenHost.replaceChildren();

  if (mode === 'fullscreen') {
    mode = 'pane';
  }
}

export function closeRssFullscreen() {
  closeTopOverlay(closeRssFullscreenUI);
}

export function closeRssSourcesManagerUI() {
  if (sourcesModal) {
    sourcesModal.hidden = true;
  }
}

export async function openRssInbox() {
  return openRssPane();
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

.yanta-rss-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yanta-rss-head > * {
  flex-shrink: 0;
}

.yanta-rss-head-title {
  flex-shrink: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.yanta-rss-head-title > svg {
  color: var(--accent);
}

.yanta-rss-head-title span {
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 1px;
}

.yanta-rss-head-title strong {
  color: var(--text);
  font-size: 13px;
  line-height: 1.2;
}

.yanta-rss-head-title small {
  color: var(--text-faint);
  font-size: 10px;
  line-height: 1.1;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Suchleiste und Animationen */
.yanta-rss-search-container {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  max-width: 180px;
  transition: max-width 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.yanta-rss-head.search-active .yanta-rss-search-container,
.yanta-rss-search-container:focus-within {
  max-width: 320px;
}

.yanta-rss-search {
  width: 100%;
  padding-left: 32px !important;
  padding-right: 32px !important;
  margin: 0;
  height: 34px;
}

.yanta-rss-search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-faint);
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.yanta-rss-search-clear {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 50%;
  z-index: 2;
  transition: color 120ms ease, background-color 120ms ease;
}

.yanta-rss-search-clear:hover {
  color: var(--text);
  background-color: var(--border-strong);
}

.yanta-rss-toolbar {
  flex: 0 0 auto;

  display: flex;
  align-items: center;
  gap: 7px;

  padding: 10px;
  border-bottom: 1px solid var(--border);

  background: var(--bg-elev);
}

.yanta-rss-toolbar input {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.yanta-rss-tabs {
  flex: 0 0 auto;

  display: flex;
  gap: 4px;

  padding: 8px 10px;
  border-bottom: 1px solid var(--border);

  overflow: auto;
  min-height: 42px;
}

.yanta-rss-tab {
  border: 1px solid var(--border);
  border-radius: 999px;

  background: var(--bg-elev-2);
  color: var(--text-dim);

  display: inline-flex;
  align-items: center;
  gap: 5px;

  padding: 6px 10px;

  font-size: 12px;
  font-weight: 700;

  cursor: pointer;
  white-space: nowrap;

  transition:
    color 120ms ease,
    border-color 120ms ease,
    background-color 120ms ease,
    transform 120ms ease;
}

.yanta-rss-tab:hover {
  color: var(--text);
  border-color: var(--border-strong);
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

  scroll-behavior: smooth;
}

.yanta-rss-body.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  align-content: start;
  gap: 10px;
}

.yanta-rss-body.grid .yanta-rss-item {
  margin: 0;
  grid-template-columns: 1fr;
}

.yanta-rss-body.grid .yanta-rss-thumb {
  width: 100%;
  height: 132px;
}

.yanta-rss-body.grid .yanta-rss-actions {
  margin-top: auto;
}

.yanta-rss-item {
  position: relative;
  width: 100%;

  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;

  padding: 10px;
  margin-bottom: 8px;

  border: none;
  border-radius: 13px;

  background: var(--bg-elev-2);
  color: var(--text);

  text-align: left;
  cursor: pointer;

  display: flex;
  flex-direction: column;
  background: transparent;
  padding: 0;

  transform: translateY(0px);

  animation: yanta-rss-card-in 150ms cubic-bezier(.2,.8,.2,1);

  transition:
    opacity 120ms ease,
    transform 120ms ease,
    border-color 120ms ease,
    background-color 120ms ease;
}

.yanta-rss-item:hover {
  border-color: var(--border-strong);
  background: var(--bg-elev-3);
}

.yanta-rss-item.read {
  opacity: 0.68;
}

.yanta-rss-item.starred {
  border-color: color-mix(in srgb, var(--yellow) 40%, var(--border));
}

.yanta-rss-thumb {
  width: 76px;
  height: 58px;

  border-radius: 10px;
  background: var(--bg);
  border: 1px solid var(--border);

  overflow: hidden;

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--text-faint);
}

.yanta-rss-thumb.media {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--bg));
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
  padding: 0 10px;
}

.yanta-rss-title-row {
  min-width: 0;

  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 7px;
}

.yanta-rss-title {
  flex: 1;
  min-width: 0;

  color: var(--text);

  font-size: 13px;
  font-weight: 850;
  line-height: 1.3;
}

.yanta-rss-media-badge {
  flex: 0 0 auto;

  display: inline-flex;
  align-items: center;
  gap: 4px;

  padding: 2px 6px;
  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);

  font-size: 10px;
  font-weight: 850;
}

.yanta-rss-meta {
  color: var(--text-faint);
  font-size: 11px;
}

.yanta-rss-excerpt {
  color: var(--text-dim);

  font-size: 12px;
  line-height: 1.42;

  overflow-wrap: anywhere;
}

.yanta-rss-actions {
  position: absolute;
  width: 100%;
  top: 0;
  right: 0;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 10px 10px 0 0;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.04) inset;
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
  pointer-events: none;
  transition: opacity 130ms ease, transform 150ms cubic-bezier(.2, .8, .2, 1);
}

.yanta-rss-item:hover .yanta-rss-actions,
.yanta-rss-item:focus-within .yanta-rss-actions,
.yanta-rss-item.actions-open .yanta-rss-actions {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.btn.iconish,
.yanta-rss-action-group .btn.iconish {
  min-width: 34px;
  width: 34px;
  height: 34px;
  padding: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn.compact {
  min-height: 34px;
  padding: 7px 10px;
}

.btn.iconish.active {
  color: var(--yellow);
  border-color: color-mix(in srgb, var(--yellow) 45%, var(--border));
  background: color-mix(in srgb, var(--yellow) 9%, transparent);
}

.yanta-rss-empty {
  margin: 18px;
  padding: 22px;

  border: 1px dashed var(--border);
  border-radius: 14px;

  color: var(--text-faint);
  text-align: center;
  font-size: 13px;
}

/* Reader */
.yanta-rss-reader {
  max-width: 920px;
  margin: 0 auto;

  display: flex;
  flex-direction: column;
  gap: 12px;

  animation: yanta-rss-reader-in 170ms cubic-bezier(.2,.8,.2,1);
}

.yanta-rss-reader-head {
  padding: 16px;

  border: 1px solid var(--border);
  border-radius: 16px;

  background: var(--bg-elev-2);
}

.yanta-rss-reader-kicker {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;

  color: var(--accent);

  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  margin-bottom: 6px;
}

.yanta-rss-reader-kicker span {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  padding: 2px 7px;
  border-radius: 999px;

  letter-spacing: 0;
  text-transform: none;

  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.yanta-rss-reader-head h2 {
  margin: 0 0 6px;

  color: var(--text);

  font-size: clamp(20px, 3vw, 34px);
  line-height: 1.14;
  letter-spacing: -0.02em;
}

.yanta-rss-reader-actions {
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;

  margin-top: 12px;
}

.yanta-rss-action-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  min-width: 0;
}

.yanta-rss-reader-content {
  padding: clamp(16px, 4vw, 34px);
  border-radius: 18px;

  background: var(--bg);
  color: var(--text);

  font-size: 16px;
  line-height: 1.72;

  overflow-wrap: anywhere;
}

.yanta-rss-reader-content p {
  margin: 0 0 1em;
}

.yanta-rss-reader-content h1,
.yanta-rss-reader-content h2,
.yanta-rss-reader-content h3,
.yanta-rss-reader-content h4 {
  margin: 1.15em 0 0.45em;
  line-height: 1.22;
}

.yanta-rss-reader-content a {
  color: var(--accent);
}

.yanta-rss-reader-content img {
  max-width: 100%;
  height: auto;

  border-radius: 12px;
}

.yanta-rss-reader-hero {
  display: block;

  width: 100%;
  max-height: 380px;
  object-fit: cover;

  margin: 0 0 22px;

  border-radius: 16px;
}

.yanta-rss-media-player {
  margin: 0 0 22px;
  padding: 12px;

  border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border));
  border-radius: 18px;

  background: color-mix(in srgb, var(--accent) 7%, var(--bg-elev-2));
}

.yanta-rss-media-player-head {
  display: flex;
  align-items: center;
  gap: 7px;

  margin-bottom: 9px;

  color: var(--accent);
  font-size: 12px;
  font-weight: 850;
}

.yanta-rss-media-player iframe {
  width: 100%;
  aspect-ratio: 16 / 9;

  border: 0;
  border-radius: 12px;

  background: #000;
}

.yanta-rss-media-player.video {
  width: 100%;
  border-radius: 12px;
  padding: 0;
  background: none;
  border: none;
}

.yanta-rss-media-player.audio.rich {
  display: grid;
  grid-template-columns: 136px minmax(0, 1fr);
  gap: 14px;

  padding: 14px;

  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 14%, var(--bg-elev-2)),
      var(--bg-elev-2)
    );
}

.yanta-rss-audio-cover {
  width: 136px;
  height: 136px;

  border-radius: 16px;
  overflow: hidden;

  display: flex;
  align-items: center;
  justify-content: center;

  background: var(--bg);
  color: var(--accent);
}

.yanta-rss-audio-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.yanta-rss-audio-main {
  min-width: 0;

  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
}

.yanta-rss-audio-label {
  color: var(--accent);
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.yanta-rss-audio-title {
  color: var(--text);
  font-size: 17px;
  font-weight: 850;
  line-height: 1.2;
}

.yanta-rss-audio-feed {
  color: var(--text-faint);
  font-size: 12px;
}

.yanta-rss-audio-controls {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 2px;
  border-radius: 12px;
  margin-top: 10px;
}

.yanta-rss-controls-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
  // padding: 8px;
  border-radius: 50%;
  transition: color 0.2s ease, transform 0.1s ease, background-color 0.2s ease;
}

.icon-btn:hover {
  color: var(--text);
  background-color: rgba(0, 0, 0, 0.04);
}

.icon-btn:active {
  transform: scale(0.95);
}

.yanta-rss-audio-controls .primary-round {
  width: 40px;
  height: 40px;
  background: var(--accent);
  color: #fff;
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.yanta-rss-audio-controls .primary-round:hover {
  background: var(--accent);
  transform: scale(1.04);
  filter: brightness(1.05);
}

.yanta-rss-audio-controls .primary-round:active {
  transform: scale(0.95);
}

.yanta-rss-timeline-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-grow: 1;
}

.yanta-rss-timeline-group span {
  color: var(--text-faint);
  font-size: 11px;
  font-family: var(--font-mono), monospace;
  min-width: 38px;
  user-select: none;
}

.yanta-rss-timeline-group span[data-audio-duration] {
  text-align: right;
}

.range-container {
  position: relative;
  flex-grow: 1;
  display: flex;
  align-items: center;
}

.yanta-rss-audio-controls input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  background: transparent;
  margin: 0;
  height: 16px;
  cursor: pointer;
}

.yanta-rss-audio-controls input[type="range"]:focus {
  outline: none;
}

.yanta-rss-audio-controls input[type="range"]::-webkit-slider-runnable-track {
  width: 100%;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  transition: background 0.2s ease;
}

.yanta-rss-audio-controls input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  height: 12px;
  width: 12px;
  border-radius: 50%;
  background: var(--accent);
  margin-top: -4px;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.yanta-rss-audio-controls input[type="range"]::-moz-range-track {
  width: 100%;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
}

.yanta-rss-audio-controls input[type="range"]::-moz-range-thumb {
  height: 12px;
  width: 12px;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.yanta-rss-timeline-group:hover input[type="range"]::-webkit-slider-thumb,
.yanta-rss-timeline-group:hover input[type="range"]::-moz-range-thumb {
  opacity: 1;
}

.yanta-rss-timeline-group:hover input[type="range"]::-webkit-slider-runnable-track {
  background: rgba(0, 0, 0, 0.15);
}

.yanta-rss-description-details summary {
  cursor: pointer;

  display: flex;
  align-items: center;
  gap: 7px;

  padding: 10px 12px;

  color: var(--text);
  font-size: 13px;
  font-weight: 800;

  background: var(--bg-elev-2);

  border-radius: 12px;
}

.yanta-rss-description-details > div {
  padding: 14px;
  color: var(--text-dim);
}

.yanta-rss-more {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.yanta-rss-more-head {
  display: flex;
  align-items: center;
  gap: 8px;

  color: var(--text);
  font-size: 13px;
  margin-bottom: 10px;
}

.yanta-rss-more-head svg {
  color: var(--accent);
}

.yanta-rss-more-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
}

.yanta-rss-more-item {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 8px;

  padding: 8px;

  border: 1px solid var(--border);
  border-radius: 12px;

  background: var(--bg-elev);
  color: var(--text);

  text-align: left;
  cursor: pointer;
}

.yanta-rss-more-item:hover {
  border-color: var(--border-strong);
  background: var(--bg-elev-2);
}

.yanta-rss-more-thumb {
  width: 54px;
  height: 42px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 8px;
  overflow: hidden;

  background: var(--bg);
  color: var(--accent);
}

.yanta-rss-more-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.yanta-rss-more-main {
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yanta-rss-more-main strong {
  color: var(--text);
  font-size: 12px;
  line-height: 1.25;

  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.yanta-rss-more-main small {
  color: var(--text-faint);
  font-size: 10px;
}

/* Cloud auth */
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

/* Fullscreen */
.yanta-rss-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 50;

  background: var(--bg);
  color: var(--text);

  padding:
    max(0px, env(safe-area-inset-top))
    max(0px, env(safe-area-inset-right))
    max(0px, env(safe-area-inset-bottom))
    max(0px, env(safe-area-inset-left));

  animation: yanta-rss-fullscreen-in 160ms cubic-bezier(.2,.8,.2,1);
}

.yanta-rss-fullscreen[hidden] {
  display: none !important;
}

.yanta-rss-fullscreen .yanta-rss-root {
  width: 100%;
  height: 100%;
}

.yanta-rss-side-pane .yanta-side-pane-body {
  padding: 0 !important;
}

::view-transition-old(yanta-rss-sources),
::view-transition-new(yanta-rss-sources) {
  animation-duration: 210ms;
  animation-timing-function: cubic-bezier(.2,.8,.2,1);
}

@keyframes yanta-rss-card-in {
  from {
    opacity: 0;
    transform: translateY(5px) scale(0.992);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes yanta-rss-reader-in {
  from {
    opacity: 0;
    transform: translateY(7px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes yanta-rss-fullscreen-in {
  from {
    opacity: 0;
    transform: scale(0.992);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.yanta-rss-sources-card {
  width: min(760px, 94vw);
  max-height: min(780px, 92vh);
}

.yanta-rss-sources-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.yanta-rss-source-settings {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
}

.yanta-rss-source-toggle {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  cursor: pointer;
}

.yanta-rss-source-toggle input {
  margin-top: 3px;
  accent-color: var(--accent);
}

.yanta-rss-source-toggle span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yanta-rss-source-toggle strong {
  color: var(--text);
  font-size: 13px;
}

.yanta-rss-source-toggle small {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.4;
}

.yanta-rss-source-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-rss-source-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;

  padding: 10px;

  border: 1px solid var(--border);
  border-radius: 12px;

  background: var(--bg-elev-2);
}

.yanta-rss-source-row-icon {
  width: 38px;
  height: 38px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.yanta-rss-source-row-main {
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-rss-source-row-main strong {
  color: var(--text);
  font-size: 13px;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-rss-source-row-main small,
.yanta-rss-source-row-main em {
  color: var(--text-faint);
  font-size: 11px;
  overflow-wrap: anywhere;
  font-style: normal;
}

.yanta-rss-source-row-main em {
  color: var(--red);
}

.yanta-rss-source-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.yanta-rss-load-more-footer {
  grid-column: 1 / -1;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  margin: 12px 0 6px;
  padding: 14px;

  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 14px;

  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2)),
      var(--bg-elev-2)
    );
}

.yanta-rss-load-more-meta {
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yanta-rss-load-more-meta strong {
  color: var(--text);
  font-size: 13px;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-rss-load-more-meta small {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.4;
}

@media (max-width: 760px) {
  .yanta-rss-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .yanta-rss-head-title small {
    display: none;
  }

  /* Initiale Icon-Form auf Mobilgeräten */
  .yanta-rss-search-container {
    max-width: 34px;
    height: 34px;
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--bg-elev-3);
    transition: 
      max-width 200ms cubic-bezier(0.2, 0.8, 0.2, 1), 
      border-radius 200ms ease, 
      background-color 200ms ease;
  }

  .yanta-rss-search-container:not(.search-active):not(:focus-within) .yanta-rss-search {
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    color: transparent !important;
    cursor: pointer;
  }

  .yanta-rss-search-container:not(.search-active):not(:focus-within) .yanta-rss-search::placeholder {
    color: transparent !important;
  }

  .yanta-rss-search-container:not(.search-active):not(:focus-within) .yanta-rss-search-icon {
    left: 0;
    right: 0;
    margin: auto;
    width: 100%;
    height: 100%;
  }

  /* Expandierter Zustand auf Mobilgeräten */
  .yanta-rss-head.search-active .yanta-rss-search-container {
    max-width: 100%;
    height: 36px;
    border-radius: 8px;
    background: var(--bg);
    flex-grow: 1;
    border-color: var(--border-strong);
  }

  .yanta-rss-head.search-active .yanta-rss-search {
    padding-left: 32px !important;
    padding-right: 32px !important;
    background: var(--bg);
    color: var(--text);
  }

  .yanta-rss-head.search-active .yanta-rss-search-icon {
    left: 10px;
  }

  /* Verstecke alle anderen Header-Elemente, wenn die Suche aktiv ist */
  .yanta-rss-head.search-active > :not(.yanta-rss-search-container) {
    display: none !important;
  }

  .panel-toggle.isfullscreen {
    display:none;
  }

  button.btn.primary.compact.yanta-rss-add-toggle span {
    display: none;
  }

  .yanta-rss-toolbar {
    flex-wrap: wrap;
    padding: 8px;
  }

  .yanta-rss-toolbar input {
    flex: 1 1 100%;
  }

  .yanta-rss-toolbar .btn {
    flex: 0 0 auto;
  }

  .yanta-rss-item {
    grid-template-columns: 58px minmax(0, 1fr);
  }

  .yanta-rss-thumb {
    width: 58px;
    height: 48px;
  }

  .yanta-rss-body.grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .yanta-rss-body.grid .yanta-rss-thumb {
    height: 92px;
  }

  .yanta-rss-body.grid .yanta-rss-excerpt {
    display: none;
  }

  .yanta-rss-reader-actions {
    justify-content: flex-start;
  }

  .yanta-rss-cloud-notice {
    flex-direction: column;
  }

  .yanta-rss-cloud-notice .btn {
    width: 100%;
    justify-content: center;
  }

  .yanta-rss-reader-content {
    border-radius: 14px;
    font-size: 15px;
  }

  .yanta-rss-media-player.audio.rich {
    grid-template-columns: 1fr;
  }

  .yanta-rss-audio-cover {
    width: 100%;
    height: 180px;
  }

  .yanta-rss-audio-controls {
    flex-direction: column;
    gap: 14px;
    align-items: stretch;
  }

  .yanta-rss-timeline-group {
    order: 1;
    width: 100%;
  }

  .yanta-rss-controls-group {
    order: 2;
    justify-content: center;
    width: 100%;
    gap: 20px;
  }

  .yanta-rss-audio-controls input[type="range"]::-webkit-slider-thumb {
    opacity: 1;
    height: 14px;
    width: 14px;
    margin-top: -5px;
  }
  
  .yanta-rss-audio-controls input[type="range"]::-moz-range-thumb {
    opacity: 1;
    height: 14px;
    width: 14px;
  }

  .yanta-rss-source-row {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .yanta-rss-source-row-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .yanta-rss-load-more-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .yanta-rss-load-more-footer .btn {
    justify-content: center;
  }
}

@media (hover: none), (pointer: coarse) {
  .yanta-rss-actions {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
    pointer-events: none;
    transition: opacity 130ms ease, transform 150ms cubic-bezier(.2, .8, .2, 1);
  }

  .yanta-rss-item.actions-open .yanta-rss-actions {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .yanta-rss-actions .btn {
    min-height: 30px;
    height: 30px;
  }

  .yanta-rss-actions .btn.iconish {
    width: 30px;
    min-width: 30px;
    height: 30px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .yanta-rss-fullscreen,
  .yanta-rss-item,
  .yanta-rss-reader,
  .yanta-rss-tab {
    animation: none !important;
    transition: none !important;
  }
}

/* Compact side pane adjustments */
.yanta-rss-head.compact .yanta-rss-search-container {
  max-width: 140px;
}

.yanta-rss-head.compact.search-active .yanta-rss-search-container,
.yanta-rss-head.compact .yanta-rss-search-container:focus-within {
  max-width: 100%;
}

.yanta-rss-manage-btn,
.yanta-rss-add-toggle,
.yanta-rss-browse-btn {
  white-space: nowrap;
}

.yanta-rss-tabs-divider {
  width: 1px;
  min-width: 1px;
  height: 22px;
  margin: 0 4px;

  background: var(--border);
}

.yanta-rss-tag-tab small {
  margin-left: 2px;
  color: var(--text-faint);
  font-size: 10px;
}

.yanta-rss-tab.active small {
  color: color-mix(in srgb, var(--accent) 72%, var(--text-faint));
}

/* RSS source tags editor */
.yanta-rss-source-tags-editor {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;

  margin-top: 6px;
}

.yanta-rss-source-tags-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.yanta-rss-source-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  min-height: 22px;
  padding: 2px 7px;

  border: 1px solid var(--border);
  border-radius: 999px;

  background: var(--bg-elev);
  color: var(--text-dim);

  font-size: 11px;
  cursor: pointer;
}

.yanta-rss-source-tag-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.yanta-rss-source-tags-input {
  width: 86px;
  min-height: 24px;

  border: 1px dashed var(--border);
  border-radius: 999px;

  background: transparent;
  color: var(--text);

  padding: 2px 8px;

  font-size: 11px;
  outline: none;
}

.yanta-rss-source-tags-input:focus {
  border-style: solid;
  border-color: var(--accent);
  background: var(--bg-elev);
}

@media (max-width: 760px) {
  .yanta-rss-head.compact {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
  }

  .yanta-rss-head.compact .yanta-rss-search {
    display: block;
  }

  .yanta-rss-manage-btn span,
  .yanta-rss-browse-btn span {
    display: none;
  }

  .yanta-rss-toolbar {
    padding: 8px;
  }

  .yanta-rss-toolbar .btn {
    flex: 0 0 auto;
  }
}

.yanta-rss-mobile-close-actions {
  display: none !important;
}

@media (hover: none), (pointer: coarse) {
  .yanta-rss-mobile-close-actions {
    display: inline-flex !important;
    color: var(--text-dim) !important;
    opacity: 0.85;
  }
  .yanta-rss-mobile-close-actions:active {
    color: var(--text) !important;
    opacity: 1;
  }
}

.yanta-rss-body.is-refreshing {
  opacity: 0.96;
}

.yanta-rss-body.is-refreshing .yanta-rss-item {
  animation: none;
}
  `;

  document.head.append(style);
}

export function setupRss() {
  if (initialized) return;

  initialized = true;

  // Listen for native browser navigation (back/forward)
  window.addEventListener('yanta-overlay-route', (e) => {
    const { id, state } = e.detail;
    
    if (id === 'rss-fullscreen') {
      if (!fullscreenHost || fullscreenHost.hidden) {
        openRssFullscreenInternal();
      }
      if (sourcesModal && !sourcesModal.hidden) {
        closeRssSourcesManagerUI();
      }
      // If we are in the reader view, go back to the list
      if (root && root.dataset.rssView === 'reader') {
        renderInbox().catch(() => {});
      }
    } else if (id === 'rss-manage-sources') {
      if (!fullscreenHost || fullscreenHost.hidden) {
        openRssFullscreenInternal();
      }
      if (!sourcesModal || sourcesModal.hidden) {
        openRssSourcesManagerInternal();
      }
    } else if (id === 'rss-reader') {
      if (!fullscreenHost || fullscreenHost.hidden) {
        openRssFullscreenInternal();
      }
      if (sourcesModal && !sourcesModal.hidden) {
        closeRssSourcesManagerUI();
      }
      // Pass fromHistory: true so it doesn't push a duplicate state
      if (state?.rssItemId && state.rssItemId !== activeReaderItemId) {
        renderReader(state.rssItemId, { fromHistory: true }).catch(() => {});
      }
    } else {
      // Target is null (base app). Close everything.
      if (sourcesModal && !sourcesModal.hidden) {
        closeRssSourcesManagerUI();
      }
      if (fullscreenHost && !fullscreenHost.hidden) {
        closeRssFullscreenUI();
      }
    }
  });

  window.yantaRss = {
    open: openRssPane,
    openPane: openRssPane,
    openFullscreen: openRssFullscreen,
    refreshAll: refreshAllRssFeeds,
  };

  installPreviewPaneSwitcherObserver();

  window.addEventListener('yanta-open-rss', () => {
    openRssPane().catch((err) => {
      console.error(err);
      toast('Could not open Sources', 'error');
    });
  });

  window.addEventListener('yanta-open-rss-fullscreen', () => {
    openRssFullscreen().catch((err) => {
      console.error(err);
      toast('Could not open Sources', 'error');
    });
  });

  window.addEventListener('yanta-side-pane-switch', (e) => {
    if (e.detail?.kind !== 'rss') return;

    openRssPane().catch((err) => {
      console.error(err);
      toast('Could not open Sources', 'error');
    });
  });

  window.addEventListener('yanta-side-pane-expand', (e) => {
    if (e.detail?.kind !== 'rss') return;

    openRssFullscreen().catch((err) => {
      console.error(err);
      toast('Could not expand Sources', 'error');
    });
  });

  window.addEventListener('yanta-side-pane-close-request', (e) => {
    if (e.detail?.kind !== 'rss') return;

    closeSidePane();
  });

  window.addEventListener('touchstart', (e) => {
    if (!e.target.closest('.yanta-rss-actions')) {
      document.querySelectorAll('.yanta-rss-item.actions-open').forEach((node) => {
        node.classList.remove('actions-open');
      });
    }
  }, { passive: true });

  window.addEventListener('yanta-rss-updated', (e) => {
    if (!root?.isConnected) return;

    if (root.dataset.rssView === 'reader') {
      const itemId = e.detail?.itemId || '';
      if (itemId && itemId === activeReaderItemId) return;
    }

    scheduleRenderInbox();
  });

  window.setTimeout(async () => {
    try {
      const settings = await getRssSettings();

      if (!settings.enabled || !settings.refreshOnStartup) return;

      if (settings.fetchProvider === 'yanta-cloud') {
        const auth = await getRssCloudAuthState();

        if (!auth.authenticated) return;
      }

      await refreshAllRssFeeds({
        force: false,
      });
    } catch {}
  }, 3500);
}
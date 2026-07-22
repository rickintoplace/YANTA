// ============================================================
// YANTA Chat — Emoji & sticker panel (WhatsApp/Telegram-style)
//
// Docked above the composer. Two tabs:
// - Emoji: full Unicode emoji set (unicode-emoji-json, lazy chunk),
//   grouped with category quick-nav, search and recents.
// - Stickers: Personal Library drawings + MSC2545 user image pack.
// ============================================================

import {
  el,
  escapeHtml,
  lucide,
  toast,
  debounce,
} from '../core.js';

import {
  chatSettings,
} from './chat-store.js';

import {
  listLibraryStickerItems,
  listLibraryStickerGroups,
  listUserPackStickers,
  sendStickerMessage,
  stickerForLibraryItem,
} from './chat-stickers.js';

import {
  mxcToBlobUrl,
} from './chat-media.js';

import {
  registerOverlayRoute,
  pushOverlayState,
  closeTopOverlay,
  overlayIdFromState,
} from '../overlay-history.js';

const RECENT_EMOJI_KEY = 'chat.recentEmoji.v1';
const RECENT_EMOJI_LIMIT = 36;
const SEARCH_RESULT_LIMIT = 120;

const GROUP_ICONS = {
  'Smileys & Emotion': 'smile',
  'People & Body': 'hand',
  'Animals & Nature': 'leaf',
  'Food & Drink': 'coffee',
  'Travel & Places': 'plane',
  'Activities': 'trophy',
  'Objects': 'lightbulb',
  'Symbols': 'heart',
  'Flags': 'flag',
};

let emojiGroupsPromise = null;
const panelsByForm = new WeakMap();

/*
  Warum overlay-history: Auf Android soll Geräte-Back ein offenes
  Emoji-/Sticker-Panel schließen (WhatsApp-Verhalten) — nicht den Raum
  oder gleich den ganzen Chat.
*/
const CHAT_EXPRESSIONS_OVERLAY_ID = 'chat-expressions';

let expressionsRouteRegistered = false;
let openPanelRef = null; // the currently open panel element
let lastToggleArgs = null; // for forward-restore via history

function registerExpressionsRoute() {
  if (expressionsRouteRegistered) return;

  expressionsRouteRegistered = true;

  registerOverlayRoute(CHAT_EXPRESSIONS_OVERLAY_ID, {
    open: async () => {
      if (lastToggleArgs?.form?.isConnected && !openPanelRef?.isConnected) {
        toggleChatExpressions({
          ...lastToggleArgs,
          fromHistory: true,
        });
      }
    },

    close: () => {
      destroyPanel(openPanelRef);
    },

    isOpen: () => !!openPanelRef?.isConnected,
  });
}

function idle(fn) {
  if ('requestIdleCallback' in window) {
    return requestIdleCallback(fn, {
      timeout: 900,
    });
  }

  return setTimeout(fn, 40);
}

function loadEmojiGroups() {
  if (!emojiGroupsPromise) {
    emojiGroupsPromise = import('unicode-emoji-json/data-by-group.json')
      .then((mod) => mod.default || mod)
      .catch((err) => {
        emojiGroupsPromise = null;
        throw err;
      });
  }

  return emojiGroupsPromise;
}

async function readRecentEmoji() {
  try {
    const list = await chatSettings.get(RECENT_EMOJI_KEY, []);
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function rememberRecentEmoji(emoji) {
  try {
    const list = await readRecentEmoji();
    const next = [emoji, ...list.filter((x) => x !== emoji)].slice(0, RECENT_EMOJI_LIMIT);
    await chatSettings.set(RECENT_EMOJI_KEY, next);
  } catch (err) {
    console.warn('[YANTA Chat Expressions] Could not save recent emoji', err);
  }
}

function insertIntoTextarea(textArea, text) {
  if (!textArea) return;

  const start = textArea.selectionStart ?? textArea.value.length;
  const end = textArea.selectionEnd ?? start;

  textArea.setRangeText(text, start, end, 'end');

  // Autogrow, draft persistence and send/mic morph all listen on 'input'.
  textArea.dispatchEvent(new Event('input', {
    bubbles: true,
  }));

  /*
    Nur auf feinen Pointern fokussieren: auf Touch würde der Fokus die
    Bildschirmtastatur über das Panel schieben (WhatsApp-Verhalten: Panel
    ersetzt die Tastatur).
  */
  if (window.matchMedia('(pointer: fine)').matches) {
    textArea.focus();
  }
}

function emojiButton(entry, onPick) {
  const btn = el('button', {
    type: 'button',
    class: 'yanta-chat-emoji-btn',
    title: entry.name || '',
    onclick: () => onPick(entry.emoji),
  }, entry.emoji);

  return btn;
}

let emojiRenderToken = 0;

function renderEmojiGroupsProgressively({
  host,
  groups,
  recents,
  onPick,
}) {
  /*
    Progressive Idle-Renderings können sich überlappen (Suche ↔ Browse,
    Tab-Wechsel). Der Token entwertet alte, noch anstehende Callbacks.
  */
  const token = String(++emojiRenderToken);
  host.dataset.renderToken = token;

  host.replaceChildren();

  const sections = [];

  if (recents.length) {
    sections.push({
      name: 'Recently used',
      slug: 'recent',
      emojis: recents.map((emoji) => ({
        emoji,
        name: '',
      })),
    });
  }

  sections.push(...groups);

  let index = 0;

  const renderNext = () => {
    // Suche/Tab-Wechsel hat den Host inzwischen neu befüllt — abbrechen.
    if (!host.isConnected) return;
    if (host.dataset.mode !== 'browse' || host.dataset.renderToken !== token) return;
    if (index >= sections.length) return;

    const group = sections[index++];

    const section = el('section', {
      class: 'yanta-chat-emoji-group',
      dataset: {
        group: group.slug || group.name,
      },
    });

    section.append(el('h5', {}, group.name));

    const grid = el('div', {
      class: 'yanta-chat-emoji-grid',
    });

    for (const entry of group.emojis || []) {
      grid.append(emojiButton(entry, onPick));
    }

    section.append(grid);
    host.append(section);

    idle(renderNext);
  };

  host.dataset.mode = 'browse';
  renderNext();
}

function renderEmojiSearchResults({
  host,
  groups,
  query,
  onPick,
}) {
  host.dataset.mode = 'search';
  host.replaceChildren();

  const q = query.toLowerCase();
  const grid = el('div', {
    class: 'yanta-chat-emoji-grid',
  });

  let count = 0;

  for (const group of groups) {
    for (const entry of group.emojis || []) {
      if (count >= SEARCH_RESULT_LIMIT) break;

      if (
        entry.name?.includes(q) ||
        entry.slug?.includes(q.replace(/\s+/g, '_'))
      ) {
        grid.append(emojiButton(entry, onPick));
        count++;
      }
    }

    if (count >= SEARCH_RESULT_LIMIT) break;
  }

  if (!count) {
    host.append(el('div', {
      class: 'yanta-chat-expressions-empty',
    }, 'No matching emoji.'));
    return;
  }

  host.append(grid);
}

function stickerTile({
  title,
  onSend,
}) {
  const tile = el('button', {
    type: 'button',
    class: 'yanta-chat-sticker-tile',
    title,
  });

  tile.innerHTML = `<span class="yanta-chat-spinner"></span>`;

  tile.addEventListener('click', async () => {
    if (tile.classList.contains('is-sending')) return;

    tile.classList.add('is-sending');

    try {
      await onSend();
    } catch (err) {
      console.warn('[YANTA Chat Expressions] Could not send sticker', err);
      toast('Could not send sticker.', 'error');
    } finally {
      tile.classList.remove('is-sending');
    }
  });

  return tile;
}

function setTileImage(tile, url, alt = '') {
  if (!url) {
    tile.innerHTML = `<span class="yanta-chat-sticker-tile-fallback">${lucide('image-off', 18)}</span>`;
    return;
  }

  tile.replaceChildren(el('img', {
    src: url,
    alt,
    loading: 'lazy',
    decoding: 'async',
  }));
}

async function renderStickerTab(panel, {
  getClient,
  getRoomId,
  onStickerSent,
}) {
  const host = panel.querySelector('[data-expressions-body]');
  const client = getClient?.();

  host.dataset.mode = 'stickers';
  host.replaceChildren();

  const libraryItems = await listLibraryStickerItems();
  const libraryGroups = await listLibraryStickerGroups();
  const packStickers = client ? listUserPackStickers(client) : [];
  const linkedIds = new Set(packStickers.map((s) => s.libraryItemId).filter(Boolean));

  const sendAndClose = async (sticker) => {
    const roomId = getRoomId?.();

    if (!client || !roomId) {
      toast('Open a chat first.', 'error');
      return;
    }

    /*
      Close the panel FIRST — while its overlay history entry is guaranteed to
      be on top — so closeTopOverlay()'s history.back() pops the panel entry
      (panel -> room). Closing AFTER the async send let the send's timeline
      re-render mutate chat history in between, so back() then popped the room
      entry itself (room -> list), throwing the user out of the conversation.
    */
    closePanel(panel);

    await sendStickerMessage(client, roomId, sticker);

    onStickerSent?.();
  };

  // Own drawings first (empty group name), then one section per imported
  // Excalidraw library — keeps a large imported pack from burying the user's
  // own stickers.
  for (const group of libraryGroups) {
    host.append(el('h5', {
      class: 'yanta-chat-expressions-heading',
    }, group.name || 'Personal Library'));

    const grid = el('div', {
      class: 'yanta-chat-sticker-grid',
    });

    for (const item of group.items) {
      const tile = stickerTile({
        title: item.name || 'Sticker',
        onSend: async () => {
          // First send exports + uploads the drawing, later sends reuse it.
          const sticker = await stickerForLibraryItem(getClient?.(), item);
          await sendAndClose(sticker);
        },
      });

      grid.append(tile);

      import('../draw.js')
        .then(({ drawLibraryItemThumbnailUrl }) => drawLibraryItemThumbnailUrl(item.id))
        .then((url) => setTileImage(tile, url, item.name || 'Sticker'))
        .catch(() => setTileImage(tile, ''));
    }

    host.append(grid);
  }

  const extraPackStickers = packStickers.filter(
    (s) => !s.libraryItemId || !libraryItems.some((item) => String(item.id) === s.libraryItemId)
  );

  if (extraPackStickers.length) {
    host.append(el('h5', {
      class: 'yanta-chat-expressions-heading',
    }, 'My sticker pack'));

    const grid = el('div', {
      class: 'yanta-chat-sticker-grid',
    });

    for (const sticker of extraPackStickers) {
      const tile = stickerTile({
        title: sticker.body || sticker.shortcode,
        onSend: () => sendAndClose(sticker),
      });

      grid.append(tile);

      mxcToBlobUrl(client, sticker.url, {
        thumbnail: true,
        w: 256,
        h: 256,
      })
        .then((url) => setTileImage(tile, url, sticker.body || 'Sticker'))
        .catch(() => setTileImage(tile, ''));
    }

    host.append(grid);
  }

  if (!libraryItems.length && !extraPackStickers.length) {
    const empty = el('div', {
      class: 'yanta-chat-expressions-empty',
    });

    empty.innerHTML = `
      <div>${lucide('shapes', 26)}</div>
      <strong>No stickers yet</strong>
      <p>Open a drawing and use “Add to Library” — every Personal Library item becomes a sticker you can send here.</p>
    `;

    host.append(empty);
  }
}

async function renderEmojiTab(panel, {
  textArea,
}) {
  const host = panel.querySelector('[data-expressions-body]');
  const searchInput = panel.querySelector('[data-expressions-search]');
  const catbar = panel.querySelector('[data-expressions-catbar]');

  host.dataset.mode = 'browse';
  host.replaceChildren(el('div', {
    class: 'yanta-chat-expressions-empty',
  }, el('span', { class: 'yanta-chat-spinner' })));

  let groups;

  try {
    groups = await loadEmojiGroups();
  } catch (err) {
    console.warn('[YANTA Chat Expressions] Could not load emoji data', err);
    host.replaceChildren(el('div', {
      class: 'yanta-chat-expressions-empty',
    }, 'Could not load emoji.'));
    return;
  }

  // Tab wurde inzwischen gewechselt.
  if (panel.dataset.activeTab !== 'emoji') return;

  const recents = await readRecentEmoji();

  const onPick = (emoji) => {
    insertIntoTextarea(textArea, emoji);
    rememberRecentEmoji(emoji);
  };

  renderEmojiGroupsProgressively({
    host,
    groups,
    recents,
    onPick,
  });

  if (catbar) {
    catbar.replaceChildren();
    catbar.hidden = false;

    const entries = [
      ...(recents.length ? [{ slug: 'recent', name: 'Recently used', icon: 'clock' }] : []),
      ...groups.map((g) => ({
        slug: g.slug || g.name,
        name: g.name,
        icon: GROUP_ICONS[g.name] || 'smile',
      })),
    ];

    for (const entry of entries) {
      const btn = el('button', {
        type: 'button',
        class: 'icon-btn',
        title: entry.name,
        'aria-label': entry.name,
        onclick: () => {
          host.querySelector(`[data-group="${CSS.escape(entry.slug)}"]`)
            ?.scrollIntoView({ block: 'start' });
        },
      });
      btn.innerHTML = lucide(entry.icon, 16);
      catbar.append(btn);
    }
  }

  const runSearch = debounce(() => {
    const query = String(searchInput?.value || '').trim();

    if (panel.dataset.activeTab !== 'emoji') return;

    if (!query) {
      readRecentEmoji().then((freshRecents) => {
        if (panel.dataset.activeTab !== 'emoji') return;
        renderEmojiGroupsProgressively({
          host,
          groups,
          recents: freshRecents,
          onPick,
        });
      });
      return;
    }

    renderEmojiSearchResults({
      host,
      groups,
      query,
      onPick,
    });
  }, 80);

  searchInput.oninput = runSearch;
}

function setActiveTab(panel, tab, context) {
  panel.dataset.activeTab = tab;

  panel.querySelectorAll('[data-expressions-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.expressionsTab === tab);
  });

  const searchInput = panel.querySelector('[data-expressions-search]');
  const catbar = panel.querySelector('[data-expressions-catbar]');

  if (searchInput) {
    searchInput.value = '';
    // Sticker packs are small — search only applies to emoji.
    searchInput.parentElement.hidden = tab !== 'emoji';
  }

  if (catbar) {
    catbar.hidden = tab !== 'emoji';
  }

  if (tab === 'stickers') {
    renderStickerTab(panel, context).catch((err) => {
      console.warn('[YANTA Chat Expressions] Sticker tab failed', err);
      toast('Could not load stickers.', 'error');
    });
  } else {
    renderEmojiTab(panel, context).catch((err) => {
      console.warn('[YANTA Chat Expressions] Emoji tab failed', err);
      toast('Could not load emoji.', 'error');
    });
  }
}

function buildPanel(context) {
  const panel = el('section', {
    class: 'yanta-chat-expressions',
    role: 'dialog',
    'aria-label': 'Emoji and stickers',
  });

  panel.innerHTML = `
    <header class="yanta-chat-expressions-head">
      <nav class="yanta-chat-expressions-tabs" role="tablist">
        <button type="button" class="yanta-chat-expressions-tab" data-expressions-tab="emoji" role="tab">
          ${lucide('smile', 15)} Emoji
        </button>
        <button type="button" class="yanta-chat-expressions-tab" data-expressions-tab="stickers" role="tab">
          ${lucide('shapes', 15)} Stickers
        </button>
      </nav>

      <span class="yanta-chat-expressions-search">
        ${lucide('search', 14)}
        <input
          type="search"
          placeholder="Search emoji…"
          autocomplete="off"
          spellcheck="false"
          data-expressions-search>
      </span>
    </header>

    <div class="yanta-chat-expressions-body" data-expressions-body></div>

    <nav class="yanta-chat-expressions-catbar" data-expressions-catbar hidden></nav>
  `;

  panel.querySelectorAll('[data-expressions-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveTab(panel, btn.dataset.expressionsTab || 'emoji', context);
    });
  });

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePanel(panel);
    }
  });

  return panel;
}

function destroyPanel(panel) {
  if (!panel) return;

  if (openPanelRef === panel) openPanelRef = null;

  panel.remove();
}

// User-initiated close: pop the panel's history entry so Back stays in sync.
function closePanel(panel) {
  if (!panel) return;

  if (
    panel === openPanelRef &&
    overlayIdFromState() === CHAT_EXPRESSIONS_OVERLAY_ID
  ) {
    closeTopOverlay(() => destroyPanel(panel));
    return;
  }

  destroyPanel(panel);
}

/**
 * Toggles the emoji/sticker panel for a composer form.
 */
export function toggleChatExpressions({
  form,
  textArea,
  getClient,
  getRoomId,
  onStickerSent = null,
  fromHistory = false,
} = {}) {
  if (!form) return;

  registerExpressionsRoute();

  const existing = panelsByForm.get(form);

  if (existing?.isConnected) {
    closePanel(existing);
    panelsByForm.delete(form);
    return;
  }

  const host = form.closest('.yanta-chat-composer-wrap') || form.parentElement;

  if (!host) {
    toast('Could not open emoji panel.', 'error');
    console.warn('[YANTA Chat Expressions] Composer host missing');
    return;
  }

  const context = {
    textArea,
    getClient,
    getRoomId,
    onStickerSent,
  };

  const panel = buildPanel(context);

  host.prepend(panel);
  panelsByForm.set(form, panel);
  openPanelRef = panel;
  lastToggleArgs = { form, textArea, getClient, getRoomId, onStickerSent };

  if (!fromHistory && overlayIdFromState() !== CHAT_EXPRESSIONS_OVERLAY_ID) {
    pushOverlayState(CHAT_EXPRESSIONS_OVERLAY_ID, {});
  }

  setActiveTab(panel, 'emoji', context);
}

/**
 * Closes the panel of a composer form (e.g. on room switch).
 */
export function closeChatExpressions(form) {
  const panel = form ? panelsByForm.get(form) : null;

  if (panel) {
    closePanel(panel);
    panelsByForm.delete(form);
  }
}

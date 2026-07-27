// ============================================================
// YANTA Chat — AP7 local encrypted message search
//
// E2EE: Server-side search is intentionally not possible/reliable because
// Matrix homeservers only see ciphertext. YANTA indexes decrypted plaintext
// locally after messages become available on this device.
// ============================================================

import {
    el,
    escapeHtml,
    lucide,
    toast,
    debounce,
  } from '../core.js';
  
  import {
    chatStore,
  } from './chat-store.js';
  
  import {
    ensureMatrixLoaded,
  } from './matrix-session.js';

  import {
    scoreText,
    snippetFor,
    tokenizeQuery,
  } from '../text-search.js';

  const SEARCH_LIMIT = 100;
  const BACKFILL_BATCH_SIZE = 50;
  
  let EventTimeline = null;
  let TimelineWindow = null;
  
  let overlay = null;
  let roomPanel = null;
  let roomPanelState = {
    roomId: '',
    roomName: '',
    results: [],
    active: 0,
    onJump: null,
  };
  
  function idle(fn) {
    if ('requestIdleCallback' in window) {
      return requestIdleCallback(fn, {
        timeout: 1800,
      });
    }
  
    return setTimeout(fn, 80);
  }
  
  async function ensureMatrixSdkClasses() {
    if (TimelineWindow && EventTimeline) return;
  
    const { sdk } = await ensureMatrixLoaded();
  
    TimelineWindow = sdk.TimelineWindow;
    EventTimeline = sdk.EventTimeline;
  }
  
  function eventIdOf(event) {
    return event?.getId?.() || event?.event?.event_id || '';
  }
  
  function roomIdOf(event, fallbackRoomId = '') {
    return event?.getRoomId?.() || event?.event?.room_id || fallbackRoomId || '';
  }
  
  function eventTsOf(event) {
    return Number(event?.getTs?.() || event?.event?.origin_server_ts || 0);
  }
  
  function senderOf(event) {
    return event?.getSender?.() || event?.event?.sender || '';
  }
  
  function clearContentOf(event) {
    try {
      return event?.getClearContent?.() || event?.getContent?.() || event?.event?.content || {};
    } catch (err) {
      console.warn('[YANTA Chat Search] Could not read event content', err);
      toast('Could not read message for search.', 'error');
      return {};
    }
  }
  
  function textFromEvent(event) {
    const type = event?.getType?.() || event?.event?.type || '';
  
    if (type !== 'm.room.message' && type !== 'm.sticker') return '';
  
    const content = clearContentOf(event);
    const msgtype = String(content?.msgtype || '');
  
    if (
      msgtype &&
      ![
        'm.text',
        'm.notice',
        'm.emote',
        'm.image',
        'm.file',
        'm.audio',
        'm.video',
      ].includes(msgtype)
    ) {
      return '';
    }
  
    const body = String(content?.body || '').trim();
  
    if (!body) return '';
  
    return body;
  }
  
  function searchKey(roomId, eventId) {
    return `${roomId}::${eventId}`;
  }
  
  /**
   * Indexes one decrypted Matrix text event for local E2EE search.
   */
  export async function indexDecryptedTextEvent(event, {
    roomId = '',
  } = {}) {
    try {
      const eventId = eventIdOf(event);
      const finalRoomId = roomIdOf(event, roomId);
      const body = textFromEvent(event);
  
      if (!eventId || !finalRoomId || !body) return false;
  
      /*
        Warum:
        Matrix E2EE verhindert Server-Suche. Wir speichern nur lokal den
        entschlüsselten Lowercase-Haystack, sobald der Client ihn sehen darf.
      */
      await chatStore.searchIndex.put({
        id: searchKey(finalRoomId, eventId),
        key: searchKey(finalRoomId, eventId),
        roomId: finalRoomId,
        eventId,
        ts: eventTsOf(event),
        sender: senderOf(event),
        text: body.toLowerCase(),
        body,
        updatedAt: Date.now(),
      });
  
      return true;
    } catch (err) {
      console.warn('[YANTA Chat Search] Could not index message', err);
      toast('Could not update chat search index.', 'error');
      return false;
    }
  }
  
  /**
   * Indexes all decrypted text events in a loaded timeline slice.
   */
  export async function indexTimelineEventsForSearch(events = [], {
    roomId = '',
  } = {}) {
    for (const event of events || []) {
      await indexDecryptedTextEvent(event, {
        roomId,
      });
    }
  }
  
  /**
   * Searches the local decrypted Chat search index.
   */
  export async function searchChatMessages(query, {
    roomId = '',
    limit = SEARCH_LIMIT,
  } = {}) {
    const clean = String(query || '').trim().toLowerCase();
    const tokens = tokenizeQuery(clean);
  
    if (!clean || !tokens.length) return [];
  
    try {
      const out = [];
  
      await chatStore.searchIndex.cursor({
        indexName: roomId ? 'roomId' : '',
        query: roomId ? IDBKeyRange.only(roomId) : null,
        direction: 'prev',
        onValue: (row) => {
          const score = scoreText(row.text || '', clean, tokens);
  
          if (!score) return true;
  
          out.push({
            ...row,
            score,
            snippet: snippetFor(row.body || row.text || '', clean),
          });
  
          // Cursor darf etwas mehr sammeln, danach wird sauber gescored.
          return out.length < limit * 4;
        },
      });
  
      return out
        .sort((a, b) => {
          const byScore = Number(b.score || 0) - Number(a.score || 0);
          if (byScore) return byScore;
  
          return Number(b.ts || 0) - Number(a.ts || 0);
        })
        .slice(0, limit)
        .sort((a, b) => {
          // Final UX: newest first inside the high-quality result set.
          const byTime = Number(b.ts || 0) - Number(a.ts || 0);
          if (byTime) return byTime;
  
          return Number(b.score || 0) - Number(a.score || 0);
        });
    } catch (err) {
      console.warn('[YANTA Chat Search] Search failed', err);
      toast('Could not search messages.', 'error');
      return [];
    }
  }
  
  /**
   * Incrementally backfills older messages of one room into the local index.
   */
  export async function backfillRoomSearchIndex(client, roomId, {
    onProgress = null,
    maxEvents = 5000,
  } = {}) {
    if (!client || !roomId) {
      toast('Chat is not connected.', 'error');
      console.warn('[YANTA Chat Search] Missing client or roomId for backfill');
      return {
        indexed: 0,
        scanned: 0,
      };
    }
  
    await ensureMatrixSdkClasses();
  
    const room = client.getRoom?.(roomId);
  
    if (!room) {
      toast('Chat room not found.', 'error');
      console.warn('[YANTA Chat Search] Room not found for backfill', roomId);
      return {
        indexed: 0,
        scanned: 0,
      };
    }
  
    const win = new TimelineWindow(client, room, {
      windowLimit: Math.min(Math.max(maxEvents, BACKFILL_BATCH_SIZE), 5000),
    });
  
    let scanned = 0;
    let indexed = 0;
  
    try {
      await win.load(undefined, BACKFILL_BATCH_SIZE);
  
      while (scanned < maxEvents) {
        const events = win.getEvents?.() || [];
        const slice = events.slice(Math.max(0, events.length - BACKFILL_BATCH_SIZE));
  
        for (const ev of slice) {
          scanned++;
  
          if (await indexDecryptedTextEvent(ev, {
            roomId,
          })) {
            indexed++;
          }
  
          if (scanned >= maxEvents) break;
        }
  
        onProgress?.({
          scanned,
          indexed,
          done: false,
        });
  
        await new Promise((resolve) => idle(resolve));
  
        const canMore =
          typeof win.canPaginate === 'function'
            ? win.canPaginate(EventTimeline.BACKWARDS)
            : scanned < maxEvents;
  
        if (!canMore) break;
  
        const before = win.getEvents?.().length || 0;
  
        await win.paginate(EventTimeline.BACKWARDS, BACKFILL_BATCH_SIZE);
  
        const after = win.getEvents?.().length || 0;
  
        if (after <= before) break;
      }
  
      onProgress?.({
        scanned,
        indexed,
        done: true,
      });
  
      toast(`Search index updated: ${indexed} messages`, 'success');
  
      return {
        scanned,
        indexed,
      };
    } catch (err) {
      console.warn('[YANTA Chat Search] Backfill failed', err);
      toast('Could not index older messages.', 'error');
  
      return {
        scanned,
        indexed,
        error: err,
      };
    }
  }
  
  function roomNameFor(client, roomId) {
    try {
      const room = client?.getRoom?.(roomId);
  
      return room?.name || room?.getDefaultRoomName?.(client?.getUserId?.()) || roomId;
    } catch {
      return roomId;
    }
  }
  
  function groupedByRoom(results = []) {
    const map = new Map();
  
    for (const item of results) {
      if (!map.has(item.roomId)) map.set(item.roomId, []);
      map.get(item.roomId).push(item);
    }
  
    return map;
  }
  
  function ensureCss() {
    if (document.getElementById('yanta-chat-search-css')) return;
  
    const style = document.createElement('style');
  
    style.id = 'yanta-chat-search-css';
    style.textContent = `
  .yanta-chat-search-overlay {
    position: fixed;
    inset: 0;
    z-index: 1320;
    display: grid;
    place-items: start center;
    padding: 7vh 18px 18px;
    background: rgba(0,0,0,.42);
    backdrop-filter: blur(14px);
  }
  
  .yanta-chat-search-overlay[hidden] {
    display: none !important;
  }
  
  .yanta-chat-search-card {
    width: min(760px, 96vw);
    max-height: min(760px, 88vh);
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 22px;
    background: var(--bg-elev);
    box-shadow: 0 28px 90px rgba(0,0,0,.46);
  }
  
  .yanta-chat-search-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 13px 14px;
    border-bottom: 1px solid var(--border);
  }
  
  .yanta-chat-search-input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 17px;
  }
  
  .yanta-chat-search-body {
    overflow: auto;
    padding: 12px;
  }
  
  .yanta-chat-search-empty {
    min-height: 220px;
    display: grid;
    place-items: center;
    color: var(--text-faint);
    text-align: center;
  }
  
  .yanta-chat-search-group-title {
    margin: 10px 4px 7px;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: .08em;
  }
  
  .yanta-chat-search-result {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    padding: 11px 12px;
    border: 1px solid transparent;
    border-radius: 15px;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  
  .yanta-chat-search-result:hover,
  .yanta-chat-search-result.active {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    background: color-mix(in srgb, var(--accent) 9%, transparent);
  }
  
  .yanta-chat-search-result strong {
    display: block;
    margin-bottom: 3px;
    color: var(--text);
    font-size: 13px;
  }
  
  .yanta-chat-search-result small {
    color: var(--text-faint);
    font-size: 11px;
  }
  
  .yanta-chat-search-snippet {
    color: var(--text-dim);
    line-height: 1.38;
    font-size: 12px;
  }
  
  .yanta-chat-room-search-panel {
    position: absolute;
    right: 12px;
    top: 58px;
    z-index: 5;
    width: min(420px, calc(100vw - 24px));
    max-height: min(520px, 70vh);
    display: grid;
    grid-template-rows: auto auto 1fr;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--bg-elev);
    box-shadow: 0 18px 60px rgba(0,0,0,.34);
  }
  
  .yanta-chat-room-search-panel[hidden] {
    display: none !important;
  }
  
  .yanta-chat-room-search-head,
  .yanta-chat-room-search-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }
  
  .yanta-chat-room-search-head input {
    min-width: 0;
    flex: 1;
  }
  
  .yanta-chat-room-search-results {
    overflow: auto;
    padding: 8px;
  }
  `;
  
    document.head.append(style);
  }
  
  function ensureOverlay() {
    if (overlay) return overlay;
  
    ensureCss();
  
    overlay = el('div', {
      class: 'yanta-chat-search-overlay',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Search messages',
    });
  
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest?.('[data-chat-search-close]')) {
        closeGlobalChatSearch();
      }
    });
  
    document.body.append(overlay);
  
    return overlay;
  }
  
  function renderResultsList({
    host,
    client,
    results,
    activeIndex = -1,
    onJump,
  }) {
    host.replaceChildren();
  
    if (!results.length) {
      host.append(el('div', {
        class: 'yanta-chat-search-empty',
      }, el('div', {}, lucide('search', 28), el('p', {}, 'No matching messages.'))));
  
      return;
    }
  
    const groups = groupedByRoom(results);
    let globalIndex = 0;
  
    for (const [roomId, rows] of groups) {
      host.append(el('div', {
        class: 'yanta-chat-search-group-title',
      }, roomNameFor(client, roomId)));
  
      for (const row of rows) {
        const idx = globalIndex++;
  
        const btn = el('button', {
          class: `yanta-chat-search-result ${idx === activeIndex ? 'active' : ''}`,
          type: 'button',
          onclick: () => onJump?.(row),
        });
  
        btn.innerHTML = `
          <span>
            <strong>${escapeHtml(row.sender || 'Unknown sender')}</strong>
            <span class="yanta-chat-search-snippet">${escapeHtml(row.snippet || row.body || '')}</span>
          </span>
          <small>${escapeHtml(row.ts ? new Date(row.ts).toLocaleString() : '')}</small>
        `;
  
        host.append(btn);
      }
    }
  }
  
  /**
   * Opens the global Chat message search overlay.
   */
  export function openGlobalChatSearch({
    client,
    onJump,
    initialQuery = '',
  } = {}) {
    if (!client) {
      toast('Chat is not connected.', 'error');
      console.warn('[YANTA Chat Search] Missing client for global search');
      return;
    }
  
    const node = ensureOverlay();
  
    node.hidden = false;
  
    node.innerHTML = `
      <section class="yanta-chat-search-card">
        <header class="yanta-chat-search-head">
          ${lucide('search', 18)}
          <input class="yanta-chat-search-input" type="search" placeholder="Search encrypted messages…" autocomplete="off" spellcheck="false">
          <button class="icon-btn" data-chat-search-close title="Close" aria-label="Close">
            ${lucide('x', 18)}
          </button>
        </header>
        <div class="yanta-chat-search-body"></div>
      </section>
    `;
  
    const input = node.querySelector('input');
    const body = node.querySelector('.yanta-chat-search-body');
  
    const run = debounce(async () => {
      const query = input.value.trim();
  
      if (!query) {
        body.replaceChildren(el('div', {
          class: 'yanta-chat-search-empty',
        }, el('div', {}, lucide('search', 28), el('p', {}, 'Type to search locally decrypted messages.'))));
  
        return;
      }
  
      const results = await searchChatMessages(query);
  
      renderResultsList({
        host: body,
        client,
        results,
        onJump,
      });
    }, 90);
  
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeGlobalChatSearch();
      }
    });

    if (initialQuery) {
      input.value = String(initialQuery);
    }

    run();

    setTimeout(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  }
  
  /**
   * Closes the global Chat message search overlay.
   */
  export function closeGlobalChatSearch() {
    if (overlay) overlay.hidden = true;
  }
  
  function ensureRoomPanel(container) {
    if (roomPanel && roomPanel.isConnected) return roomPanel;
  
    ensureCss();
  
    roomPanel = el('section', {
      class: 'yanta-chat-room-search-panel',
      hidden: true,
      role: 'dialog',
      'aria-label': 'Search in this chat',
    });
  
    container.append(roomPanel);
  
    return roomPanel;
  }
  
  async function jumpActiveRoomResult() {
    const item = roomPanelState.results[roomPanelState.active];
  
    if (!item) return;
  
    await roomPanelState.onJump?.(item);
  }
  
  function renderRoomPanel(client) {
    if (!roomPanel) return;
  
    const count = roomPanelState.results.length;
    const active = count ? roomPanelState.active + 1 : 0;
  
    roomPanel.innerHTML = `
      <header class="yanta-chat-room-search-head">
        ${lucide('search', 15)}
        <input class="text-input" type="search" placeholder="Search this chat…" autocomplete="off" spellcheck="false" data-room-search-input>
        <button class="icon-btn" data-close title="Close" aria-label="Close">${lucide('x', 16)}</button>
      </header>
  
      <div class="yanta-chat-room-search-nav">
        <small class="muted">${active}/${count}</small>
        <span class="grow"></span>
        <button class="icon-btn" data-prev title="Previous result" aria-label="Previous result">${lucide('chevron-up', 16)}</button>
        <button class="icon-btn" data-next title="Next result" aria-label="Next result">${lucide('chevron-down', 16)}</button>
      </div>
  
      <div class="yanta-chat-room-search-results"></div>
    `;
  
    const input = roomPanel.querySelector('[data-room-search-input]');
    const resultsHost = roomPanel.querySelector('.yanta-chat-room-search-results');
  
    renderResultsList({
      host: resultsHost,
      client,
      results: roomPanelState.results,
      activeIndex: roomPanelState.active,
      onJump: async (row) => {
        roomPanelState.active = Math.max(0, roomPanelState.results.findIndex((x) => x.id === row.id));
        await roomPanelState.onJump?.(row);
        renderRoomPanel(client);
      },
    });
  
    const run = debounce(async () => {
      const q = input.value.trim();
  
      roomPanelState.results = q
        ? await searchChatMessages(q, {
            roomId: roomPanelState.roomId,
          })
        : [];
  
      roomPanelState.active = 0;
  
      renderRoomPanel(client);
  
      const nextInput = roomPanel.querySelector('[data-room-search-input]');
      if (nextInput) {
        nextInput.value = q;
        nextInput.focus();
        nextInput.setSelectionRange(q.length, q.length);
      }
    }, 90);
  
    input.addEventListener('input', run);
  
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRoomChatSearch();
      }
  
      if (e.key === 'Enter') {
        e.preventDefault();
        await jumpActiveRoomResult();
      }
  
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveRoomSearchResult(1, client);
      }
  
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveRoomSearchResult(-1, client);
      }
    });
  
    roomPanel.querySelector('[data-close]')?.addEventListener('click', closeRoomChatSearch);
    roomPanel.querySelector('[data-next]')?.addEventListener('click', () => moveRoomSearchResult(1, client));
    roomPanel.querySelector('[data-prev]')?.addEventListener('click', () => moveRoomSearchResult(-1, client));
  }
  
  function moveRoomSearchResult(delta, client) {
    const n = roomPanelState.results.length;
  
    if (!n) return;
  
    roomPanelState.active = (roomPanelState.active + delta + n) % n;
  
    renderRoomPanel(client);
  
    jumpActiveRoomResult().catch((err) => {
      console.warn('[YANTA Chat Search] Could not jump to result', err);
      toast('Could not jump to message.', 'error');
    });
  }
  
  /**
   * Opens the in-room Chat search panel with result navigation.
   */
  export function openRoomChatSearch({
    container,
    client,
    roomId,
    roomName = 'Chat',
    onJump,
  } = {}) {
    if (!container || !client || !roomId) {
      toast('Could not open chat search.', 'error');
      console.warn('[YANTA Chat Search] Missing room search inputs', {
        hasContainer: !!container,
        hasClient: !!client,
        roomId,
      });
      return;
    }
  
    const panel = ensureRoomPanel(container);
  
    roomPanelState = {
      roomId,
      roomName,
      results: [],
      active: 0,
      onJump,
    };
  
    panel.hidden = false;
  
    renderRoomPanel(client);
  
    setTimeout(() => {
      panel.querySelector('input')?.focus();
    }, 0);
  }
  
  /**
   * Closes the in-room Chat search panel.
   */
  export function closeRoomChatSearch() {
    if (roomPanel) roomPanel.hidden = true;
  }
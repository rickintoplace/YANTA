// ============================================================
// YANTA Chat — AP6 Gallery overlay
// ============================================================

import {
    downloadBlob,
    el,
    escapeHtml,
    fmtBytes,
    fmtDate,
    lucide,
    safeFilename,
    toast,
  } from '../core.js';
  
  import {
    registerOverlayRoute,
    pushOverlayState,
    closeTopOverlay,
    overlayIdFromState,
  } from '../overlay-history.js';
  
  import {
    yantaConfirm,
  } from '../dialogs.js';
  
  import {
    chatStore,
  } from './chat-store.js';
  
  import {
    listMediaIndexForRoom,
  } from './chat-media-index.js';
  
  import {
    mxcToBlob,
    mxcToBlobUrl,
    purgeChatMediaMemoryCacheForMxc,
  } from './chat-media.js';

  import {
    openChatImageViewer,
  } from './chat-media-render.js';

  import {
    purgeChatMediaCacheForItem,
  } from './chat-media-cache.js';

  import {
  showMenu,
  } from '../tree.js';

  const CHAT_GALLERY_OVERLAY_ID = 'chat-gallery';
  
  const TABS = [
    {
      id: 'image',
      label: 'Bilder',
      icon: 'images',
    },
    {
      id: 'file',
      label: 'Dateien',
      icon: 'file',
    },
    {
      id: 'audio',
      label: 'Audio',
      icon: 'audio-lines',
    },
    {
      id: 'link',
      label: 'Links',
      icon: 'link',
    },
  ];
  
  let overlay = null;
  let registered = false;
  let currentClient = null;
  let currentRoomId = '';
  let currentRoomName = 'Chat';
  let currentTab = 'image';
  let imageObserver = null;
  
  function isOpen() {
    return !!overlay && overlay.hidden === false;
  }
  
  function ensureCss() {
    if (document.getElementById('yanta-chat-gallery-css')) return;
  
    const style = document.createElement('style');
  
    style.id = 'yanta-chat-gallery-css';
    style.textContent = `
  .yanta-chat-gallery-overlay {
    position: fixed;
    inset: 0;
    z-index: 1300;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(0,0,0,.52);
    backdrop-filter: blur(14px);
  }
  
  .yanta-chat-gallery-overlay[hidden] {
    display: none !important;
  }
  
  .yanta-chat-gallery-card {
    width: min(1040px, 96vw);
    height: min(760px, 92vh);
    display: grid;
    grid-template-rows: auto auto 1fr;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: var(--bg-elev);
    box-shadow: 0 24px 80px rgba(0,0,0,.42);
  }
  
  .yanta-chat-gallery-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  
  .yanta-chat-gallery-title {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .yanta-chat-gallery-title strong {
    color: var(--text);
    font-size: 15px;
  }
  
  .yanta-chat-gallery-title small {
    color: var(--text-faint);
    font-size: 12px;
  }
  
  .yanta-chat-gallery-tabs {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  
  .yanta-chat-gallery-tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 11px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--text-dim);
    font-weight: 750;
    cursor: pointer;
    white-space: nowrap;
  }
  
  .yanta-chat-gallery-tab:hover {
    color: var(--text);
    background: var(--bg-elev-2);
  }
  
  .yanta-chat-gallery-tab.active {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  
  .yanta-chat-gallery-body {
    min-height: 0;
    overflow: auto;
    padding: 14px;
  }
  
  .yanta-chat-gallery-empty {
    min-height: 280px;
    display: grid;
    place-items: center;
    text-align: center;
    color: var(--text-faint);
  }
  
  .yanta-chat-gallery-empty > div {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }
  
  .yanta-chat-gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
    gap: 10px;
  }
  
  .yanta-chat-gallery-image {
    position: relative;
    overflow: hidden;
    aspect-ratio: 1;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elev-2);
  }
  
  .yanta-chat-gallery-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* Warum:
     Der Lade-Platzhalter liegt absolut über der 1:1-Kachel. Als normales
     Grid-Kind (min-height 280px) würde er das Bild aus der overflow:hidden-
     Kachel schieben — Bilder wären nie sichtbar. */
  .yanta-chat-gallery-image .yanta-chat-gallery-empty {
    position: absolute;
    inset: 0;
    min-height: 0;
  }

  /* Warum:
     Author-CSS (display:block/grid) überschreibt sonst das hidden-Attribut
     aus dem UA-Stylesheet — Spinner bliebe sichtbar, Bild bliebe versteckt. */
  .yanta-chat-gallery-overlay [hidden] {
    display: none !important;
  }
  
  /* Warum:
     Actions are hidden until hover/focus to keep the grid calm like high-end
     photo apps, but remain keyboard accessible. */
  .yanta-chat-gallery-image-actions {
    position: absolute;
    inset: auto 8px 8px 8px;
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 120ms ease, transform 120ms ease;
  }
  
  .yanta-chat-gallery-image:hover .yanta-chat-gallery-image-actions,
  .yanta-chat-gallery-image:focus-within .yanta-chat-gallery-image-actions {
    opacity: 1;
    transform: translateY(0);
  }
  
  .yanta-chat-gallery-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .yanta-chat-gallery-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 11px 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--bg-elev-2);
  }
  
  .yanta-chat-gallery-row-icon {
    width: 38px;
    height: 38px;
    display: inline-grid;
    place-items: center;
    border-radius: 12px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 11%, transparent);
  }
  
  .yanta-chat-gallery-row-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  
  .yanta-chat-gallery-row-main strong {
    color: var(--text);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .yanta-chat-gallery-row-main small {
    color: var(--text-faint);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .yanta-chat-gallery-row-actions {
    display: inline-flex;
    gap: 6px;
  }
  
  @media (max-width: 680px) {
    .yanta-chat-gallery-overlay {
      padding: 0;
    }
  
    .yanta-chat-gallery-card {
      width: 100vw;
      height: 100vh;
      border-radius: 0;
    }
  
    .yanta-chat-gallery-row {
      grid-template-columns: auto minmax(0, 1fr);
    }
  
    .yanta-chat-gallery-row-actions {
      grid-column: 1 / -1;
      justify-content: flex-end;
    }
  }
  `;
  
    document.head.append(style);
  }
  
  function ensureOverlay() {
    if (overlay) return overlay;
  
    ensureCss();
  
    overlay = el('div', {
      class: 'yanta-chat-gallery-overlay',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Chat gallery',
    });
  
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeChatGallery();
      if (e.target.closest?.('[data-gallery-close]')) closeChatGallery();
    });
  
    document.body.append(overlay);
  
    return overlay;
  }
  
  function registerRoute() {
    if (registered) return;
  
    registered = true;
  
    registerOverlayRoute(CHAT_GALLERY_OVERLAY_ID, {
      open: async ({ state } = {}) => {
        await openChatGallery({
          client: currentClient,
          roomId: state?.roomId || currentRoomId,
          roomName: state?.roomName || currentRoomName,
          fromHistory: true,
        });
      },
  
      close: () => {
        closeChatGallery({
          fromHistory: true,
        });
      },
  
      isOpen,
    });
  }
  
  function normalizeTab(tab) {
    if (tab === 'image') return 'image';
    if (tab === 'file') return 'file';
    if (tab === 'audio' || tab === 'voice') return 'audio';
    if (tab === 'link') return 'link';
    return 'image';
  }
  
  function itemMatchesTab(item, tab) {
    if (tab === 'audio') return item.kind === 'audio' || item.kind === 'voice';
    return item.kind === tab;
  }
  
  function itemSubtitle(item) {
    const parts = [];
  
    if (item.domain) parts.push(item.domain);
    if (item.mime && item.kind !== 'link') parts.push(item.mime);
    if (item.size) parts.push(fmtBytes(item.size));
    if (item.ts) parts.push(fmtDate(item.ts));
    if (item.sender) parts.push(item.sender);
  
    return parts.join(' · ');
  }
  
  function ownUserId() {
    return currentClient?.getUserId?.() || '';
  }
  
  function iconForItem(item) {
    if (item.kind === 'link') return 'link';
    if (item.kind === 'audio' || item.kind === 'voice') return 'audio-lines';
    if (item.kind === 'image') return 'image';
    return 'file';
  }
  
  async function downloadItem(item) {
    try {
      if (item.kind === 'link') {
        const blob = new Blob([`${item.url}\n`], {
          type: 'text/uri-list',
        });
  
        downloadBlob(blob, safeFilename(`${item.domain || 'link'}.url`));
        return;
      }
  
      if (!item.mxcUrl) {
        toast('No media URL found.', 'error');
        throw new Error('Gallery item has no mxcUrl.');
      }
  
      const blob = await mxcToBlob(currentClient, item.mxcUrl, {
        thumbnail: false,
        encryptedFile: item.encryptedFile || null,
        mimeType: item.mime || '',
        roomId: item.roomId,
      });
  
      const fallbackName =
        item.kind === 'image'
          ? 'photo'
          : item.kind === 'voice'
            ? 'voice-message'
            : 'file';
  
      downloadBlob(blob, safeFilename(item.name || fallbackName));
  
      toast('Download ready', 'success');
    } catch (err) {
      console.warn('[YANTA Chat Gallery] Download failed', err);
      toast('Could not download media.', 'error');
    }
  }
  
  async function deleteItem(item) {
    try {
      const own = item.sender && item.sender === ownUserId();
  
      const ok = await yantaConfirm({
        title: own ? 'Für alle löschen?' : 'Nur lokal entfernen?',
        message: own
          ? [
              `"${item.name || 'Media'}" wird aus diesem Chat für alle gelöscht.`,
              '',
              'Matrix redaction entfernt die Nachricht serverseitig. Lokale Caches werden ebenfalls geleert.',
            ].join('\n')
          : [
              `"${item.name || 'Media'}" wird nur aus deiner lokalen Galerie entfernt.`,
              '',
              'Die Chat-Nachricht bleibt unverändert und kann durch erneutes Laden/Indexieren wieder auftauchen.',
            ].join('\n'),
        confirmLabel: own ? 'Für alle löschen' : 'Lokal entfernen',
        cancelLabel: 'Abbrechen',
        danger: true,
        icon: own ? 'trash' : 'eye-off',
      });
  
      if (!ok) return;
  
      if (own) {
        if (!currentClient?.redactEvent) {
          throw new Error('Matrix redactEvent is not available.');
        }
  
        await currentClient.redactEvent(item.roomId, item.eventId);
      }
  
      await chatStore.mediaIndex.del(item.id);
      await purgeChatMediaCacheForItem(item);
  
      if (item.mxcUrl) purgeChatMediaMemoryCacheForMxc(item.mxcUrl);
      if (item.thumbnailMxcUrl) purgeChatMediaMemoryCacheForMxc(item.thumbnailMxcUrl);
  
      toast(own ? 'Nachricht gelöscht' : 'Aus Galerie entfernt', 'success');
  
      await renderGallery();
    } catch (err) {
      console.warn('[YANTA Chat Gallery] Delete failed', err);
      toast('Could not delete gallery item.', 'error');
    }
  }
  
  function bindItemActions(root) {
    root.querySelectorAll('[data-download-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.downloadItem;
        const item = JSON.parse(btn.closest('[data-gallery-item-json]')?.dataset.galleryItemJson || '{}');
  
        if (!id || !item.id) {
          toast('Gallery item not found.', 'error');
          console.warn('[YANTA Chat Gallery] Missing item for download', id);
          return;
        }
  
        downloadItem(item);
      });
    });
  
    root.querySelectorAll('[data-delete-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.deleteItem;
        const item = JSON.parse(btn.closest('[data-gallery-item-json]')?.dataset.galleryItemJson || '{}');
  
        if (!id || !item.id) {
          toast('Gallery item not found.', 'error');
          console.warn('[YANTA Chat Gallery] Missing item for delete', id);
          return;
        }
  
        deleteItem(item);
      });
    });

    root.querySelectorAll('[data-gallery-item-json]').forEach((node) => {
      let longPressTimer = 0;

      const itemFromNode = () => JSON.parse(node.dataset.galleryItemJson || '{}');

      const openItemMenu = (x, y) => {
        const item = itemFromNode();

        if (!item?.id) return;

        showMenu(x, y, [
          {
            label: 'Jump to Message',
            icon: 'message-square',
            action: () => {
              window.dispatchEvent(new CustomEvent('yanta-chat-jump-to-message', {
                detail: {
                  roomId: item.roomId,
                  eventId: item.eventId,
                },
              }));

              closeChatGallery();
            },
          },
          {
            label: 'Download',
            icon: 'download',
            action: () => downloadItem(item),
          },
          {
            label: 'Delete',
            icon: 'trash',
            danger: true,
            action: () => deleteItem(item),
          },
        ], {
          align: 'start',
        });
      };

      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openItemMenu(e.clientX, e.clientY);
      });

      node.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;

        longPressTimer = window.setTimeout(() => {
          try {
            navigator.vibrate?.(8);
          } catch {}

          openItemMenu(e.clientX, e.clientY);
        }, 480);
      }, true);

      node.addEventListener('pointermove', () => {
        clearTimeout(longPressTimer);
      }, true);

      node.addEventListener('pointerup', () => {
        clearTimeout(longPressTimer);
      }, true);

      node.addEventListener('pointercancel', () => {
        clearTimeout(longPressTimer);
      }, true);
    });
  }
  
  function rowActionsHtml(item) {
    return `
      <span class="yanta-chat-gallery-row-actions">
        <button class="icon-btn" data-download-item="${escapeHtml(item.id)}" title="Download" aria-label="Download">
          ${lucide('download', 16)}
        </button>
        <button class="icon-btn danger" data-delete-item="${escapeHtml(item.id)}" title="Löschen" aria-label="Löschen">
          ${lucide('trash', 16)}
        </button>
      </span>
    `;
  }
  
  function imageCardHtml(item) {
    return `
      <article
        class="yanta-chat-gallery-image"
        data-gallery-item-json="${escapeHtml(JSON.stringify(item))}">
        <div class="yanta-chat-gallery-empty">
          <span class="yanta-chat-spinner"></span>
        </div>
        <img hidden alt="${escapeHtml(item.name || 'Photo')}" loading="lazy" data-gallery-image>
        <div class="yanta-chat-gallery-image-actions">
          ${rowActionsHtml(item)}
        </div>
      </article>
    `;
  }
  
  function listRowHtml(item) {
    return `
      <article
        class="yanta-chat-gallery-row"
        data-gallery-item-json="${escapeHtml(JSON.stringify(item))}">
        <span class="yanta-chat-gallery-row-icon">
          ${lucide(iconForItem(item), 19)}
        </span>
  
        <span class="yanta-chat-gallery-row-main">
          <strong>${escapeHtml(item.kind === 'link' ? (item.name || item.url) : (item.name || 'File'))}</strong>
          <small>${escapeHtml(itemSubtitle(item))}</small>
        </span>
  
        ${rowActionsHtml(item)}
      </article>
    `;
  }
    
  async function hydrateImages(overlayNode, items) {
    imageObserver?.disconnect();
    imageObserver = null;

    const body = overlayNode.querySelector('.yanta-chat-gallery-body');
    const cards = [...overlayNode.querySelectorAll('.yanta-chat-gallery-image')];
    if (!cards.length) return;

    async function resolveGalleryImageUrl(item) {
      const attempts = [
        {
          mxcUrl: item.thumbnailMxcUrl,
          encryptedFile: item.thumbnailEncryptedFile || null,
          thumbnail: !item.thumbnailEncryptedFile,
          w: 360,
          h: 360,
        },
        {
          mxcUrl: item.mxcUrl,
          encryptedFile: item.encryptedFile || null,
          thumbnail: false,
          w: 1200,
          h: 1200,
        },
      ].filter((x) => x.mxcUrl);

      let lastErr = null;
      for (const attempt of attempts) {
        try {
          return await mxcToBlobUrl(currentClient, attempt.mxcUrl, {
            thumbnail: attempt.thumbnail,
            w: attempt.w,
            h: attempt.h,
            encryptedFile: attempt.encryptedFile,
            mimeType: item.mime || '',
            roomId: item.roomId,
          });
        } catch (err) {
          lastErr = err;
          console.warn('[YANTA Chat Gallery] image source failed, trying fallback', {
            itemId: item.id,
            mxcUrl: attempt.mxcUrl,
            err,
          });
        }
      }
      throw lastErr || new Error('No gallery image source worked.');
    }

    function openGalleryItemViewer(item) {
      openChatImageViewer(currentClient, {
        mxcUrl: item.mxcUrl || item.thumbnailMxcUrl,
        encryptedFile: item.encryptedFile || item.thumbnailEncryptedFile || null,
        mimeType: item.mime || '',
        w: 1600,
        h: 1600,
      }, item.name || 'Photo');
    }

    const hydrateCard = async (card) => {
      if (!card?.isConnected || card.dataset.hydrated === '1') return;
      card.dataset.hydrated = '1';
      const item = JSON.parse(card.dataset.galleryItemJson || '{}');
      const img = card.querySelector('[data-gallery-image]');
      const placeholder = card.querySelector('.yanta-chat-gallery-empty');
      try {
        const url = await resolveGalleryImageUrl(item);
        if (!img?.isConnected) return;
        img.src = url;
        img.hidden = false;
        if (placeholder) placeholder.hidden = true;
        /*
          Klick auf das Bild öffnet den Fullscreen-Viewer.
          Die Action-Buttons (Download/Delete) stoppen selbst die Propagation
          nicht — daher hier auf das <img> selbst binden.
        */
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openGalleryItemViewer(item);
        });
      } catch (err) {
        console.warn('[YANTA Chat Gallery] Could not load image', err);
        if (placeholder) {
          placeholder.innerHTML = `
            <div>
              ${lucide('image-off', 24)}
              <small>Preview failed</small>
            </div>
          `;
        }
      }
    };

    if (!('IntersectionObserver' in window) || !body) {
      await Promise.all(cards.map(hydrateCard));
      return;
    }

    imageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        imageObserver?.unobserve(entry.target);
        hydrateCard(entry.target);
      }
    }, {
      root: body,
      threshold: 0.01,
      rootMargin: '400px',
    });

    for (const card of cards) {
      imageObserver.observe(card);
    }
  }
  
  async function renderGallery() {
    const node = ensureOverlay();
  
    if (!currentRoomId) {
      toast('No chat selected.', 'error');
      console.warn('[YANTA Chat Gallery] Missing roomId');
      return;
    }
  
    const rows = await listMediaIndexForRoom(currentRoomId);
    const items = rows.filter((item) => itemMatchesTab(item, currentTab));
  
    node.innerHTML = `
      <section class="yanta-chat-gallery-card">
        <header class="yanta-chat-gallery-head">
          <span style="display:inline-flex;color:var(--accent)">
            ${lucide('images', 22)}
          </span>
  
          <span class="yanta-chat-gallery-title">
            <strong>Galerie</strong>
            <small>${escapeHtml(currentRoomName)} · ${rows.length} Elemente</small>
          </span>
  
          <span class="grow"></span>
  
          <button class="icon-btn" data-gallery-close title="Schließen" aria-label="Schließen">
            ${lucide('x', 18)}
          </button>
        </header>
  
        <nav class="yanta-chat-gallery-tabs" aria-label="Gallery tabs">
          ${TABS.map((tab) => `
            <button
              class="yanta-chat-gallery-tab ${currentTab === tab.id ? 'active' : ''}"
              data-gallery-tab="${escapeHtml(tab.id)}"
              type="button">
              ${lucide(tab.icon, 15)}
              ${escapeHtml(tab.label)}
            </button>
          `).join('')}
        </nav>
  
        <div class="yanta-chat-gallery-body">
          ${
            items.length
              ? currentTab === 'image'
                ? `<div class="yanta-chat-gallery-grid">${items.map(imageCardHtml).join('')}</div>`
                : `<div class="yanta-chat-gallery-list">${items.map(listRowHtml).join('')}</div>`
              : `
                <div class="yanta-chat-gallery-empty">
                  <div>
                    ${lucide(currentTab === 'image' ? 'images' : currentTab === 'link' ? 'link' : 'folder-open', 28)}
                    <strong>Keine ${escapeHtml(TABS.find((tab) => tab.id === currentTab)?.label || 'Elemente')}</strong>
                    <small>Neue Medien erscheinen automatisch, sobald YANTA Nachrichten lokal entschlüsselt.</small>
                  </div>
                </div>
              `
          }
        </div>
      </section>
    `;
  
    node.querySelectorAll('[data-gallery-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        currentTab = normalizeTab(btn.dataset.galleryTab);
        await renderGallery();
      });
    });
  
    bindItemActions(node);
  
    if (currentTab === 'image') {
      await hydrateImages(node, items);
    }
  }
  
  /**
   * Opens the per-room Gallery overlay.
   */
  export async function openChatGallery({
    client,
    roomId,
    roomName = 'Chat',
    tab = 'image',
    fromHistory = false,
  } = {}) {
    registerRoute();
  
    currentClient = client || currentClient;
    currentRoomId = String(roomId || currentRoomId || '');
    currentRoomName = roomName || currentRoomName || 'Chat';
    currentTab = normalizeTab(tab || currentTab);
  
    if (!currentClient) {
      toast('Chat is not connected.', 'error');
      console.warn('[YANTA Chat Gallery] Missing Matrix client');
      return;
    }
  
    if (!currentRoomId) {
      toast('No chat selected.', 'error');
      console.warn('[YANTA Chat Gallery] Missing roomId');
      return;
    }
  
    const node = ensureOverlay();
  
    node.hidden = false;
  
    if (!fromHistory && overlayIdFromState() !== CHAT_GALLERY_OVERLAY_ID) {
      pushOverlayState(CHAT_GALLERY_OVERLAY_ID, {
        roomId: currentRoomId,
        roomName: currentRoomName,
        tab: currentTab,
      });
    }
  
    await renderGallery();
  }
  
  /**
   * Closes the Gallery overlay.
   */
  export function closeChatGallery({
    fromHistory = false,
  } = {}) {
    if (!overlay) return;
  
    imageObserver?.disconnect();
  
    if (!fromHistory && overlayIdFromState() === CHAT_GALLERY_OVERLAY_ID) {
      closeTopOverlay(() => {
        closeChatGallery({
          fromHistory: true,
        });
      });
  
      return;
    }
  
    overlay.hidden = true;
  }
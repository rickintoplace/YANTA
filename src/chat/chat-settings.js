// ============================================================
// YANTA Chat — Chat settings + AP6 storage management
// ============================================================

import {
    el,
    escapeHtml,
    fmtBytes,
    lucide,
    toast,
    updateStorageMeter,
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
    CHAT_MEDIA_CACHE_LIMITS,
    getChatMediaCacheLimitBytes,
    getChatMediaCacheUsage,
    purgeAllChatMediaCache,
    purgeChatMediaCacheForRoom,
    setChatMediaCacheLimitBytes,
  } from './chat-media-cache.js';
  
  import {
    revokeAllChatMediaObjectUrls,
  } from './chat-media.js';
  
  const CHAT_SETTINGS_OVERLAY_ID = 'chat-settings';
  
  let overlay = null;
  let registered = false;
  let currentClient = null;
  let currentRoomId = '';
  let currentRoomName = 'Chat';
  
  function isOpen() {
    return !!overlay && overlay.hidden === false;
  }
  
  function ensureCss() {
    if (document.getElementById('yanta-chat-settings-css')) return;
  
    const style = document.createElement('style');
  
    style.id = 'yanta-chat-settings-css';
    style.textContent = `
  .yanta-chat-settings-overlay {
    position: fixed;
    inset: 0;
    z-index: 1290;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(0,0,0,.48);
    backdrop-filter: blur(14px);
  }
  
  .yanta-chat-settings-overlay[hidden] {
    display: none !important;
  }
  
  .yanta-chat-settings-card {
    width: min(680px, 94vw);
    max-height: min(760px, 92vh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: var(--bg-elev);
    box-shadow: 0 24px 80px rgba(0,0,0,.42);
  }
  
  .yanta-chat-settings-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }
  
  .yanta-chat-settings-head-title {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .yanta-chat-settings-head-title strong {
    color: var(--text);
    font-size: 15px;
  }
  
  .yanta-chat-settings-head-title small {
    color: var(--text-faint);
    font-size: 12px;
  }
  
  .yanta-chat-settings-body {
    overflow: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .yanta-chat-settings-section {
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elev-2);
  }
  
  .yanta-chat-settings-section h4 {
    margin: 0 0 7px;
    color: var(--text);
    font-size: 14px;
  }
  
  .yanta-chat-settings-section p {
    margin: 0 0 12px;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.45;
  }
  
  .yanta-chat-storage-meter {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .yanta-chat-storage-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    color: var(--text-dim);
    font-size: 12px;
  }
  
  .yanta-chat-storage-row strong {
    color: var(--text);
  }
  
  .yanta-chat-storage-bar {
    position: relative;
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-faint) 16%, transparent);
  }
  
  .yanta-chat-storage-bar > span {
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--pct, 0%);
    min-width: var(--min, 0);
    border-radius: inherit;
    background: linear-gradient(
      90deg,
      var(--accent),
      color-mix(in srgb, var(--accent) 70%, white)
    );
  }
  
  .yanta-chat-settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  
  .yanta-chat-policy-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  
  .yanta-chat-policy-row select {
    min-width: 210px;
  }
  `;
  
    document.head.append(style);
  }
  
  function ensureOverlay() {
    if (overlay) return overlay;
  
    ensureCss();
  
    overlay = el('div', {
      class: 'yanta-chat-settings-overlay',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Chat settings',
    });
  
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeChatSettings();
      if (e.target.closest?.('[data-chat-settings-close]')) closeChatSettings();
    });
  
    document.body.append(overlay);
  
    return overlay;
  }
  
  function registerRoute() {
    if (registered) return;
  
    registered = true;
  
    registerOverlayRoute(CHAT_SETTINGS_OVERLAY_ID, {
      open: async ({ state } = {}) => {
        await openChatSettings({
          client: currentClient,
          roomId: state?.roomId || currentRoomId,
          roomName: state?.roomName || currentRoomName,
          fromHistory: true,
        });
      },
  
      close: () => {
        closeChatSettings({
          fromHistory: true,
        });
      },
  
      isOpen,
    });
  }
  
  function storageBarHtml({
    label,
    bytes,
    limit,
  }) {
    const pct = limit > 0
      ? Math.max(0, Math.min(100, Math.round((Number(bytes || 0) / limit) * 100)))
      : 0;
  
    return `
      <div class="yanta-chat-storage-meter">
        <div class="yanta-chat-storage-row">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(fmtBytes(bytes || 0))}</span>
        </div>
        <div class="yanta-chat-storage-bar" style="--pct:${pct}%;--min:${bytes > 0 ? '4px' : '0'}">
          <span></span>
        </div>
      </div>
    `;
  }
  
  async function renderSettings() {
    const node = ensureOverlay();
    const usage = await getChatMediaCacheUsage();
    const limit = await getChatMediaCacheLimitBytes();
    const roomUsage = usage.byRoom.find((row) => row.roomId === currentRoomId) || {
      roomId: currentRoomId,
      bytes: 0,
      count: 0,
    };
  
    node.innerHTML = `
      <section class="yanta-chat-settings-card">
        <header class="yanta-chat-settings-head">
          <span style="display:inline-flex;color:var(--accent)">
            ${lucide('settings', 22)}
          </span>
  
          <span class="yanta-chat-settings-head-title">
            <strong>Chat-Einstellungen</strong>
            <small>${escapeHtml(currentRoomName)}</small>
          </span>
  
          <span class="grow"></span>
  
          <button class="icon-btn" data-chat-settings-close title="Schließen" aria-label="Schließen">
            ${lucide('x', 18)}
          </button>
        </header>
  
        <div class="yanta-chat-settings-body">
          <section class="yanta-chat-settings-section">
            <h4>Speicherverwaltung</h4>
            <p>
              Nachrichten bleiben erhalten. Nur lokal zwischengespeicherte Medien werden gelöscht
              und bei Bedarf wieder über Matrix geladen und entschlüsselt.
            </p>
  
            ${storageBarHtml({
              label: 'Gesamter Media-Cache',
              bytes: usage.totalBytes,
              limit,
            })}
  
            <div style="height:10px"></div>
  
            ${storageBarHtml({
              label: 'Dieser Chat',
              bytes: roomUsage.bytes,
              limit: Math.max(limit, roomUsage.bytes),
            })}
  
            <div class="yanta-chat-policy-row">
              <label for="chatMediaCachePolicy" style="color:var(--text-dim);font-size:12px;font-weight:750">
                Auto-Policy
              </label>
  
              <select class="text-input" id="chatMediaCachePolicy" data-cache-policy>
                ${CHAT_MEDIA_CACHE_LIMITS.map((option) => `
                  <option value="${option.bytes}" ${Number(option.bytes) === Number(limit) ? 'selected' : ''}>
                    Media-Cache begrenzen auf ${escapeHtml(option.label)}
                  </option>
                `).join('')}
              </select>
            </div>
  
            <div class="yanta-chat-settings-actions">
              <button class="btn" data-clear-room-cache>
                ${lucide('eraser', 14)}
                Cache dieses Chats leeren
              </button>
  
              <button class="btn danger" data-clear-all-cache>
                ${lucide('trash', 14)}
                Gesamten Media-Cache leeren
              </button>
            </div>
          </section>
        </div>
      </section>
    `;
  
    node.querySelector('[data-cache-policy]')?.addEventListener('change', async (e) => {
      try {
        const bytes = Number(e.currentTarget.value || 0);
  
        await setChatMediaCacheLimitBytes(bytes);
        await updateStorageMeter();
  
        toast('Media-Cache-Policy gespeichert', 'success');
  
        await renderSettings();
      } catch (err) {
        console.warn('[YANTA Chat Settings] Could not update cache policy', err);
        toast('Could not update media cache policy.', 'error');
      }
    });
  
    node.querySelector('[data-clear-room-cache]')?.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: 'Cache dieses Chats leeren?',
        message: [
          `YANTA löscht lokal zwischengespeicherte Medien aus "${currentRoomName}".`,
          '',
          'Nachrichten bleiben erhalten. Medien werden bei Bedarf neu geladen.',
        ].join('\n'),
        confirmLabel: 'Cache leeren',
        cancelLabel: 'Abbrechen',
        danger: true,
        icon: 'eraser',
      });
  
      if (!ok) return;
  
      try {
        const result = await purgeChatMediaCacheForRoom(currentRoomId);
  
        revokeAllChatMediaObjectUrls();
        await updateStorageMeter();
  
        toast(`Cache geleert: ${fmtBytes(result.bytes)}`, 'success');
  
        await renderSettings();
      } catch (err) {
        console.warn('[YANTA Chat Settings] Could not clear room cache', err);
        toast('Could not clear this chat cache.', 'error');
      }
    });
  
    node.querySelector('[data-clear-all-cache]')?.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: 'Gesamten Media-Cache leeren?',
        message: [
          'YANTA löscht alle lokal zwischengespeicherten Chat-Medien.',
          '',
          'Nachrichten bleiben erhalten. Medien werden bei Bedarf neu geladen.',
        ].join('\n'),
        confirmLabel: 'Gesamten Cache leeren',
        cancelLabel: 'Abbrechen',
        danger: true,
        icon: 'trash',
      });
  
      if (!ok) return;
  
      try {
        const result = await purgeAllChatMediaCache();
  
        revokeAllChatMediaObjectUrls();
        await updateStorageMeter();
  
        toast(`Media-Cache geleert: ${fmtBytes(result.bytes)}`, 'success');
  
        await renderSettings();
      } catch (err) {
        console.warn('[YANTA Chat Settings] Could not clear all cache', err);
        toast('Could not clear media cache.', 'error');
      }
    });
  }
  
  /**
   * Opens Chat settings for one room.
   */
  export async function openChatSettings({
    client,
    roomId,
    roomName = 'Chat',
    fromHistory = false,
  } = {}) {
    registerRoute();
  
    currentClient = client || currentClient;
    currentRoomId = String(roomId || currentRoomId || '');
    currentRoomName = roomName || currentRoomName || 'Chat';
  
    if (!currentRoomId) {
      toast('No chat selected.', 'error');
      console.warn('[YANTA Chat Settings] Missing roomId');
      return;
    }
  
    const node = ensureOverlay();
  
    node.hidden = false;
  
    if (!fromHistory && overlayIdFromState() !== CHAT_SETTINGS_OVERLAY_ID) {
      pushOverlayState(CHAT_SETTINGS_OVERLAY_ID, {
        roomId: currentRoomId,
        roomName: currentRoomName,
      });
    }
  
    await renderSettings();
  }
  
  /**
   * Closes Chat settings.
   */
  export function closeChatSettings({
    fromHistory = false,
  } = {}) {
    if (!overlay) return;
  
    if (!fromHistory && overlayIdFromState() === CHAT_SETTINGS_OVERLAY_ID) {
      closeTopOverlay(() => {
        closeChatSettings({
          fromHistory: true,
        });
      });
  
      return;
    }
  
    overlay.hidden = true;
  }
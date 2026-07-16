// ============================================================
// YANTA Chat — AP9 profile, room details, verification,
// preferences entry points and AP6 storage management.
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
    compressImageFile,
  } from '../media/image-compression.js';
  
  import {
    CHAT_MEDIA_CACHE_LIMITS,
    getChatMediaCacheLimitBytes,
    getChatMediaCacheUsage,
    purgeAllChatMediaCache,
    purgeChatMediaCacheForRoom,
    setChatMediaCacheLimitBytes,
  } from './chat-media-cache.js';
  
  import {
    mxcToBlobUrl,
    revokeAllChatMediaObjectUrls,
  } from './chat-media.js';
  
  import {
    getChatCryptoHealth,
    readChatRecoveryKeyTextForDisplay,
  } from './matrix-crypto.js';
  
  const CHAT_SETTINGS_OVERLAY_ID = 'chat-settings';
  
  let overlay = null;
  let registered = false;
  let currentClient = null;
  let currentRoomId = '';
  let currentRoomName = 'Chat';
  let activeTab = 'details';
  let currentScope = 'room'; // 'room' | 'me'
  
  function isOpen() {
    return !!overlay && overlay.hidden === false;
  }
  
  function ownUserId() {
    return currentClient?.getUserId?.() || '';
  }
  
  function firstString(...values) {
    for (const value of values) {
      const s = String(value ?? '').trim();
      if (s) return s;
    }
  
    return '';
  }
  
  function mxcFromUploadResult(result) {
    if (typeof result === 'string') return result;
  
    return (
      result?.content_uri ||
      result?.contentUri ||
      result?.url ||
      ''
    );
  }
  
  function yantaHandleFromMxid(userId = '') {
    const local = String(userId || '').replace(/^@/, '').split(':')[0] || '';
    return local ? `@${local}:yanta.me` : '';
  }
  
  function directAccountData() {
    try {
      return currentClient?.getAccountData?.('m.direct')?.getContent?.() || {};
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not read m.direct', err);
      toast('Could not read direct chat metadata.', 'error');
      return {};
    }
  }
  
  function directUserIdForRoom(roomId) {
    const direct = directAccountData();
  
    for (const [userId, rooms] of Object.entries(direct)) {
      if (Array.isArray(rooms) && rooms.includes(roomId)) return userId;
    }
  
    return '';
  }
  
  function currentRoom() {
    return currentClient?.getRoom?.(currentRoomId) || null;
  }
  
  function roomDisplayName(room = currentRoom()) {
    if (!room) return currentRoomName || 'Chat';
  
    const directUserId = directUserIdForRoom(room.roomId);
    const member = directUserId ? room.getMember?.(directUserId) : null;
  
    return (
      member?.name ||
      member?.rawDisplayName ||
      member?.displayName ||
      room.name ||
      room.getDefaultRoomName?.(ownUserId()) ||
      currentRoomName ||
      'Chat'
    );
  }
  
  function roomInitials(room = currentRoom()) {
    return roomDisplayName(room)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'C';
  }
  
  function roomAvatarMxc(room = currentRoom()) {
    try {
      const own = room?.getMxcAvatarUrl?.();
      if (own) return own;

      /*
        DM-Räume haben meist kein eigenes Raum-Avatar. Das Profilbild des
        Gegenübers ist dort das erwartete Bild.
      */
      const directUserId = directUserIdForRoom(room?.roomId || currentRoomId);
      const member = directUserId ? room?.getMember?.(directUserId) : null;

      return (
        member?.getMxcAvatarUrl?.() ||
        (directUserId ? userAvatarMxc(directUserId) : '') ||
        ''
      );
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not read room avatar', err);
      toast('Could not read chat avatar.', 'error');
      return '';
    }
  }
  
  function userAvatarMxc(userId) {
    try {
      const user = currentClient?.getUser?.(userId);
      return user?.avatarUrl || user?.avatar_url || '';
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not read user avatar', err);
      toast('Could not read profile avatar.', 'error');
      return '';
    }
  }
  
  function roomIsEncrypted(room = currentRoom()) {
    try {
      if (typeof currentClient?.isRoomEncrypted === 'function') {
        return !!currentClient.isRoomEncrypted(currentRoomId);
      }
  
      const state = room?.currentState || room?.getLiveTimeline?.()?.getState?.('f');
      return !!state?.getStateEvents?.('m.room.encryption', '');
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not read encryption state', err);
      toast('Could not check chat encryption.', 'error');
      return false;
    }
  }
  
  function isRoomMuted(roomId = currentRoomId) {
    try {
      const rule = currentClient?.getRoomPushRule?.('global', roomId);
      return !!rule?.actions?.some?.((action) => action === 'dont_notify');
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not read mute state', err);
      toast('Could not read notification state.', 'error');
      return false;
    }
  }
  
  async function copyText(text, successMessage = 'Copied') {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      toast(successMessage, 'success');
    } catch (err) {
      console.warn('[YANTA Chat Settings] Clipboard copy failed', err);
      toast('Could not copy to clipboard.', 'error');
    }
  }
  
  async function hydrateAvatar(node, mxc, {
    fallback = '',
    size = 160,
  } = {}) {
    if (!node) return;
  
    node.replaceChildren(fallback || '');
  
    if (!mxc || !String(mxc).startsWith('mxc://')) return;
  
    try {
      const url = await mxcToBlobUrl(currentClient, mxc, {
        thumbnail: true,
        w: size,
        h: size,
      });
  
      if (!node.isConnected) return;
  
      const img = el('img', {
        src: url,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
      });
  
      node.replaceChildren(img);
      node.classList.add('has-image');
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not hydrate avatar', err);
      toast('Could not load avatar.', 'error');
    }
  }
  
  async function uploadMatrixContent(blob, {
    name = 'avatar.webp',
    type = 'image/webp',
  } = {}) {
    if (!currentClient?.uploadContent) {
      throw new Error('Matrix uploadContent is not available.');
    }
  
    const result = await currentClient.uploadContent(blob, {
      name,
      type,
      includeFilename: true,
    });
  
    const mxc = mxcFromUploadResult(result);
  
    if (!mxc) {
      throw new Error('Homeserver did not return an MXC URI.');
    }
  
    return mxc;
  }
  
  /**
   * Updates the current Matrix user's display name and avatar.
   */
  export async function updateOwnChatProfile({
    displayName = '',
    avatarFile = null,
  } = {}) {
    try {
      if (!currentClient) throw new Error('Chat is not connected.');
  
      const own = ownUserId();
      const cleanName = String(displayName || '').trim();
  
      if (cleanName) {
        if (typeof currentClient.setDisplayName !== 'function') {
          throw new Error('Matrix setDisplayName is not available.');
        }
  
        await currentClient.setDisplayName(cleanName);
      }
  
      if (avatarFile) {
        const compressed = await compressImageFile(avatarFile, {
          maxWidth: 512,
          maxHeight: 512,
          quality: 0.86,
          mime: 'image/webp',
          includeDataUrl: false,
        });
  
        const mxc = await uploadMatrixContent(compressed.blob, {
          name: 'avatar.webp',
          type: compressed.mime || 'image/webp',
        });
  
        if (typeof currentClient.setAvatarUrl !== 'function') {
          throw new Error('Matrix setAvatarUrl is not available.');
        }
  
        await currentClient.setAvatarUrl(mxc);
      }
  
      toast('Profile updated', 'success');
  
      window.dispatchEvent(new CustomEvent('yanta-chat-profile-updated', {
        detail: {
          userId: own,
          ts: Date.now(),
        },
      }));
  
      await renderSettings();
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not update profile', err);
      toast('Could not update profile.', 'error');
      throw err;
    }
  }
  
  /*
    Avatar-Wechsel direkt am Bild (Hover-Overlay / Tap auf Mobil) statt
    über einen separaten Datei-Input. Upload startet sofort nach Auswahl.
  */
  function bindProfileAvatarEditor(node) {
    const editButton = node.querySelector('[data-avatar-edit]');
    const fileInput = node.querySelector('[data-avatar-input]');

    if (!editButton || !fileInput) return;

    editButton.addEventListener('click', () => {
      if (editButton.classList.contains('is-uploading')) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0] || null;
      fileInput.value = '';

      if (!file) return;

      editButton.classList.add('is-uploading');
      editButton.disabled = true;

      try {
        // Re-renders the settings overlay on success.
        await updateOwnChatProfile({
          avatarFile: file,
        });
      } catch {
        editButton.classList.remove('is-uploading');
        editButton.disabled = false;
      }
    });
  }

  function bindProfileDisplayNameEditor(node) {
    const view = node.querySelector('[data-display-name-view]');
    const form = node.querySelector('[data-display-name-form]');

    if (!view || !form) return;

    const input = form.elements.displayName;

    const startEditing = () => {
      view.hidden = true;
      form.hidden = false;
      input?.focus();
      input?.select();
    };

    const stopEditing = () => {
      form.hidden = true;
      view.hidden = false;
    };

    view.querySelector('[data-display-name-edit]')?.addEventListener('click', startEditing);
    form.querySelector('[data-display-name-cancel]')?.addEventListener('click', stopEditing);

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stopEditing();
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const nextName = String(input?.value || '').trim();

      if (!nextName) {
        stopEditing();
        return;
      }

      // Re-renders the settings overlay on success.
      await updateOwnChatProfile({
        displayName: nextName,
      });
    });
  }

  async function ownProfileInfo() {
    try {
      const userId = ownUserId();
  
      const user = currentClient?.getUser?.(userId);
      let profile = null;
  
      if (currentClient?.getProfileInfo && userId) {
        profile = await currentClient.getProfileInfo(userId).catch((err) => {
          console.warn('[YANTA Chat Settings] Could not fetch profile info', err);
          toast('Could not refresh profile info.', 'error');
          return null;
        });
      }
  
      return {
        userId,
        handle: yantaHandleFromMxid(userId),
        displayName:
          firstString(
            profile?.displayname,
            user?.displayName,
            user?.displayNameRaw,
            user?.rawDisplayName,
            userId
          ),
        avatarMxc:
          firstString(
            profile?.avatar_url,
            user?.avatarUrl,
            user?.avatar_url,
            ''
          ),
      };
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not read profile info', err);
      toast('Could not read profile.', 'error');
  
      return {
        userId: ownUserId(),
        handle: yantaHandleFromMxid(ownUserId()),
        displayName: ownUserId(),
        avatarMxc: '',
      };
    }
  }
  
  /*
    QR-Inhalt ist eine URL, kein reiner Handle-Text: Handy-Kameras öffnen
    URLs direkt. #chat-dm/<handle> startet in YANTA den New-Chat-Flow.
  */
  function chatDmDeepLinkUrl(handle) {
    return `${location.origin}${location.pathname}#chat-dm/${encodeURIComponent(String(handle || ''))}`;
  }

  async function renderQrInto(host, handle) {
    if (!host) return;

    try {
      const mod = await import('../qr.js');

      if (typeof mod.renderBrandedQrSvg !== 'function') {
        throw new Error('renderBrandedQrSvg is not available.');
      }

      // renderBrandedQrSvg returns an SVGSVGElement, not markup.
      host.replaceChildren(mod.renderBrandedQrSvg(chatDmDeepLinkUrl(handle)));
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not render QR code', err);
      toast('Could not render QR code.', 'error');
  
      host.innerHTML = `
        <div class="yanta-chat-settings-empty-small">
          ${lucide('qr-code', 28)}
          <small>QR unavailable</small>
        </div>
      `;
    }
  }
  
  async function toggleMute() {
    try {
      if (!currentClient?.setRoomMutePushRule) {
        throw new Error('Mute is not supported by this Matrix SDK version.');
      }
  
      await currentClient.setRoomMutePushRule('global', currentRoomId, !isRoomMuted());
      toast(isRoomMuted() ? 'Chat muted' : 'Chat unmuted', 'success');
      await renderSettings();
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not toggle mute', err);
      toast('Could not update notification settings.', 'error');
    }
  }
  
  async function toggleBlockUser(userId) {
    try {
      if (!userId) {
        toast('No user to block.', 'error');
        console.warn('[YANTA Chat Settings] Missing userId for block');
        return;
      }
  
      if (typeof currentClient?.setIgnoredUsers !== 'function') {
        throw new Error('Blocking is not supported by this Matrix SDK version.');
      }
  
      const ignored = new Set(
        currentClient.getIgnoredUsers?.() ||
        currentClient.getAccountData?.('m.ignored_user_list')?.getContent?.()?.ignored_users
          ? Object.keys(currentClient.getAccountData('m.ignored_user_list').getContent().ignored_users || {})
          : []
      );
  
      if (ignored.has(userId)) ignored.delete(userId);
      else ignored.add(userId);
  
      await currentClient.setIgnoredUsers([...ignored]);
  
      toast(ignored.has(userId) ? 'User blocked' : 'User unblocked', 'success');
  
      await renderSettings();
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not block user', err);
      toast('Could not update blocked users.', 'error');
    }
  }
  
  async function leaveCurrentRoom() {
    const name = roomDisplayName();
  
    const ok = await yantaConfirm({
      title: 'Leave chat?',
      message: `Leave "${name}"?\n\nYou may lose access to future messages unless invited again.`,
      confirmLabel: 'Leave chat',
      cancelLabel: 'Cancel',
      danger: true,
      icon: 'log-out',
    });
  
    if (!ok) return;
  
    try {
      await currentClient.leave(currentRoomId);
      toast('Left chat', 'success');
      closeChatSettings();
  
      window.dispatchEvent(new CustomEvent('yanta-chat-room-left', {
        detail: {
          roomId: currentRoomId,
        },
      }));
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not leave room', err);
      toast('Could not leave chat.', 'error');
    }
  }
  
  function verificationApi(client) {
    const cryptoApi = client?.getCrypto?.() || client?.crypto || null;
  
    return {
      cryptoApi,
      requestVerificationDM:
        cryptoApi?.requestVerificationDM ||
        client?.requestVerificationDM ||
        null,
      requestDeviceVerification:
        cryptoApi?.requestDeviceVerification ||
        cryptoApi?.requestVerification ||
        client?.requestVerification ||
        null,
    };
  }
  
  function sasEmojiText(sas = {}) {
    const emoji = sas.emoji || sas.emojis || sas.sas?.emoji || [];
  
    if (!Array.isArray(emoji) || !emoji.length) return '';
  
    return emoji
      .map((item) => Array.isArray(item) ? `${item[0]} ${item[1] || ''}` : String(item))
      .join('\n');
  }
  
  async function waitForSas(requestOrVerifier) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = 0;
  
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
  
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
  
      const maybeVerifier =
        requestOrVerifier?.verifier ||
        requestOrVerifier?.verification ||
        requestOrVerifier;
  
      const onShowSas = async (sas) => {
        finish({
          sas,
          verifier: maybeVerifier,
        });
      };
  
      try {
        maybeVerifier?.on?.('show_sas', onShowSas);
        maybeVerifier?.on?.('ShowSas', onShowSas);
        maybeVerifier?.on?.('cancel', (ev) => fail(new Error(ev?.reason || 'Verification cancelled.')));
        maybeVerifier?.on?.('done', () => finish({ sas: null, verifier: maybeVerifier, done: true }));
  
        requestOrVerifier?.on?.('change', () => {
          const next =
            requestOrVerifier.verifier ||
            requestOrVerifier.verification ||
            null;
  
          if (next && next !== maybeVerifier) {
            next.on?.('show_sas', onShowSas);
            next.on?.('ShowSas', onShowSas);
          }
        });
  
        requestOrVerifier?.accept?.().catch?.((err) => {
          console.warn('[YANTA Chat Settings] Verification accept failed', err);
        });
  
        maybeVerifier?.verify?.().catch?.((err) => {
          if (!/already/i.test(err?.message || '')) fail(err);
        });
  
        timer = setTimeout(() => {
          fail(new Error('Verification timed out.'));
        }, 120_000);
      } catch (err) {
        fail(err);
      }
    });
  }
  
  /**
   * Starts a simple SAS verification flow for the direct chat partner.
   */
  export async function verifyCurrentChatPartner() {
    const room = currentRoom();
    const userId = directUserIdForRoom(currentRoomId);
  
    if (!room || !userId) {
      toast('Verification is available for direct chats.', 'error');
      console.warn('[YANTA Chat Settings] Verification requested without direct user', currentRoomId);
      return;
    }
  
    try {
      const api = verificationApi(currentClient);
  
      if (!api.cryptoApi && !api.requestVerificationDM && !api.requestDeviceVerification) {
        throw new Error('Matrix verification API is not available.');
      }
  
      let request = null;
  
      if (typeof api.requestVerificationDM === 'function') {
        request = await api.requestVerificationDM.call(api.cryptoApi || currentClient, userId);
      } else {
        const members = room.getJoinedMembers?.() || [];
        const member = members.find((m) => m.userId === userId);
        const deviceId =
          member?.events?.member?.getContent?.()?.device_id ||
          '';
  
        if (!deviceId) {
          throw new Error('Could not find a device to verify.');
        }
  
        request = await api.requestDeviceVerification.call(api.cryptoApi || currentClient, userId, deviceId);
      }
  
      toast('Verification request sent. Compare the emojis on both devices.', 'success');
  
      const { sas, verifier, done } = await waitForSas(request);
  
      if (done) {
        toast('Chat verified', 'success');
        await renderSettings();
        return;
      }
  
      const emojiText = sasEmojiText(sas);
  
      const ok = await yantaConfirm({
        title: 'Do the emojis match?',
        message: emojiText || 'Compare the verification emojis shown on both devices.',
        confirmLabel: 'They match',
        cancelLabel: 'Cancel verification',
        icon: 'shield-check',
      });
  
      if (ok) {
        await sas?.confirm?.();
        await verifier?.done?.();
        toast('Chat verified', 'success');
      } else {
        await sas?.cancel?.();
        await verifier?.cancel?.();
        toast('Verification cancelled', 'success');
      }
  
      await renderSettings();
    } catch (err) {
      console.warn('[YANTA Chat Settings] Verification failed', err);
      toast('Could not verify chat.', 'error');
    }
  }
  
  async function showRecoveryKey() {
    const ok = await yantaConfirm({
      title: 'Show recovery key?',
      message:
        'This key can unlock encrypted Chat history when combined with account access.\n\n' +
        'Only show it in a private place. Never send it to anyone.',
      confirmLabel: 'Show recovery key',
      cancelLabel: 'Cancel',
      danger: true,
      icon: 'key-round',
    });
  
    if (!ok) return;
  
    try {
      const recovery = await readChatRecoveryKeyTextForDisplay();
  
      const keyOverlay = el('div', {
        class: 'yanta-chat-settings-overlay yanta-chat-recovery-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Chat recovery key',
      });
  
      keyOverlay.innerHTML = `
        <section class="yanta-chat-settings-card yanta-chat-recovery-card">
          <header class="yanta-chat-settings-head">
            <span class="yanta-chat-settings-head-icon">${lucide('key-round', 22)}</span>
            <span class="yanta-chat-settings-head-title">
              <strong>Chat recovery key</strong>
              <small>Store this somewhere safe.</small>
            </span>
            <span class="grow"></span>
            <button class="icon-btn" data-close title="Close" aria-label="Close">${lucide('x', 18)}</button>
          </header>
  
          <div class="yanta-chat-settings-body">
            <section class="yanta-chat-settings-section danger-soft">
              <h4>Private key material</h4>
              <p>
                Anyone with this key may be able to restore encrypted Chat messages.
                Do not share it.
              </p>
              <pre class="yanta-chat-recovery-key">${escapeHtml(recovery.text)}</pre>
              <div class="yanta-chat-settings-actions">
                <button class="btn primary" data-copy>${lucide('copy', 14)} Copy recovery key</button>
                <button class="btn" data-close>Done</button>
              </div>
            </section>
          </div>
        </section>
      `;
  
      keyOverlay.addEventListener('click', (e) => {
        if (e.target === keyOverlay || e.target.closest?.('[data-close]')) {
          keyOverlay.remove();
        }
  
        if (e.target.closest?.('[data-copy]')) {
          copyText(recovery.text, 'Recovery key copied');
        }
      });
  
      document.body.append(keyOverlay);
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not show recovery key', err);
      toast('Could not show recovery key.', 'error');
    }
  }
  
  async function deprovisionThisDevice() {
    const ok = await yantaConfirm({
      title: 'Deprovision Chat on this device?',
      message:
        'This signs out Chat on this browser and removes local Matrix credentials and crypto stores.\n\n' +
        'Your YANTA notes and synced Vault stay untouched. You can reconnect Chat later from the Vault.',
      confirmLabel: 'Deprovision device',
      cancelLabel: 'Cancel',
      danger: true,
      icon: 'log-out',
    });
  
    if (!ok) return;
  
    try {
      const client = currentClient;
  
      try {
        await client?.logout?.(true);
      } catch (err) {
        console.warn('[YANTA Chat Settings] Matrix logout failed; continuing local deprovision', err);
        toast('Matrix logout failed; local Chat data will still be removed.', 'error');
      }
  
      const session = await import('./matrix-session.js');
      const store = await import('./chat-store.js');
  
      await session.stopChatSession?.({
        silent: true,
      });
  
      await store.clearChatCredentials?.();
      await session.clearChatMatrixLocalStoresForDebugOnly?.();
  
      currentClient = null;
  
      toast('Chat deprovisioned on this device', 'success');
  
      closeChatSettings();
  
      window.dispatchEvent(new CustomEvent('yanta-chat-deprovisioned', {
        detail: {
          ts: Date.now(),
        },
      }));
    } catch (err) {
      console.warn('[YANTA Chat Settings] Could not deprovision Chat', err);
      toast('Could not deprovision Chat.', 'error');
    }
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
    width: min(720px, 94vw);
    max-height: min(800px, 92vh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 22px;
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
  
  .yanta-chat-settings-head-icon {
    display: inline-flex;
    color: var(--accent);
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
  
  .yanta-chat-settings-tabs {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  
  .yanta-chat-settings-tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 11px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--text-dim);
    font-weight: 800;
    cursor: pointer;
    white-space: nowrap;
  }
  
  .yanta-chat-settings-tab:hover {
    color: var(--text);
    background: var(--bg-elev-2);
  }
  
  .yanta-chat-settings-tab.active {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
    background: color-mix(in srgb, var(--accent) 10%, transparent);
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
    border-radius: 18px;
    background: var(--bg-elev-2);
  }
  
  .yanta-chat-settings-section.danger-soft {
    border-color: color-mix(in srgb, var(--red) 34%, var(--border));
    background: color-mix(in srgb, var(--red) 7%, var(--bg-elev-2));
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
  
  .yanta-chat-profile-hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px;
    align-items: center;
  }
  
  .yanta-chat-avatar-xl {
    width: 96px;
    height: 96px;
    display: inline-grid;
    place-items: center;
    overflow: hidden;
    border-radius: 28px;
    border: 1px solid var(--border);
    background: linear-gradient(135deg, var(--bg-elev-3), var(--bg-elev));
    color: var(--accent);
    font-size: 28px;
    font-weight: 900;
  }
  
  .yanta-chat-avatar-xl img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .yanta-chat-avatar-xl.is-editable {
    position: relative;
    padding: 0;
    cursor: pointer;
    transition: border-color .15s ease, box-shadow .15s ease;
  }

  .yanta-chat-avatar-xl.is-editable:hover,
  .yanta-chat-avatar-xl.is-editable:focus-visible {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .yanta-chat-avatar-media {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: inherit;
  }

  .yanta-chat-avatar-edit-overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: inherit;
    background: rgba(0, 0, 0, .45);
    color: #fff;
    opacity: 0;
    transition: opacity .15s ease;
    pointer-events: none;
  }

  .yanta-chat-avatar-xl.is-editable:hover .yanta-chat-avatar-edit-overlay,
  .yanta-chat-avatar-xl.is-editable:focus-visible .yanta-chat-avatar-edit-overlay,
  .yanta-chat-avatar-xl.is-uploading .yanta-chat-avatar-edit-overlay {
    opacity: 1;
  }

  .yanta-chat-avatar-xl.is-uploading .yanta-chat-avatar-edit-overlay svg {
    animation: yanta-chat-avatar-upload-pulse 1.1s ease-in-out infinite;
  }

  @keyframes yanta-chat-avatar-upload-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: .45; transform: scale(.9); }
  }

  /*
    Touch hat kein Hover: kleiner permanenter Kamera-Badge signalisiert
    "Bild antippen zum Ändern".
  */
  .yanta-chat-avatar-edit-badge {
    position: absolute;
    right: -4px;
    bottom: -4px;
    display: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 2px solid var(--bg-elev-2);
    background: var(--accent);
    color: #fff;
    pointer-events: none;
  }

  @media (hover: none), (pointer: coarse) {
    .yanta-chat-avatar-edit-badge {
      display: grid;
    }
  }

  .yanta-chat-display-name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .yanta-chat-display-name[hidden] {
    display: none;
  }

  .yanta-chat-display-name strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .yanta-chat-display-name .icon-btn {
    flex: none;
    opacity: .55;
  }

  .yanta-chat-display-name .icon-btn:hover {
    opacity: 1;
  }

  .yanta-chat-display-name-form {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .yanta-chat-display-name-form[hidden] {
    display: none;
  }

  .yanta-chat-display-name-form input {
    min-width: 0;
    flex: 1;
    font-size: 15px;
    font-weight: 800;
  }

  .yanta-chat-profile-main {
    min-width: 0;
  }
  
  .yanta-chat-profile-main strong {
    display: block;
    color: var(--text);
    font-size: 18px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .yanta-chat-profile-main code {
    display: inline-flex;
    margin-top: 5px;
    padding: 4px 7px;
    border-radius: 999px;
    background: var(--bg-elev);
    color: var(--text-dim);
    font-size: 12px;
  }
  
  .yanta-chat-badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 9px;
  }
  
  .yanta-chat-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 800;
  }
  
  .yanta-chat-badge.good {
    color: var(--green);
    border-color: color-mix(in srgb, var(--green) 35%, var(--border));
    background: color-mix(in srgb, var(--green) 8%, var(--bg-elev));
  }
  
  .yanta-chat-settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  
  .yanta-chat-business-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
  }
  
  .yanta-chat-business-card-qr {
    width: 124px;
    height: 124px;
    display: grid;
    place-items: center;
    border-radius: 18px;
    border: 1px solid var(--border);
    background: var(--bg);
    overflow: hidden;
  }
  
  .yanta-chat-business-card-qr svg {
    width: 100%;
    height: 100%;
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
    background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, white));
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
  
  .yanta-chat-recovery-key {
    max-height: 240px;
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  
  .yanta-chat-settings-empty-small {
    display: grid;
    gap: 6px;
    place-items: center;
    color: var(--text-faint);
    text-align: center;
  }
  
  @media (max-width: 640px) {
    .yanta-chat-business-card,
    .yanta-chat-profile-hero {
      grid-template-columns: 1fr;
    }
  
    .yanta-chat-business-card-qr {
      width: 150px;
      height: 150px;
    }
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
          tab: state?.tab || '',
          scope: state?.scope || '',
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
  
  async function detailsTabHtml() {
    const room = currentRoom();
    const directUserId = directUserIdForRoom(currentRoomId);
    const handle = directUserId || currentRoomId;
    const encrypted = roomIsEncrypted(room);
    const muted = isRoomMuted(currentRoomId);
    const crypto = await getChatCryptoHealth(currentClient);
  
    return `
      <section class="yanta-chat-settings-section">
        <div class="yanta-chat-profile-hero">
          <span class="yanta-chat-avatar-xl" data-room-avatar>${escapeHtml(roomInitials(room))}</span>
  
          <span class="yanta-chat-profile-main">
            <strong>${escapeHtml(roomDisplayName(room))}</strong>
            <code>${escapeHtml(handle)}</code>
  
            <span class="yanta-chat-badges">
              <span class="yanta-chat-badge ${encrypted ? 'good' : ''}">
                ${lucide(encrypted ? 'lock-keyhole' : 'unlock', 12)}
                ${encrypted ? 'Encrypted' : 'Not encrypted'}
              </span>
  
              ${
                muted
                  ? `<span class="yanta-chat-badge">${lucide('bell-off', 12)} Muted</span>`
                  : `<span class="yanta-chat-badge">${lucide('bell', 12)} Notifications on</span>`
              }
  
              ${
                crypto.crossSigningReady
                  ? `<span class="yanta-chat-badge good">${lucide('shield-check', 12)} Verification ready</span>`
                  : `<span class="yanta-chat-badge">${lucide('shield-alert', 12)} Verification pending</span>`
              }
            </span>
          </span>
        </div>
  
        <div class="yanta-chat-settings-actions">
          ${
            directUserId
              ? `<button class="btn primary" data-verify>${lucide('shield-check', 14)} Verify</button>`
              : ''
          }
  
          <button class="btn" data-toggle-mute>
            ${lucide(muted ? 'bell' : 'bell-off', 14)}
            ${muted ? 'Unmute' : 'Mute'}
          </button>
  
          ${
            directUserId
              ? `<button class="btn danger" data-toggle-block>${lucide('ban', 14)} Block / unblock</button>`
              : ''
          }
  
          <button class="btn danger" data-leave-room>${lucide('log-out', 14)} Leave</button>
        </div>
      </section>
  
      <section class="yanta-chat-settings-section">
        <h4>Security</h4>
        <p>
          Encrypted rooms use Matrix end-to-end encryption. Verification helps ensure
          you are talking to the expected device/user.
        </p>
  
        <div class="yanta-chat-settings-actions">
          <button class="btn" data-show-recovery>${lucide('key-round', 14)} Show recovery key</button>
        </div>
      </section>
    `;
  }
  
  async function profileTabHtml() {
    const profile = await ownProfileInfo();
    const initial = (profile.displayName || profile.userId || 'Y').slice(0, 1).toUpperCase();

    return `
      <section class="yanta-chat-settings-section">
        <div class="yanta-chat-profile-hero">
          <button
            type="button"
            class="yanta-chat-avatar-xl is-editable"
            data-avatar-edit
            title="Change profile picture"
            aria-label="Change profile picture">
            <span class="yanta-chat-avatar-media" data-own-avatar>${escapeHtml(initial)}</span>
            <span class="yanta-chat-avatar-edit-overlay">${lucide('camera', 20)}</span>
            <span class="yanta-chat-avatar-edit-badge">${lucide('camera', 13)}</span>
          </button>
          <input type="file" accept="image/*" data-avatar-input hidden>

          <span class="yanta-chat-profile-main">
            <span class="yanta-chat-display-name" data-display-name-view>
              <strong>${escapeHtml(profile.displayName || profile.userId || 'Your profile')}</strong>
              <button class="icon-btn" type="button" data-display-name-edit title="Edit display name" aria-label="Edit display name">
                ${lucide('pencil', 14)}
              </button>
            </span>

            <form class="yanta-chat-display-name-form" data-display-name-form hidden>
              <input
                class="text-input"
                name="displayName"
                value="${escapeHtml(profile.displayName || '')}"
                maxlength="64"
                autocomplete="name"
                aria-label="Display name">
              <button class="icon-btn" type="submit" title="Save name" aria-label="Save name">
                ${lucide('check', 15)}
              </button>
              <button class="icon-btn" type="button" data-display-name-cancel title="Cancel" aria-label="Cancel">
                ${lucide('x', 15)}
              </button>
            </form>

            <code>${escapeHtml(profile.handle || profile.userId || '')}</code>
          </span>
        </div>
      </section>

      <section class="yanta-chat-settings-section">
        <h4>Your YANTA card</h4>
        <p>Scanning the QR code with a phone camera opens an encrypted chat with you.</p>

        <div class="yanta-chat-business-card">
          <span>
            <code>${escapeHtml(profile.handle || '')}</code>
            <div class="yanta-chat-settings-actions">
              <button class="btn" data-copy-handle>${lucide('copy', 14)} Copy handle</button>
              <button class="btn" data-copy-chat-link>${lucide('link', 14)} Copy chat link</button>
            </div>
          </span>

          <span class="yanta-chat-business-card-qr" data-card-qr></span>
        </div>
      </section>
  
      <section class="yanta-chat-settings-section danger-soft">
        <h4>This device</h4>
        <p>Sign out Chat on this browser and remove local Matrix crypto stores.</p>
  
        <div class="yanta-chat-settings-actions">
          <button class="btn danger" data-deprovision>${lucide('log-out', 14)} Deprovision this device</button>
        </div>
      </section>
    `;
  }
  
  async function storageTabHtml() {
    const usage = await getChatMediaCacheUsage();
    const limit = await getChatMediaCacheLimitBytes();
    const roomUsage = usage.byRoom.find((row) => row.roomId === currentRoomId) || {
      roomId: currentRoomId,
      bytes: 0,
      count: 0,
    };
  
    return `
      <section class="yanta-chat-settings-section">
        <h4>Storage management</h4>
        <p>
          Messages stay intact. Only locally cached decrypted media is removed and
          downloaded again on demand.
        </p>
  
        ${storageBarHtml({
          label: 'Total media cache',
          bytes: usage.totalBytes,
          limit,
        })}
  
        <div style="height:10px"></div>
  
        ${
          currentScope === 'room'
            ? `
              <div style="height:10px"></div>
              ${storageBarHtml({
                label: 'This chat',
                bytes: roomUsage.bytes,
                limit: Math.max(limit, roomUsage.bytes),
              })}
            `
            : ''
        }
  
        <div class="yanta-chat-policy-row">
          <label for="chatMediaCachePolicy" style="color:var(--text-dim);font-size:12px;font-weight:750">
            Cache limit
          </label>
  
          <select class="text-input" id="chatMediaCachePolicy" data-cache-policy>
            ${CHAT_MEDIA_CACHE_LIMITS.map((option) => `
              <option value="${option.bytes}" ${Number(option.bytes) === Number(limit) ? 'selected' : ''}>
                ${escapeHtml(option.label)}
              </option>
            `).join('')}
          </select>
        </div>
  
        <div class="yanta-chat-settings-actions">
          ${
            currentScope === 'room'
              ? `<button class="btn" data-clear-room-cache>${lucide('eraser', 14)} Clear this chat cache</button>`
              : ''
          }
          <button class="btn danger" data-clear-all-cache>${lucide('trash', 14)} Clear all media cache</button>
        </div>
      </section>
    `;
  }
  
  async function renderSettings() {
    const node = ensureOverlay();
  
    const tabHtml =
      activeTab === 'profile'
        ? await profileTabHtml()
        : activeTab === 'storage'
          ? await storageTabHtml()
          : await detailsTabHtml();
      
    const tabs = currentScope === 'me'
      ? [
          { id: 'profile', icon: 'user-round', label: 'Profile' },
          { id: 'storage', icon: 'database', label: 'Storage' },
        ]
      : [
          { id: 'details', icon: 'info', label: 'Details' },
          { id: 'storage', icon: 'database', label: 'Storage' },
        ];

    if (!tabs.some((t) => t.id === activeTab)) {
      activeTab = tabs[0].id;
    }

    node.innerHTML = `
      <section class="yanta-chat-settings-card">
        <header class="yanta-chat-settings-head">
          <span class="yanta-chat-settings-head-icon">
            ${lucide(activeTab === 'profile' ? 'user-round' : activeTab === 'storage' ? 'database' : 'settings', 22)}
          </span>
  
          <span class="yanta-chat-settings-head-title">
            <strong>${escapeHtml(activeTab === 'profile' ? 'Profile' : activeTab === 'storage' ? 'Storage' : 'Chat details')}</strong>
            <small>${escapeHtml(currentScope === 'me' ? 'Your YANTA Chat account' : currentRoomName)}</small>
          </span>
  
          <span class="grow"></span>
  
          <button class="icon-btn" data-chat-settings-close title="Close" aria-label="Close">
            ${lucide('x', 18)}
          </button>
        </header>
  
        <nav class="yanta-chat-settings-tabs">
          ${tabs.map((t) => `
            <button class="yanta-chat-settings-tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
              ${lucide(t.icon, 14)} ${escapeHtml(t.label)}
            </button>
          `).join('')}
        </nav>
  
        <div class="yanta-chat-settings-body">
          ${tabHtml}
        </div>
      </section>
    `;
  
    node.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        activeTab = btn.dataset.tab || 'details';
        await renderSettings();
      });
    });
  
    const roomAvatar = node.querySelector('[data-room-avatar]');
    if (roomAvatar) {
      hydrateAvatar(roomAvatar, roomAvatarMxc(), {
        fallback: roomInitials(),
        size: 192,
      });
    }
  
    const profile = activeTab === 'profile' ? await ownProfileInfo() : null;
  
    if (profile) {
      hydrateAvatar(node.querySelector('[data-own-avatar]'), profile.avatarMxc, {
        fallback: (profile.displayName || profile.userId || 'Y').slice(0, 1).toUpperCase(),
        size: 192,
      });
  
      renderQrInto(node.querySelector('[data-card-qr]'), profile.handle || profile.userId || '');

      node.querySelector('[data-copy-handle]')?.addEventListener('click', () => {
        copyText(profile.handle || profile.userId || '', 'Handle copied');
      });

      node.querySelector('[data-copy-chat-link]')?.addEventListener('click', () => {
        copyText(chatDmDeepLinkUrl(profile.handle || profile.userId || ''), 'Chat link copied');
      });

      bindProfileAvatarEditor(node);
      bindProfileDisplayNameEditor(node);
    }
  
    node.querySelector('[data-verify]')?.addEventListener('click', verifyCurrentChatPartner);
    node.querySelector('[data-toggle-mute]')?.addEventListener('click', toggleMute);
  
    node.querySelector('[data-toggle-block]')?.addEventListener('click', () => {
      toggleBlockUser(directUserIdForRoom(currentRoomId));
    });
  
    node.querySelector('[data-leave-room]')?.addEventListener('click', leaveCurrentRoom);
    node.querySelector('[data-show-recovery]')?.addEventListener('click', showRecoveryKey);
    node.querySelector('[data-deprovision]')?.addEventListener('click', deprovisionThisDevice);
  
    node.querySelector('[data-cache-policy]')?.addEventListener('change', async (e) => {
      try {
        const bytes = Number(e.currentTarget.value || 0);
  
        await setChatMediaCacheLimitBytes(bytes);
        await updateStorageMeter();
  
        toast('Media cache policy saved', 'success');
  
        await renderSettings();
      } catch (err) {
        console.warn('[YANTA Chat Settings] Could not update cache policy', err);
        toast('Could not update media cache policy.', 'error');
      }
    });
  
    node.querySelector('[data-clear-room-cache]')?.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: 'Clear this chat cache?',
        message:
          `YANTA will delete locally cached media from "${currentRoomName}".\n\n` +
          'Messages stay intact. Media downloads again on demand.',
        confirmLabel: 'Clear cache',
        cancelLabel: 'Cancel',
        danger: true,
        icon: 'eraser',
      });
  
      if (!ok) return;
  
      try {
        const result = await purgeChatMediaCacheForRoom(currentRoomId);
  
        revokeAllChatMediaObjectUrls();
        await updateStorageMeter();
  
        toast(`Cache cleared: ${fmtBytes(result.bytes)}`, 'success');
  
        await renderSettings();
      } catch (err) {
        console.warn('[YANTA Chat Settings] Could not clear room cache', err);
        toast('Could not clear this chat cache.', 'error');
      }
    });
  
    node.querySelector('[data-clear-all-cache]')?.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: 'Clear all media cache?',
        message:
          'YANTA will delete all locally cached Chat media.\n\n' +
          'Messages stay intact. Media downloads again on demand.',
        confirmLabel: 'Clear all cache',
        cancelLabel: 'Cancel',
        danger: true,
        icon: 'trash',
      });
  
      if (!ok) return;
  
      try {
        const result = await purgeAllChatMediaCache();
  
        revokeAllChatMediaObjectUrls();
        await updateStorageMeter();
  
        toast(`Media cache cleared: ${fmtBytes(result.bytes)}`, 'success');
  
        await renderSettings();
      } catch (err) {
        console.warn('[YANTA Chat Settings] Could not clear all cache', err);
        toast('Could not clear media cache.', 'error');
      }
    });
  }
  
  /**
   * Opens Chat settings.
   *
   * scope 'room': Details + Storage für einen Chat (Klick auf Chat-Kopf).
   * scope 'me':   Eigenes Profil + Storage (List-Head), kein Room nötig.
   */
  export async function openChatSettings({
    client,
    roomId = '',
    roomName = 'Chat',
    tab = '',
    scope = '',
    fromHistory = false,
  } = {}) {
    registerRoute();

    currentClient = client || currentClient;
    currentRoomId = String(roomId || '');
    currentRoomName = roomName || 'Chat';
    currentScope = scope || (tab === 'profile' || !currentRoomId ? 'me' : 'room');
    activeTab = tab || (currentScope === 'me' ? 'profile' : 'details');

    if (currentScope === 'room' && !currentRoomId) {
      toast('No chat selected.', 'error');
      console.warn('[YANTA Chat Settings] Missing roomId for room scope');
      return;
    }

    if (!currentClient) {
      toast('Chat is not connected.', 'error');
      console.warn('[YANTA Chat Settings] Missing Matrix client');
      return;
    }

    const node = ensureOverlay();
    node.hidden = false;

    if (!fromHistory && overlayIdFromState() !== CHAT_SETTINGS_OVERLAY_ID) {
      pushOverlayState(CHAT_SETTINGS_OVERLAY_ID, {
        roomId: currentRoomId,
        roomName: currentRoomName,
        tab: activeTab,
        scope: currentScope,
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
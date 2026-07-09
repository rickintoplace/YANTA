// ============================================================
// YANTA Chat — Composer
// Autogrow, room drafts, attachments, send/mic morph, voice.
// ============================================================

import {
  debounce,
  lucide,
  toast,
} from '../core.js';

import {
  showMenu,
} from '../tree.js';

import {
  chatStore,
} from './chat-store.js';

import {
  setupVoiceRecorder,
} from './chat-voice.js';

import { androidChatMediaStatus } from '../native/android-bridge.js';

const DRAFT_DEBOUNCE_MS = 400;
const MOBILE_MQ = window.matchMedia('(max-width: 760px), (pointer: coarse)');

function assertNativeChatAttachmentsAvailable() {
  const status = androidChatMediaStatus();
  if (!status.isAndroidApp) return true;
  if (status.supported === false) {
    console.warn('[YANTA Chat] Android attachments unavailable', status);
    toast('Attachments are not supported by this Android app version yet. Please update the YANTA app.', 'error');
    return false;
  }
  if (status.filePickerSupported === false || status.storageGranted === false) {
    toast('Allow file access for YANTA in Android settings to send attachments.', 'error');
    return false;
  }
  return true;
}

function isDesktopSendEnter() {
  return !MOBILE_MQ.matches;
}

function supportsFieldSizing() {
  try {
    return CSS.supports?.('field-sizing', 'content') === true;
  } catch {
    return false;
  }
}

/**
 * Installs the AP5 composer into the existing Chat form.
 */
export function setupChatComposer({
  form,
  getClient,
  getRoomId,
  onSendText,
  onSendImage,
  onSendFile,
  onSent = null,
} = {}) {
  if (!form || form.dataset.ap5Composer === '1') return null;

  form.dataset.ap5Composer = '1';

  form.innerHTML = `
    <button
      class="yanta-chat-attach"
      type="button"
      data-chat-attach
      title="Attach"
      aria-label="Attach">
      ${lucide('plus', 19)}
    </button>

    <textarea
      rows="1"
      placeholder="Message…"
      enterkeyhint="send"
      autocomplete="off"
      data-chat-input></textarea>

    <button
      class="yanta-chat-send yanta-chat-action-morph"
      type="submit"
      data-chat-send
      title="Voice message"
      aria-label="Voice message">
      <span class="yanta-chat-action-icon is-mic">${lucide('mic', 18)}</span>
      <span class="yanta-chat-action-icon is-send">${lucide('send-horizontal', 18)}</span>
    </button>

    <input type="file" accept="image/*" data-chat-image-input hidden>
    <input type="file" data-chat-file-input hidden>
  `;

  const textArea = form.querySelector('[data-chat-input]');
  const sendButton = form.querySelector('[data-chat-send]');
  const attachButton = form.querySelector('[data-chat-attach]');
  const imageInput = form.querySelector('[data-chat-image-input]');
  const fileInput = form.querySelector('[data-chat-file-input]');

  let currentRoomId = '';
  let restoring = false;

  const persistDraft = debounce(async () => {
    if (restoring || !currentRoomId) return;

    try {
      await chatStore.drafts.put({
        roomId: currentRoomId,
        text: textArea.value,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.warn('[YANTA Chat] Could not save draft', err);
      toast('Could not save draft.', 'error');
    }
  }, DRAFT_DEBOUNCE_MS);

  function autogrow() {
    if (!textArea) return;

    if (supportsFieldSizing()) {
      textArea.style.height = '';
      return;
    }

    textArea.style.height = 'auto';
    textArea.style.height = `${Math.min(textArea.scrollHeight, window.innerHeight * 0.4)}px`;
  }

  function updateMorph() {
    const hasText = !!textArea.value.trim();

    form.classList.toggle('has-text', hasText);
    sendButton.title = hasText ? 'Send' : 'Voice message';
    sendButton.setAttribute('aria-label', sendButton.title);
  }

  async function sendTextNow() {
    const text = textArea.value.trim();

    if (!text) return;

    const roomId = currentRoomId;

    textArea.value = '';
    autogrow();
    updateMorph();

    try {
      await chatStore.drafts.del(roomId);
    } catch (err) {
      console.warn('[YANTA Chat] Could not clear draft', err);
      toast('Could not clear draft.', 'error');
    }

    try {
      await onSendText?.(text);
      onSent?.();
    } catch (err) {
      console.warn('[YANTA Chat] Could not send text message', err);
      toast('Could not send message.', 'error');

      // Restore unsent text for UX.
      textArea.value = text;
      autogrow();
      updateMorph();

      throw err;
    }
  }

  function openAttachMenu(e = null) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    e?.stopImmediatePropagation?.();

    if (!attachButton) {
      console.warn('[YANTA Chat] Attach button missing');
      toast('Attachment menu is not available.', 'error');
      return;
    }

    try {
      const r = attachButton.getBoundingClientRect();

      /*
        Warum:
        showMenu appends to document.body. The Chat surface/window may have a
        higher stacking context, so we mark this menu and force a high z-index.
      */
      const menu = showMenu(
        Math.max(8, r.left),
        r.top > 240 ? r.top - 8 : r.bottom + 8,
        [
          {
            label: 'Photo',
            icon: 'image',
            action: () => {
              if (!assertNativeChatAttachmentsAvailable()) return;
              imageInput?.click();
            },
          },
          {
            label: 'File',
            icon: 'paperclip',
            action: () => {
              if (!assertNativeChatAttachmentsAvailable()) return;
              fileInput?.click();
            },
          },
          'hr',
          {
            label: 'YANTA Note',
            icon: 'file-text',
            disabled: true,
            action: () => toast('YANTA Note attachments are coming in AP8.', 'error'),
          },
          {
            label: 'YANTA Event',
            icon: 'calendar',
            disabled: true,
            action: () => toast('YANTA Event attachments are coming in AP8.', 'error'),
          },
          {
            label: 'Drawing',
            icon: 'line-squiggle',
            disabled: true,
            action: () => toast('Drawing attachments are coming in AP8.', 'error'),
          },
        ],
        {
          align: 'start',
        }
      );

      menu?.classList?.add('yanta-chat-attach-menu');
      menu?.style?.setProperty('z-index', '10080', 'important');
    } catch (err) {
      console.warn('[YANTA Chat] Could not open attachment menu', err);
      toast('Could not open attachment menu.', 'error');
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (!textArea.value.trim()) return;

    sendTextNow().catch((err) => {
      console.warn('[YANTA Chat] Submit failed', err);
      toast('Could not send message.', 'error');
    });
  });

  textArea.addEventListener('input', () => {
    autogrow();
    updateMorph();
    persistDraft();
  });

  textArea.addEventListener('keydown', (e) => {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.isComposing &&
      isDesktopSendEnter()
    ) {
      e.preventDefault();

      sendTextNow().catch((err) => {
        console.warn('[YANTA Chat] Enter-send failed', err);
        toast('Could not send message.', 'error');
      });
    }
  });

  /*
    Use pointerdown instead of click so the composer/mic pointer handling and
    menu outside-close logic cannot swallow the action on touch devices.
  */
  attachButton.addEventListener('pointerdown', (e) => openAttachMenu(e), true);

  attachButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, true);


  imageInput.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    imageInput.value = '';

    if (!file) return;

    try {
      await onSendImage?.(file);
      onSent?.();
    } catch (err) {
      console.warn('[YANTA Chat] Could not send selected image', err);
      toast('Could not send photo.', 'error');
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';

    if (!file) return;

    try {
      await onSendFile?.(file);
      onSent?.();
    } catch (err) {
      console.warn('[YANTA Chat] Could not send selected file', err);
      toast('Could not send file.', 'error');
    }
  });

  setupVoiceRecorder({
    form,
    micButton: sendButton,
    textArea,
    getClient,
    getRoomId,
    onSent,
  });

  return {
    /**
     * Restores the draft for the active room.
     */
    async setRoom(roomId) {
      currentRoomId = String(roomId || '');

      restoring = true;

      try {
        const draft = currentRoomId
          ? await chatStore.drafts.get(currentRoomId, null)
          : null;

        textArea.value = draft?.text || '';
        autogrow();
        updateMorph();
      } catch (err) {
        console.warn('[YANTA Chat] Could not restore draft', err);
        toast('Could not restore draft.', 'error');
      } finally {
        restoring = false;
      }
    },

    /**
     * Focuses the composer input.
     */
    focus() {
      textArea.focus();
    },

    /**
     * Returns the underlying textarea.
     */
    input() {
      return textArea;
    },
  };
}
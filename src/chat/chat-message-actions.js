// ============================================================
// YANTA Chat — Message context actions (menu, reply, selection)
// ============================================================
import {
  el,
  escapeHtml,
  lucide,
  toast,
} from '../core.js';
import {
  yantaConfirm,
  yantaPrompt,
} from '../dialogs.js';
import {
  messagePreview,
} from './chat-message-render.js';
import {
  createChatSelection,
} from './chat-selection.js';
import {
  openChatForwardPicker,
} from './chat-forward.js';

let menuEl = null;

const COARSE_MQ = window.matchMedia('(pointer: coarse)');

/*
  Doppelklick auf diese Elemente ist Textauswahl-Intention (Wort markieren),
  kein Reply-Trigger — wie in Telegram.
*/
const TEXT_TARGET_SELECTOR = [
  '.yanta-chat-message-text',
  '.yanta-chat-image-caption',
  '.yanta-chat-reply-preview',
  '.yanta-chat-sender',
  '.yanta-chat-redacted',
  'pre',
  'code',
].join(', ');

const INTERACTIVE_TARGET_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'audio',
  'video',
  'img',
  '.yanta-chat-image-message',
  '.yanta-chat-voice',
  '.yanta-chat-file-card',
  '.yanta-chat-embed-card',
].join(', ');

function eventId(event) {
  return event?.getId?.() || event?.event?.event_id || '';
}
function eventType(event) {
  return event?.getType?.() || event?.event?.type || '';
}
function eventSender(event) {
  return event?.getSender?.() || event?.event?.sender || '';
}
function eventContent(event) {
  return event?.getClearContent?.() || event?.getContent?.() || event?.event?.content || {};
}
function eventText(event) {
  return String(eventContent(event).body || '').trim();
}
function isOwnEvent(client, event) {
  return !!client?.getUserId?.() && eventSender(event) === client.getUserId();
}

function closeChatMessageMenu() {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener('pointerdown', onOutsidePointer, true);
  document.removeEventListener('keydown', onMenuKey, true);
}
function onOutsidePointer(e) {
  if (menuEl?.contains(e.target)) return;
  closeChatMessageMenu();
}
function onMenuKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeChatMessageMenu();
  }
}

function ensureMenuCss() {
  if (document.getElementById('yanta-chat-message-menu-css')) return;
  const style = document.createElement('style');
  style.id = 'yanta-chat-message-menu-css';
  style.textContent = `
.yanta-chat-message-menu {
  position: fixed;
  z-index: 30000;
  min-width: 210px;
  max-width: min(320px, calc(100vw - 16px));
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev);
  color: var(--text);
  box-shadow: 0 18px 60px rgba(0,0,0,.36);
  backdrop-filter: blur(14px);
}
.yanta-chat-message-menu button {
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: 18px minmax(0,1fr);
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 720;
  text-align: left;
  cursor: pointer;
}
.yanta-chat-message-menu button:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}
.yanta-chat-message-menu button.danger {
  color: var(--red);
}
.yanta-chat-message-menu hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 5px;
}
`;
  document.head.append(style);
}

async function copyText(event) {
  const text = eventText(event);
  if (!text) {
    toast('No text to copy.', 'error');
    return;
  }
  await navigator.clipboard.writeText(text);
  toast('Copied', 'success');
}

async function editMessage({
  client,
  roomId,
  event,
  onReload,
}) {
  const content = eventContent(event);
  if (content.msgtype !== 'm.text') {
    toast('Only text messages can be edited.', 'error');
    return;
  }
  const oldText = String(content.body || '');
  const nextText = await yantaPrompt({
    title: 'Edit message',
    message: 'Update your message.',
    label: 'Message',
    value: oldText,
    multiline: true,
    required: true,
    confirmLabel: 'Save',
    icon: 'pencil',
  });
  const clean = String(nextText || '').trim();
  if (!clean || clean === oldText.trim()) return;
  await client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: `* ${clean}`,
    'm.new_content': {
      msgtype: 'm.text',
      body: clean,
    },
    'm.relates_to': {
      rel_type: 'm.replace',
      event_id: eventId(event),
    },
  });
  toast('Message edited', 'success');
  await onReload?.();
}

async function deleteMessage({
  client,
  roomId,
  event,
  onReload,
}) {
  const ok = await yantaConfirm({
    title: 'Delete message?',
    message: 'This redacts the Matrix event for everyone in the room.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    danger: true,
    icon: 'trash',
  });
  if (!ok) return;
  await client.redactEvent(roomId, eventId(event));
  toast('Message deleted', 'success');
  await onReload?.();
}

async function showInfo(event) {
  await yantaConfirm({
    title: 'Message info',
    message: [
      `Event: ${eventId(event)}`,
      `Type: ${eventType(event)}`,
      `Sender: ${eventSender(event)}`,
      `Time: ${new Date(event?.getTs?.() || Date.now()).toLocaleString()}`,
      '',
      messagePreview(event) || eventText(event) || 'No preview',
    ].join('\n'),
    confirmLabel: 'OK',
    cancelLabel: '',
    icon: 'info',
  });
}

function menuButton({
  icon,
  label,
  danger = false,
  action,
}) {
  const btn = el('button', {
    type: 'button',
    class: danger ? 'danger' : '',
  });
  btn.innerHTML = `${lucide(icon, 15)} <span>${escapeHtml(label)}</span>`;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeChatMessageMenu();
    try {
      await action?.();
    } catch (err) {
      console.warn('[YANTA Chat] message action failed', err);
      toast('Action failed.', 'error');
    }
  });
  return btn;
}

function openMenu({
  x,
  y,
  event,
  client,
  roomId,
  onReply,
  onReload,
  selection,
}) {
  ensureMenuCss();
  closeChatMessageMenu();
  const own = isOwnEvent(client, event);
  const hasText = !!eventText(event);
  menuEl = el('div', {
    class: 'yanta-chat-message-menu',
    role: 'menu',
  });
  menuEl.append(
    menuButton({
      icon: 'reply',
      label: 'Reply',
      action: () => onReply?.(event),
    })
  );
  if (own) {
    menuEl.append(
      menuButton({
        icon: 'pencil',
        label: 'Edit',
        action: () => editMessage({
          client,
          roomId,
          event,
          onReload,
        }),
      })
    );
  }
  menuEl.append(
    menuButton({
      icon: 'check-square',
      label: 'Select',
      action: () => selection?.enterWith(eventId(event)),
    })
  );
  if (hasText) {
    menuEl.append(
      menuButton({
        icon: 'copy',
        label: 'Copy Text',
        action: () => copyText(event),
      })
    );
  }
  if (eventType(event) === 'm.sticker') {
    menuEl.append(
      menuButton({
        icon: 'shapes',
        label: 'Add to library',
        action: async () => {
          const { addStickerToUserPack } = await import('./chat-stickers.js');
          const result = await addStickerToUserPack(client, eventContent(event));

          toast(
            result.existed
              ? 'Sticker is already in your library'
              : 'Sticker added to your library',
            'success'
          );
        },
      })
    );
  }
  menuEl.append(
    menuButton({
      icon: 'forward',
      label: 'Forward',
      action: () => openChatForwardPicker({
        client,
        sourceRoomId: roomId,
        events: [event],
      }),
    }),
    menuButton({
      icon: 'info',
      label: 'Info',
      action: () => showInfo(event),
    })
  );
  if (own) {
    menuEl.append(document.createElement('hr'));
    menuEl.append(
      menuButton({
        icon: 'trash',
        label: 'Delete',
        danger: true,
        action: () => deleteMessage({
          client,
          roomId,
          event,
          onReload,
        }),
      })
    );
  }
  document.body.append(menuEl);
  const rect = menuEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, x));
  const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, y));
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('keydown', onMenuKey, true);
  }, 0);
}

function rowFromTarget(root, target) {
  const row = target?.closest?.('.yanta-chat-event[data-event-id]');
  return row && root.contains(row) ? row : null;
}

function eventForRow(row, getEvents) {
  const id = row?.dataset?.eventId || '';
  if (!id) return null;
  return (getEvents?.() || []).find((ev) => eventId(ev) === id) || null;
}

/**
 * Installs message context actions and returns { selection }.
 */
export function installChatMessageActions({
  root,
  getClient,
  getRoomId,
  getEvents,
  onReply,
  onReload,
} = {}) {
  if (!root || root.dataset.chatMessageActionsInstalled === '1') return null;
  root.dataset.chatMessageActionsInstalled = '1';
  ensureMenuCss();

  const selection = createChatSelection({
    root,
    getClient,
    getRoomId,
    getEvents,
    onReply,
    onReload,
  });

  let longPress = null;
  let longPressTimer = 0;
  const clearLongPress = () => {
    clearTimeout(longPressTimer);
    longPressTimer = 0;
    longPress = null;
  };

  // Rechtsklick (Desktop) → Kontextmenü.
  // Long-Press-contextmenu (Android/Chrome) → Selection-Modus statt Menü.
  document.addEventListener('contextmenu', (e) => {
    if (!root || root.hidden) return;
    const row = rowFromTarget(root, e.target);
    if (!row) return;
    const event = eventForRow(row, getEvents);
    if (!event) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    if (COARSE_MQ.matches) {
      selection.enterWith(row.dataset.eventId || '');
      return;
    }
    openMenu({
      x: e.clientX,
      y: e.clientY,
      event,
      client: getClient?.(),
      roomId: getRoomId?.(),
      onReply,
      onReload,
      selection,
    });
  }, true);

  // Doppelklick → Reply, aber NICHT auf Text (Browser-Wortmarkierung).
  document.addEventListener('dblclick', (e) => {
    if (!root || root.hidden) return;
    if (selection.isActive()) return;
    if (e.target.closest?.('a,button,input,textarea,select')) return;
    if (e.target.closest?.(TEXT_TARGET_SELECTOR)) return;
    const row = rowFromTarget(root, e.target);
    if (!row) return;
    const event = eventForRow(row, getEvents);
    if (!event) return;
    e.preventDefault();
    onReply?.(event);
  }, true);

  // Mobil: Tap auf Nachricht (außerhalb interaktiver Elemente) → Kontextmenü.
  document.addEventListener('click', (e) => {
    if (!root || root.hidden) return;
    if (!e.isTrusted) return;
    if (!COARSE_MQ.matches) return;
    if (selection.isActive()) return;
    if (e.target.closest?.(INTERACTIVE_TARGET_SELECTOR)) return;
    const row = rowFromTarget(root, e.target);
    if (!row) return;
    const event = eventForRow(row, getEvents);
    if (!event) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu({
      x: e.clientX,
      y: e.clientY,
      event,
      client: getClient?.(),
      roomId: getRoomId?.(),
      onReply,
      onReload,
      selection,
    });
  }, true);

  // Mobil: Long-Press → Multiselect-Modus (Telegram-Verhalten).
  document.addEventListener('pointerdown', (e) => {
    if (!root || root.hidden) return;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (selection.isActive()) return;
    const row = rowFromTarget(root, e.target);
    if (!row) return;
    longPress = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      row,
    };
    longPressTimer = window.setTimeout(() => {
      if (!longPress) return;
      try {
        navigator.vibrate?.(8);
      } catch {}
      selection.enterWith(longPress.row.dataset.eventId || '');
      clearLongPress();
    }, 480);
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!longPress || e.pointerId !== longPress.pointerId) return;
    if (Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 10) {
      clearLongPress();
    }
  }, true);
  document.addEventListener('pointerup', clearLongPress, true);
  document.addEventListener('pointercancel', clearLongPress, true);

  return {
    selection,
  };
}
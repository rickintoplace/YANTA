// ============================================================
// YANTA Chat — Message context actions
// ============================================================

import {
  escapeHtml,
  lucide,
  toast,
} from '../core.js';

import {
  showMenu,
} from '../tree.js';

import {
  yantaConfirm,
  yantaPrompt,
} from '../dialogs.js';

import {
  messagePreview,
} from './chat-message-render.js';

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
  const content = eventContent(event);
  return String(content.body || '').trim();
}

function isOwnEvent(client, event) {
  const own = client?.getUserId?.() || '';
  return !!own && eventSender(event) === own;
}

function eventFromRow(row, getEvents) {
  const id = row?.dataset?.eventId || '';

  if (!id) return null;

  return (getEvents?.() || []).find((ev) => eventId(ev) === id) || null;
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

  const targetId = eventId(event);

  await client.sendMessage(roomId, {
    msgtype: 'm.text',
    body: `* ${clean}`,
    'm.new_content': {
      msgtype: 'm.text',
      body: clean,
    },
    'm.relates_to': {
      rel_type: 'm.replace',
      event_id: targetId,
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

async function infoMessage(event) {
  const content = eventContent(event);

  await yantaConfirm({
    title: 'Message info',
    message: [
      `Event: ${eventId(event)}`,
      `Type: ${eventType(event)}`,
      `Sender: ${eventSender(event)}`,
      `Time: ${new Date(event?.getTs?.() || Date.now()).toLocaleString()}`,
      '',
      messagePreview(event) || JSON.stringify(content).slice(0, 500),
    ].join('\n'),
    confirmLabel: 'OK',
    cancelLabel: '',
    icon: 'info',
  });
}

function openContextMenu({
  x,
  y,
  client,
  roomId,
  event,
  onReply,
  onReload,
}) {
  const own = isOwnEvent(client, event);
  const text = eventText(event);

  showMenu(x, y, [
    {
      label: 'Reply',
      icon: 'reply',
      action: () => onReply?.(event),
    },
    own && {
      label: 'Edit',
      icon: 'pencil',
      action: () => editMessage({
        client,
        roomId,
        event,
        onReload,
      }),
    },
    text && {
      label: 'Copy Text',
      icon: 'copy',
      action: () => copyText(event),
    },
    {
      label: 'Select',
      icon: 'check-square',
      action: () => {
        window.dispatchEvent(new CustomEvent('yanta-chat-select-message', {
          detail: {
            roomId,
            eventId: eventId(event),
          },
        }));
      },
    },
    {
      label: 'Forward',
      icon: 'forward',
      action: () => toast('Forward is coming soon.', 'error'),
    },
    {
      label: 'Pin',
      icon: 'pin',
      action: () => toast('Pinning is coming soon.', 'error'),
    },
    {
      label: 'Info',
      icon: 'info',
      action: () => infoMessage(event),
    },
    own && 'hr',
    own && {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      action: () => deleteMessage({
        client,
        roomId,
        event,
        onReload,
      }),
    },
  ].filter(Boolean), {
    align: 'start',
  });
}

export function installChatMessageActions({
  root,
  getClient,
  getRoomId,
  getEvents,
  onReply,
  onReload,
} = {}) {
  if (!root || root.dataset.chatMessageActionsInstalled === '1') return;

  root.dataset.chatMessageActionsInstalled = '1';

  let longPressTimer = 0;
  let longPressStart = null;

  function clearLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = 0;
    longPressStart = null;
  }

  root.addEventListener('contextmenu', (e) => {
    const row = e.target.closest?.('.yanta-chat-event[data-event-id]');

    if (!row || !root.contains(row)) return;

    const event = eventFromRow(row, getEvents);

    if (!event) return;

    e.preventDefault();
    e.stopPropagation();

    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      client: getClient?.(),
      roomId: getRoomId?.(),
      event,
      onReply,
      onReload,
    });
  }, true);

  root.addEventListener('dblclick', (e) => {
    const row = e.target.closest?.('.yanta-chat-event[data-event-id]');

    if (!row || !root.contains(row)) return;

    if (e.target.closest?.('a, button, input, textarea, select')) return;

    const event = eventFromRow(row, getEvents);

    if (!event) return;

    e.preventDefault();
    onReply?.(event);
  }, true);

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;

    const row = e.target.closest?.('.yanta-chat-event[data-event-id]');

    if (!row || !root.contains(row)) return;

    const event = eventFromRow(row, getEvents);

    if (!event) return;

    longPressStart = {
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      event,
    };

    longPressTimer = window.setTimeout(() => {
      if (!longPressStart) return;

      try {
        navigator.vibrate?.(8);
      } catch {}

      openContextMenu({
        x: longPressStart.x,
        y: longPressStart.y,
        client: getClient?.(),
        roomId: getRoomId?.(),
        event: longPressStart.event,
        onReply,
        onReload,
      });

      clearLongPress();
    }, 480);
  }, true);

  root.addEventListener('pointermove', (e) => {
    if (!longPressStart || e.pointerId !== longPressStart.pointerId) return;

    const dist = Math.hypot(e.clientX - longPressStart.x, e.clientY - longPressStart.y);

    if (dist > 10) clearLongPress();
  }, true);

  root.addEventListener('pointerup', clearLongPress, true);
  root.addEventListener('pointercancel', clearLongPress, true);
}
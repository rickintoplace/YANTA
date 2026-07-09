// ============================================================
// YANTA Chat — Message context actions
// ============================================================

import {
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
  return String(eventContent(event).body || '').trim();
}

function isOwnEvent(client, event) {
  return !!client?.getUserId?.() && eventSender(event) === client.getUserId();
}

function closestMessageRow(target, root) {
  const row = target?.closest?.('.yanta-chat-event[data-event-id]');

  if (!row || !root?.contains?.(row)) return null;

  return row;
}

function findEvent(row, getEvents) {
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

function selectedIds() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem('yanta.chat.selectedMessages.v1') || '[]'));
  } catch {
    return new Set();
  }
}

function writeSelectedIds(ids) {
  try {
    sessionStorage.setItem('yanta.chat.selectedMessages.v1', JSON.stringify([...ids]));
  } catch {}
}

function toggleSelect(row) {
  const id = row?.dataset?.eventId || '';
  if (!id) return;

  const ids = selectedIds();

  if (ids.has(id)) {
    ids.delete(id);
    row.classList.remove('is-selected');
  } else {
    ids.add(id);
    row.classList.add('is-selected');
  }

  writeSelectedIds(ids);
}

function openMenu({
  x,
  y,
  row,
  event,
  client,
  roomId,
  onReply,
  onReload,
}) {
  const own = isOwnEvent(client, event);
  const hasText = !!eventText(event);

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
    {
      label: 'Select',
      icon: 'check-square',
      action: () => toggleSelect(row),
    },
    hasText && {
      label: 'Copy Text',
      icon: 'copy',
      action: () => copyText(event),
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
      action: () => showInfo(event),
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

  let longPress = null;
  let longPressTimer = 0;

  const clearLongPress = () => {
    clearTimeout(longPressTimer);
    longPressTimer = 0;
    longPress = null;
  };

  document.addEventListener('contextmenu', (e) => {
    if (!root || root.hidden) return;

    const row = closestMessageRow(e.target, root);
    if (!row) return;

    const event = findEvent(row, getEvents);
    if (!event) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    openMenu({
      x: e.clientX,
      y: e.clientY,
      row,
      event,
      client: getClient?.(),
      roomId: getRoomId?.(),
      onReply,
      onReload,
    });
  }, true);

  document.addEventListener('dblclick', (e) => {
    if (!root || root.hidden) return;
    if (e.target.closest?.('a,button,input,textarea,select')) return;

    const row = closestMessageRow(e.target, root);
    if (!row) return;

    const event = findEvent(row, getEvents);
    if (!event) return;

    e.preventDefault();
    onReply?.(event);
  }, true);

  document.addEventListener('pointerdown', (e) => {
    if (!root || root.hidden) return;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;

    const row = closestMessageRow(e.target, root);
    if (!row) return;

    const event = findEvent(row, getEvents);
    if (!event) return;

    longPress = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      row,
      event,
    };

    longPressTimer = window.setTimeout(() => {
      if (!longPress) return;

      try {
        navigator.vibrate?.(8);
      } catch {}

      openMenu({
        x: longPress.x,
        y: longPress.y,
        row: longPress.row,
        event: longPress.event,
        client: getClient?.(),
        roomId: getRoomId?.(),
        onReply,
        onReload,
      });

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
}
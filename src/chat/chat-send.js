// ============================================================
// YANTA Chat — shared send primitives
//
// Small, dependency-light helpers used by both the forward picker
// (chat-forward.js) and the Web Share Target router (share-target/). Kept
// separate so neither feature owns the other, and so the share router can
// pull only what it needs (the heavy media path is lazy-imported below).
// ============================================================

export function roomDisplayName(client, room) {
  return (
    room?.name ||
    room?.getDefaultRoomName?.(client?.getUserId?.()) ||
    room?.roomId ||
    'Chat'
  );
}

export function visibleRooms(client) {
  try {
    return client?.getVisibleRooms?.() || client?.getRooms?.() || [];
  } catch {
    return [];
  }
}

export async function sendRoomMessage(client, roomId, content) {
  if (typeof client?.sendMessage === 'function') {
    return client.sendMessage(roomId, content);
  }
  if (typeof client?.sendEvent === 'function') {
    return client.sendEvent(roomId, 'm.room.message', content);
  }
  throw new Error('Matrix sendMessage is not available.');
}

/** Plain text/link message. */
export async function sendTextToRoom(client, roomId, text) {
  const body = String(text || '').trim();
  if (!body) return null;

  return sendRoomMessage(client, roomId, {
    msgtype: 'm.text',
    body,
  });
}

/**
 * Encrypted file/image message. Lazy-imports the media path so text-only
 * shares never pull the (heavier) attachment/crypto code into the bundle.
 */
export async function sendFileToRoom(client, roomId, file) {
  if (!file) return null;

  const { sendFileMessage } = await import('./chat-media.js');
  return sendFileMessage(client, roomId, file);
}

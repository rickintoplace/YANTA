// ============================================================
// YANTA Chat — Matrix room / DM actions
// ============================================================

import {
  toast,
} from '../core.js';

async function matrixSessionModule() {
  try {
    return await import('./matrix-session.js');
  } catch (err) {
    console.warn('[YANTA Chat] Could not load matrix-session.js', err);
    toast('Could not load Chat session.', 'error');
    return {};
  }
}

async function chatApiModule() {
  try {
    return await import('./chat-api.js');
  } catch {
    return {};
  }
}

/**
 * Resolve the active Matrix client from existing YANTA chat modules.
 *
 * The chat session module already owns credentials/crypto. This helper avoids
 * duplicating secret handling and intentionally never reads localStorage.
 */
export async function resolveMatrixClient() {
  const session = await matrixSessionModule();
  const api = await chatApiModule();

  const sessionNow =
    typeof session.getChatSession === 'function'
      ? session.getChatSession()
      : null;

  const candidates = [
    sessionNow?.client,
    session.getMatrixClient?.(),
    session.getChatClient?.(),
    session.currentMatrixClient?.(),
    session.matrixClient,
    session.chatClient,
    session.client,

    api.getMatrixClient?.(),
    api.getChatClient?.(),
    api.currentMatrixClient?.(),
    api.matrixClient,
    api.chatClient,
    api.client,

    window.yantaChatSession?.client,
    window.yantaMatrixClient,
    window.yantaChatClient,
    window.matrixClient,
  ];

  for (const candidate of candidates) {
    const client = await Promise.resolve(candidate).catch(() => null);

    if (client?.getVisibleRooms || client?.getRooms) {
      return client;
    }
  }

  return null;
}

function normalizeUserId(input, {
  defaultServer = 'matrix.org',
} = {}) {
  const raw = String(input || '').trim();

  if (!raw) return '';

  if (/^@[^:\s]+:[^:\s]+$/.test(raw)) {
    return raw;
  }

  if (raw.startsWith('@') && !raw.includes(':')) {
    return `${raw}:${defaultServer}`;
  }

  if (!raw.startsWith('@') && raw.includes(':')) {
    return `@${raw}`;
  }

  // YANTA handle fallback: treat plain handles as matrix.org users for now.
  return `@${raw.replace(/^@/, '')}:${defaultServer}`;
}

function directAccountData(client) {
  try {
    return client.getAccountData?.('m.direct')?.getContent?.() || {};
  } catch {
    return {};
  }
}

function visibleRooms(client) {
  try {
    return client.getVisibleRooms?.() || client.getRooms?.() || [];
  } catch {
    return [];
  }
}

function existingDmRoomIdFor(client, userId) {
  const direct = directAccountData(client);
  const candidates = Array.isArray(direct[userId]) ? direct[userId] : [];
  const rooms = new Set(visibleRooms(client).map((room) => room.roomId));

  return candidates.find((roomId) => rooms.has(roomId)) || '';
}

async function setDirectRoom(client, userId, roomId) {
  const direct = {
    ...directAccountData(client),
  };

  const list = Array.isArray(direct[userId])
    ? [...direct[userId]]
    : [];

  if (!list.includes(roomId)) {
    list.unshift(roomId);
  }

  direct[userId] = list;

  await client.setAccountData('m.direct', direct);
}

/**
 * Create or open a direct Matrix chat and maintain m.direct account data.
 *
 * @param {string} input Matrix user id or YANTA handle.
 * @returns {Promise<string>} roomId.
 */
export async function createDm(input) {
  const client = await resolveMatrixClient();

  if (!client) {
    toast('Chat is not connected.', 'error');
    throw new Error('Matrix client is not available.');
  }

  const userId = normalizeUserId(input);

  if (!userId) {
    toast('Enter a Matrix user id.', 'error');
    throw new Error('Missing Matrix user id.');
  }

  const existingRoomId = existingDmRoomIdFor(client, userId);

  if (existingRoomId) {
    return existingRoomId;
  }

  try {
    const shouldEncrypt =
      !!client.getCrypto?.() ||
      client.isCryptoEnabled?.() === true ||
      client.cryptoBackend;

    const initialState = shouldEncrypt
      ? [
          {
            type: 'm.room.encryption',
            state_key: '',
            content: {
              algorithm: 'm.megolm.v1.aes-sha2',
            },
          },
        ]
      : [];

    const result = await client.createRoom({
      preset: 'trusted_private_chat',
      visibility: 'private',
      is_direct: true,
      invite: [userId],
      initial_state: initialState,
    });

    const roomId = result?.room_id || result?.roomId || '';

    if (!roomId) {
      throw new Error('Homeserver did not return a room id.');
    }

    await setDirectRoom(client, userId, roomId);

    toast('Chat created', 'success');

    return roomId;
  } catch (err) {
    console.warn('[YANTA Chat] Could not create DM', err);
    toast(err?.message || 'Could not create chat.', 'error');
    throw err;
  }
}

/**
 * Leave a Matrix room.
 */
export async function leaveRoom(roomId) {
  const client = await resolveMatrixClient();

  if (!client) {
    toast('Chat is not connected.', 'error');
    throw new Error('Matrix client is not available.');
  }

  try {
    await client.leave(roomId);
    toast('Left chat', 'success');
  } catch (err) {
    console.warn('[YANTA Chat] Could not leave room', err);
    toast('Could not leave chat.', 'error');
    throw err;
  }
}

/**
 * Toggle Matrix room mute push rule.
 */
export async function toggleRoomMute(roomId) {
  const client = await resolveMatrixClient();

  if (!client) {
    toast('Chat is not connected.', 'error');
    throw new Error('Matrix client is not available.');
  }

  try {
    const rule = client.getRoomPushRule?.('global', roomId);
    const muted = !!rule?.actions?.some?.((action) => action === 'dont_notify');

    if (typeof client.setRoomMutePushRule !== 'function') {
      throw new Error('Mute is not supported by this Matrix SDK version.');
    }

    await client.setRoomMutePushRule('global', roomId, !muted);
    toast(!muted ? 'Chat muted' : 'Chat unmuted', 'success');
  } catch (err) {
    console.warn('[YANTA Chat] Could not toggle mute', err);
    toast('Could not update chat notifications.', 'error');
    throw err;
  }
}
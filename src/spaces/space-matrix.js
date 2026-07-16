// ============================================================
// YANTA Shared Spaces — Matrix key delivery
//
// Space keys reach invited YANTA users as custom events inside the
// existing E2EE Matrix DM (Megolm encrypts the whole payload, so
// neither homeserver nor worker ever see key material):
//
//   me.yanta.space.invite.v1   { v, spaceId, sourceType, title,
//                                bundle: { k, ws?, ep }, ts }
//   me.yanta.space.revoke.v1   { v, spaceId, ts }        (UX cleanup;
//                                the server block is authoritative)
//   me.yanta.space.key_request.v1 { v, spaceId, ts }     (recipient
//                                lost the bundle; owner re-sends)
//
// Delivery is asynchronous by design: events wait in room history
// until the recipient's YANTA opens, and the startup backfill scan
// picks up anything missed while offline.
// ============================================================

import { store } from '../core.js';
import {
  resolveMatrixClient,
  createDm,
} from '../chat/chat-actions.js';

import {
  mountSpaceFromInvite,
  leaveSpace,
  apiListSpaceMembers,
} from './space-session.js';

export const SPACE_INVITE_EVENT = 'me.yanta.space.invite.v1';
export const SPACE_REVOKE_EVENT = 'me.yanta.space.revoke.v1';
export const SPACE_KEY_REQUEST_EVENT = 'me.yanta.space.key_request.v1';

const SPACE_EVENT_TYPES = new Set([
  SPACE_INVITE_EVENT,
  SPACE_REVOKE_EVENT,
  SPACE_KEY_REQUEST_EVENT,
]);

// Events handled in this session (invites are additionally idempotent
// at mount level, so losing this set on reload is harmless).
const processedEventIds = new Set();

// ---------------- outgoing --------------------------------------

function inviteContentFor(record, role) {
  const bundle = {
    k: record.rootKey,
    ep: record.epoch || 1,
  };

  // Only writers receive the writer secret — readers must never be
  // able to derive the writers' WebRTC room credentials.
  if (role === 'write' && record.writerSecret) {
    bundle.ws = record.writerSecret;
  }

  return {
    v: 1,
    spaceId: record.spaceId,
    sourceType: record.sourceType || 'note',
    title: record.title || '',
    bundle,
    ts: Date.now(),
  };
}

export async function sendSpaceInvite(record, matrixUserId, role) {
  const client = await resolveMatrixClient();

  if (!client) {
    throw new Error('Chat is not connected — enable Chat to deliver keys.');
  }

  const roomId = await createDm(matrixUserId);
  await client.sendEvent(roomId, SPACE_INVITE_EVENT, inviteContentFor(record, role));
}

export async function sendSpaceRevokeNotice(spaceId, matrixUserId) {
  const client = await resolveMatrixClient();
  if (!client) return;

  try {
    const roomId = await createDm(matrixUserId);
    await client.sendEvent(roomId, SPACE_REVOKE_EVENT, {
      v: 1,
      spaceId,
      ts: Date.now(),
    });
  } catch (err) {
    console.warn('[YANTA Spaces] revoke notice failed', err);
  }
}

/**
 * Fallback for federated / non-YANTA Matrix users: no server grant is
 * possible, so they get a normal chat message with the share link
 * (which carries the keys in its fragment) and open it in a browser.
 */
export async function sendSpaceLinkMessage(matrixUserId, text) {
  const client = await resolveMatrixClient();

  if (!client) {
    throw new Error('Chat is not connected — enable Chat to send the link.');
  }

  const roomId = await createDm(matrixUserId);
  await client.sendEvent(roomId, 'm.room.message', {
    msgtype: 'm.text',
    body: text,
  });
}

export async function sendSpaceKeyRequest(spaceId, ownerMatrixUserId) {
  const client = await resolveMatrixClient();
  if (!client) return;

  const roomId = await createDm(ownerMatrixUserId);
  await client.sendEvent(roomId, SPACE_KEY_REQUEST_EVENT, {
    v: 1,
    spaceId,
    ts: Date.now(),
  });
}

// ---------------- incoming --------------------------------------

async function handleInvite(ev) {
  const content = ev.getContent?.() || {};

  if (content.v !== 1 || !content.spaceId || !content.bundle?.k) return;

  await mountSpaceFromInvite({
    spaceId: String(content.spaceId),
    title: String(content.title || ''),
    sourceType: ['folder', 'calendar'].includes(content.sourceType)
      ? content.sourceType
      : 'note',
    bundle: content.bundle,
    invitedBy: ev.getSender?.() || '',
  });
}

async function handleRevoke(ev) {
  const content = ev.getContent?.() || {};
  const spaceId = String(content.spaceId || '');
  if (!spaceId) return;

  const record = await store.spaces.get(spaceId);

  // Only the person who delivered the keys may tear the mount down,
  // and never a space we own ourselves.
  if (!record || record.role === 'owner') return;
  if (record.invitedBy && record.invitedBy !== ev.getSender?.()) return;

  await leaveSpace(spaceId);
}

async function handleKeyRequest(ev) {
  const content = ev.getContent?.() || {};
  const spaceId = String(content.spaceId || '');
  const sender = ev.getSender?.() || '';
  if (!spaceId || !sender) return;

  const record = await store.spaces.get(spaceId);
  if (!record || record.role !== 'owner') return;

  // Re-send only to actual members, with their server-side role.
  let members = [];

  try {
    members = await apiListSpaceMembers(spaceId);
  } catch {
    return;
  }

  const member = members.find((m) => m.matrixUserId === sender);
  if (!member) return;

  await sendSpaceInvite(record, sender, member.role).catch((err) => {
    console.warn('[YANTA Spaces] key re-delivery failed', err);
  });
}

async function handleSpaceEvent(ev, client) {
  const type = ev.getType?.() || '';
  if (!SPACE_EVENT_TYPES.has(type)) return;

  const eventId = ev.getId?.() || '';
  if (!eventId || processedEventIds.has(eventId)) return;
  processedEventIds.add(eventId);

  const me = client.getUserId?.() || '';
  const sender = ev.getSender?.() || '';

  try {
    if (type === SPACE_INVITE_EVENT && sender !== me) {
      await handleInvite(ev);
    } else if (type === SPACE_REVOKE_EVENT && sender !== me) {
      await handleRevoke(ev);
    } else if (type === SPACE_KEY_REQUEST_EVENT && sender !== me) {
      await handleKeyRequest(ev);
    }
  } catch (err) {
    console.warn('[YANTA Spaces] space event handling failed', type, err);
  }
}

async function scanRoomTimeline(client, room) {
  const events = room?.getLiveTimeline?.()?.getEvents?.() || [];

  for (const ev of events) {
    if (!SPACE_EVENT_TYPES.has(ev.getType?.() || '')) continue;
    await handleSpaceEvent(ev, client);
  }
}

async function backfillScan() {
  const client = await resolveMatrixClient();
  if (!client) return;

  const rooms = client.getVisibleRooms?.() || client.getRooms?.() || [];

  for (const room of rooms) {
    if (room.getMyMembership?.() !== 'join') continue;
    await scanRoomTimeline(client, room);
  }
}

let installed = false;

/**
 * Install listeners on the chat session's DOM events. Safe to call
 * before chat is connected — everything no-ops until a client exists.
 */
export function setupSpaceMatrix() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Encrypted custom events surface here once Megolm decrypted them —
  // this is the live path for invites/revokes/key requests.
  window.addEventListener('yanta-chat-message-decrypted', async (e) => {
    const { roomId, eventId } = e.detail || {};
    if (!roomId || !eventId) return;

    const client = await resolveMatrixClient();
    const ev = client?.getRoom?.(roomId)?.findEventById?.(eventId);
    if (!ev) return;

    await handleSpaceEvent(ev, client);
  });

  // Startup / reconnect: sweep loaded timelines for anything that
  // arrived while YANTA was closed.
  window.addEventListener('yanta-chat-ready', () => {
    backfillScan().catch((err) => {
      console.warn('[YANTA Spaces] invite backfill failed', err);
    });
  });
}

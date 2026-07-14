// ============================================================
// YANTA Chat — AI actions
// Local Matrix/E2EE-aware tools for YANTA AI.
// ============================================================

import {
    escapeHtml,
    toast,
  } from '../core.js';
  
  import {
    yantaConfirm,
  } from '../dialogs.js';
  
  import {
    getAiSettings,
  } from '../ai/ai-settings.js';
  
  import {
    resolveMatrixClient,
    createDm,
  } from './chat-actions.js';
  
  import {
    searchChatMessages,
  } from './chat-search.js';
  
  const AI_ATTRIBUTION_FOOTER = '— sent by YANTA AI';
  const AI_ATTRIBUTION_FOOTER_RE = /\n{1,3}— sent by YANTA AI\s*$/i;
  
  function stripYantaAiFooter(text = '') {
    return String(text || '')
      .replace(AI_ATTRIBUTION_FOOTER_RE, '')
      .trim();
  }

  function assertChatReadAllowed() {
    const allowed = getAiSettings().permissions?.allowReadChatMessages === true;
  
    if (!allowed) {
      const err = new Error('AI is not allowed to read Chat messages.');
      err.code = 'EAI_CHAT_READ_NOT_ALLOWED';
      err.permission = 'allowReadChatMessages';
      throw err;
    }
  }
  
  function assertChatSendAllowed() {
    const allowed = getAiSettings().permissions?.allowSendChatMessages === true;
  
    if (!allowed) {
      const err = new Error('AI is not allowed to send Chat messages.');
      err.code = 'EAI_CHAT_SEND_NOT_ALLOWED';
      err.permission = 'allowSendChatMessages';
      throw err;
    }
  }
  
  function chatSendRequiresConfirmation() {
    return getAiSettings().permissions?.allowAutonomousChatMessages !== true;
  }

  async function requireMatrixClient() {
    const client = await resolveMatrixClient();
  
    if (!client) {
      toast('Chat is not connected.', 'error');
      throw new Error('Matrix client is not available.');
    }
  
    return client;
  }
  
  function visibleRooms(client) {
    try {
      return client.getVisibleRooms?.() || client.getRooms?.() || [];
    } catch {
      return [];
    }
  }
  
  function directAccountData(client) {
    try {
      return client.getAccountData?.('m.direct')?.getContent?.() || {};
    } catch {
      return {};
    }
  }
  
  function directUserIdForRoom(client, roomId) {
    const direct = directAccountData(client);
  
    for (const [userId, roomIds] of Object.entries(direct)) {
      if (Array.isArray(roomIds) && roomIds.includes(roomId)) {
        return userId;
      }
    }
  
    return '';
  }
  
  function roomName(client, room) {
    if (!room) return 'Chat';
  
    const directUserId = directUserIdForRoom(client, room.roomId);
  
    if (directUserId) {
      const member = room.getMember?.(directUserId);
  
      return (
        member?.name ||
        member?.rawDisplayName ||
        member?.displayName ||
        directUserId
      );
    }
  
    return (
      room.name ||
      room.getDefaultRoomName?.(client.getUserId?.()) ||
      room.roomId ||
      'Chat'
    );
  }
  
  function eventTimestamp(event) {
    try {
      return event.getTs?.() || event.event?.origin_server_ts || null;
    } catch {
      return null;
    }
  }
  
  function eventContent(event) {
    try {
      return (
        event.getClearContent?.() ||
        event.getContent?.() ||
        event.event?.content ||
        {}
      );
    } catch {
      return {};
    }
  }
  
  function eventSender(event) {
    try {
      return event.getSender?.() || event.event?.sender || '';
    } catch {
      return '';
    }
  }
  
  function eventType(event) {
    try {
      return event.getType?.() || event.event?.type || '';
    } catch {
      return '';
    }
  }
  
  function isEditMessageContent(content = {}) {
    return content?.['m.relates_to']?.rel_type === 'm.replace';
  }

function compactMessageEvent(event) {
  const content = eventContent(event);
  const type = eventType(event);

  if (type !== 'm.room.message' && type !== 'm.sticker') return null;
  if (event.isRedacted?.()) return null;
  if (isEditMessageContent(content)) return null;

  const body = String(content.body || '').trim();

  if (!body) return null;

  return {
    eventId: event.getId?.() || event.event?.event_id || '',
    ts: eventTimestamp(event),
    sender: eventSender(event),
    msgtype: content.msgtype || '',
    body: stripYantaAiFooter(body),
    isAiGenerated:
      content?.['com.yanta.ai']?.generated === true ||
      body.includes(AI_ATTRIBUTION_FOOTER),
  };
}
  
  function textToMatrixHtml(text = '') {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  
  function buildAiMessageContent(text = '') {
    const clean = String(text || '').trim();
  
    return {
      msgtype: 'm.text',
  
      // Plain fallback for all Matrix clients.
      body: `${clean}\n\n${AI_ATTRIBUTION_FOOTER}`,
  
      // Rich fallback where supported.
      format: 'org.matrix.custom.html',
      formatted_body: [
        textToMatrixHtml(clean),
        '<br><br>',
        '<em>sent by YANTA AI</em>',
      ].join(''),
  
      // YANTA-native metadata. Other clients ignore unknown fields.
      'com.yanta.ai': {
        generated: true,
        sender: 'YANTA AI',
        version: 1,
        sentAt: new Date().toISOString(),
      },
    };
  }

  function roomMemberSearchText(room, client) {
    const ownUserId = client?.getUserId?.() || '';
  
    try {
      return (room.getJoinedMembers?.() || [])
        .filter((member) => member?.userId && member.userId !== ownUserId)
        .slice(0, 20)
        .map((member) => [
          member.userId,
          member.name,
          member.rawDisplayName,
          member.displayName,
        ].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' ');
    } catch {
      return '';
    }
  }
  
  function roomMemberPreview(room, client) {
    const ownUserId = client?.getUserId?.() || '';
  
    try {
      return (room.getJoinedMembers?.() || [])
        .filter((member) => member?.userId && member.userId !== ownUserId)
        .slice(0, 6)
        .map((member) => ({
          userId: member.userId,
          name:
            member.name ||
            member.rawDisplayName ||
            member.displayName ||
            member.userId,
        }));
    } catch {
      return [];
    }
  }
  
  export async function chatListRoomsAction({
    query = '',
    limit = 30,
  } = {}) {
    assertChatReadAllowed();
  
    const client = await requireMatrixClient();
    const q = String(query || '').trim().toLowerCase();
    const max = Math.max(1, Math.min(100, Number(limit || 30)));
  
    const rooms = visibleRooms(client)
      .map((room) => {
        const name = roomName(client, room);
        const directUserId = directUserIdForRoom(client, room.roomId);
        const memberSearchText = roomMemberSearchText(room, client);
        const members = roomMemberPreview(room, client);
  
        return {
          roomId: room.roomId,
          name,
          isDirect: !!directUserId,
          directUserId: directUserId || null,
          members,
          unread: Number(room.getUnreadNotificationCount?.() || 0),
          lastActive:
            Number(
              room.getLastActiveTimestamp?.() ||
              room.getLastModifiedTime?.() ||
              0
            ) || null,
  
          // Internal-only search field. Removed before return.
          _searchText: [
            name,
            room.roomId,
            directUserId || '',
            memberSearchText,
          ].join(' ').toLowerCase(),
        };
      })
      .filter((room) => {
        if (!q) return true;
        return room._searchText.includes(q);
      })
      .sort((a, b) => Number(b.lastActive || 0) - Number(a.lastActive || 0))
      .slice(0, max)
      .map((room) => {
        const { _searchText, ...safeRoom } = room;
        return safeRoom;
      });
  
    return {
      query: query || null,
      count: rooms.length,
      rooms,
    };
  }
  
  export async function chatReadRecentMessagesAction({
    roomId = '',
    limit = 30,
  } = {}) {
    assertChatReadAllowed();
  
    const client = await requireMatrixClient();
    const targetRoomId = String(roomId || '').trim();
  
    if (!targetRoomId) {
      throw new Error('roomId is required.');
    }
  
    const room = client.getRoom?.(targetRoomId);
  
    if (!room) {
      throw new Error('Chat room not found.');
    }
  
    const max = Math.max(1, Math.min(100, Number(limit || 30)));
  
    try {
      // Best-effort: ask SDK to have more local timeline events available.
      if (typeof client.scrollback === 'function') {
        await client.scrollback(room, max).catch(() => {});
      }
    } catch {}
  
    const events =
      room.getLiveTimeline?.()?.getEvents?.() ||
      [];
  
    const messages = events
      .map(compactMessageEvent)
      .filter(Boolean)
      .slice(-max);
  
    return {
      roomId: targetRoomId,
      roomName: roomName(client, room),
      count: messages.length,
      messages,
      note:
        'Only locally available/decrypted Matrix messages are returned. Older encrypted history may require opening/backfilling the chat first.',
    };
  }
  
  export async function chatSearchMessagesAction({
    query = '',
    roomId = '',
    limit = 20,
  } = {}) {
    assertChatReadAllowed();
  
    const q = String(query || '').trim();
  
    if (!q) {
      throw new Error('Search query is required.');
    }
  
    const results = await searchChatMessages(q, {
      roomId: String(roomId || '').trim(),
      limit: Math.max(1, Math.min(50, Number(limit || 20))),
    });
  
    return {
      query: q,
      roomId: roomId || null,
      count: results.length,
      results: results.map((row) => ({
        roomId: row.roomId,
        eventId: row.eventId,
        ts: row.ts || null,
        sender: row.sender || '',
        snippet: stripYantaAiFooter(row.snippet || row.body || ''),
        score: row.score || 0,
      })),
    };
  }
  
  export async function chatSendMessageAction({
    roomId = '',
    userId = '',
    text = '',
  } = {}) {
    assertChatSendAllowed();
  
    const body = String(text || '').trim();
  
    if (!body) {
      throw new Error('Message text is required.');
    }
  
    const client = await requireMatrixClient();
  
    let targetRoomId = String(roomId || '').trim();
    const targetUserId = String(userId || '').trim();
  
    if (!targetRoomId && !targetUserId) {
      throw new Error('roomId or userId is required.');
    }
  
    const room = targetRoomId
      ? client.getRoom?.(targetRoomId)
      : null;
  
    const displayName = room
      ? roomName(client, room)
      : targetUserId || targetRoomId;
  
    const requireConfirmation = chatSendRequiresConfirmation();
  
    if (requireConfirmation) {
      const ok = await yantaConfirm({
        title: 'AI wants to send a Chat message',
        message: [
          `To: ${displayName}`,
          '',
          body.length > 1400 ? `${body.slice(0, 1400)}…` : body,
          '',
          targetRoomId
            ? 'The message will be marked as sent by YANTA AI.'
            : 'YANTA may create or open a direct chat first. The message will be marked as sent by YANTA AI.',
        ].join('\n'),
        confirmLabel: 'Send message',
        cancelLabel: 'Cancel',
        danger: false,
        icon: 'send-horizontal',
      });
  
      if (!ok) {
        return {
          ok: false,
          cancelled: true,
        };
      }
    }
  
    if (!targetRoomId && targetUserId) {
      targetRoomId = await createDm(targetUserId);
    }
  
    if (!targetRoomId) {
      throw new Error('Could not resolve target room.');
    }
  
    const content = buildAiMessageContent(body);
    const sendResult = await client.sendMessage(targetRoomId, content);
  
    toast(
      requireConfirmation
        ? 'AI Chat message sent'
        : 'AI Chat message sent automatically',
      'success'
    );
  
    return {
      ok: true,
      roomId: targetRoomId,
      userId: targetUserId || null,
      eventId: sendResult?.event_id || sendResult?.eventId || null,
      chars: body.length,
      aiAttributed: true,
      humanConfirmed: requireConfirmation,
      autonomous: !requireConfirmation,
    };
  }
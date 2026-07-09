// ============================================================
// YANTA Chat — AP6 local Media/Link index
//
// Warum:
// E2EE means the homeserver cannot search/filter encrypted attachments for us.
// Gallery therefore needs a local per-device index built while events decrypt.
// ============================================================

import {
    toast,
  } from '../core.js';
  
  import {
    chatStore,
  } from './chat-store.js';
  
  const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi;
  
  function reportIndexError(message, err) {
    console.warn('[YANTA Chat Media Index]', err);
    toast(message || 'Could not update chat media index.', 'error');
  }
  
  function eventIdOf(event) {
    return String(event?.getId?.() || event?.event?.event_id || '');
  }
  
  function roomIdOf(event, fallbackRoomId = '') {
    return String(
      fallbackRoomId ||
      event?.getRoomId?.() ||
      event?.event?.room_id ||
      ''
    );
  }
  
  function senderOf(event) {
    return String(event?.getSender?.() || event?.event?.sender || '');
  }
  
  function tsOf(event) {
    return Number(event?.getTs?.() || event?.event?.origin_server_ts || Date.now());
  }
  
  function clearContentOf(event) {
    return (
      event?.getClearContent?.() ||
      event?.getContent?.() ||
      event?.event?.content ||
      {}
    );
  }
  
  function mediaUrlFromContent(content = {}) {
    return (
      content.url ||
      content.file?.url ||
      ''
    );
  }
  
  function thumbnailUrlFromContent(content = {}) {
    return (
      content.info?.thumbnail_url ||
      content.info?.thumbnail_file?.url ||
      ''
    );
  }
  
  function isVoiceMessage(content = {}) {
    return !!(
      content['org.matrix.msc3245.voice'] ||
      content['io.element.voice_message'] ||
      /voice message/i.test(String(content.body || ''))
    );
  }
  
  function kindFromMessage(content = {}) {
    const msgtype = String(content.msgtype || '');
    const mime = String(content.info?.mimetype || content.file?.mimetype || '');
  
    if (msgtype === 'm.image') return 'image';
  
    if (msgtype === 'm.audio') {
      return isVoiceMessage(content) ? 'voice' : 'audio';
    }
  
    if (mime.startsWith('audio/')) {
      return isVoiceMessage(content) ? 'voice' : 'audio';
    }
  
    if (
      msgtype === 'm.file' ||
      msgtype === 'm.video' ||
      content.url ||
      content.file?.url
    ) {
      return 'file';
    }
  
    return '';
  }
  
  function cleanUrl(raw) {
    return String(raw || '')
      .trim()
      .replace(/[.,!?;:]+$/g, '');
  }
  
  function domainForUrl(raw) {
    try {
      return new URL(raw).hostname.replace(/^www\./i, '');
    } catch {
      return '';
    }
  }
  
  function linkItemsFromBody({
    roomId,
    eventId,
    ts,
    sender,
    body,
  } = {}) {
    const text = String(body || '');
    const urls = [...text.matchAll(URL_RE)]
      .map((match) => cleanUrl(match[0]))
      .filter(Boolean);
  
    return [...new Set(urls)].map((url, idx) => ({
      id: `${roomId}:${eventId}:link:${idx}:${url}`,
      key: `${roomId}:${eventId}:link:${idx}:${url}`,
      roomId,
      eventId,
      kind: 'link',
      name: url,
      size: 0,
      mime: 'text/uri-list',
      ts,
      createdAt: ts,
      updatedAt: Date.now(),
      sender,
      url,
      domain: domainForUrl(url),
    }));
  }
  
  /**
   * Upserts media/link metadata for one Matrix timeline event.
   */
  export async function indexTimelineEventMedia(event, {
    roomId: fallbackRoomId = '',
  } = {}) {
    try {
      const type = event?.getType?.() || event?.event?.type || '';
      const eventId = eventIdOf(event);
      const roomId = roomIdOf(event, fallbackRoomId);
  
      if (!eventId || !roomId) return [];
  
      if (type === 'm.room.redaction') {
        const redactedEventId =
          event?.event?.redacts ||
          event?.getAssociatedId?.() ||
          event?.getContent?.()?.redacts ||
          '';
  
        if (redactedEventId) {
          await removeMediaIndexForEvent(roomId, redactedEventId);
        }
  
        return [];
      }
  
      if (type !== 'm.room.message' && type !== 'm.sticker') {
        return [];
      }
  
      if (event?.isRedacted?.()) {
        await removeMediaIndexForEvent(roomId, eventId);
        return [];
      }
  
      const content = clearContentOf(event);
      const sender = senderOf(event);
      const ts = tsOf(event);
      const body = String(content.body || '').trim();
      const kind = kindFromMessage(content);
      const written = [];
  
      if (kind) {
        const info = content.info || {};
        const mxcUrl = mediaUrlFromContent(content);
  
        if (mxcUrl) {
          const item = {
            id: `${roomId}:${eventId}:media`,
            key: `${roomId}:${eventId}`,
            roomId,
            eventId,
            kind,
            name:
              body ||
              content.filename ||
              info.name ||
              (kind === 'image' ? 'Photo' : kind === 'voice' ? 'Voice message' : 'File'),
            size: Number(info.size || content.file?.size || 0),
            mime: String(info.mimetype || content.file?.mimetype || ''),
            ts,
            createdAt: ts,
            updatedAt: Date.now(),
            sender,
            mxcUrl,
            encryptedFile: content.file || null,
            thumbnailMxcUrl: thumbnailUrlFromContent(content),
            thumbnailEncryptedFile: info.thumbnail_file || null,
          };
  
          await chatStore.mediaIndex.put(item);
          written.push(item);
        }
      }
  
      const links = linkItemsFromBody({
        roomId,
        eventId,
        ts,
        sender,
        body,
      });
  
      for (const item of links) {
        await chatStore.mediaIndex.put(item);
        written.push(item);
      }
  
      return written;
    } catch (err) {
      reportIndexError('Could not index chat media.', err);
      return [];
    }
  }
  
  /**
   * Indexes all events in a timeline batch.
   */
  export async function indexTimelineEventsMedia(events = [], {
    roomId = '',
  } = {}) {
    const out = [];
  
    for (const event of events || []) {
      const rows = await indexTimelineEventMedia(event, {
        roomId,
      });
  
      out.push(...rows);
    }
  
    return out;
  }
  
  /**
   * Removes all Gallery index rows for one event.
   */
  export async function removeMediaIndexForEvent(roomId, eventId) {
    try {
      const rows = await chatStore.mediaIndex.all();
      const targets = rows.filter((row) => (
        String(row.roomId || '') === String(roomId || '') &&
        String(row.eventId || '') === String(eventId || '')
      ));
  
      await Promise.all(targets.map((row) => chatStore.mediaIndex.del(row.id)));
  
      return targets.length;
    } catch (err) {
      reportIndexError('Could not remove chat media index entry.', err);
      throw err;
    }
  }
  
  /**
   * Lists Gallery index rows for one room.
   */
  export async function listMediaIndexForRoom(roomId, {
    kind = '',
  } = {}) {
    try {
      const rows = await chatStore.mediaIndex.all();
      const id = String(roomId || '');
  
      return rows
        .filter((row) => String(row.roomId || '') === id)
        .filter((row) => !kind || row.kind === kind)
        .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    } catch (err) {
      reportIndexError('Could not read chat media index.', err);
      return [];
    }
  }
  
  /**
   * Installs live Matrix timeline indexing for one client.
   */
  export function installChatMediaIndexer(client) {
    if (!client || client.__yantaMediaIndexerInstalled) return;
  
    client.__yantaMediaIndexerInstalled = true;
  
    const onTimeline = (event, room) => {
      indexTimelineEventMedia(event, {
        roomId: room?.roomId || event?.getRoomId?.() || '',
      }).catch((err) => {
        reportIndexError('Could not update live chat media index.', err);
      });
    };
  
    client.on?.('Room.timeline', onTimeline);
  
    try {
      const rooms = client.getRooms?.() || [];
  
      for (const room of rooms) {
        const events = room.getLiveTimeline?.()?.getEvents?.() || [];
  
        indexTimelineEventsMedia(events, {
          roomId: room.roomId,
        }).catch((err) => {
          reportIndexError('Could not index existing chat media.', err);
        });
      }
    } catch (err) {
      reportIndexError('Could not install chat media indexer.', err);
    }
  }
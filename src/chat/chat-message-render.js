// ============================================================
// YANTA Chat — Timeline message rendering
// ============================================================

import DOMPurify from 'dompurify';

import {
  el,
  escapeHtml,
  fmtDate,
  lucide,
  toast,
} from '../core.js';

import {
  mxcToBlobUrl,
} from './chat-media.js';

const FIVE_MINUTES = 5 * 60 * 1000;

const SAFE_FORMATTED_BODY_TAGS = [
  'b',
  'i',
  'em',
  'strong',
  'code',
  'pre',
  'a',
  'br',
  'del',
  'blockquote',
];

const SAFE_FORMATTED_BODY_ATTRS = {
  a: ['href', 'title', 'target', 'rel'],
};

function eventId(event) {
  return event?.getId?.() || event?.event?.event_id || '';
}

function eventTs(event) {
  return Number(event?.getTs?.() || event?.event?.origin_server_ts || 0);
}

function sameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);

  return da.toDateString() === db.toDateString();
}

function dayLabel(ts) {
  const d = new Date(ts || Date.now());
  const today = new Date();

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';

  return d.toLocaleDateString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function timeLabel(ts) {
  try {
    return new Date(ts || Date.now()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function senderName(room, userId) {
  const member = room?.getMember?.(userId);

  return (
    member?.name ||
    member?.rawDisplayName ||
    member?.displayName ||
    userId ||
    'Unknown'
  );
}

function clearContent(event) {
  return (
    event?.getClearContent?.() ||
    event?.getContent?.() ||
    event?.event?.content ||
    {}
  );
}

function replacementEvent(event) {
  try {
    return event.replacingEvent?.() || event.getAssociatedReplacement?.() || null;
  } catch {
    return null;
  }
}

function effectiveContent(event) {
  const replacement = replacementEvent(event);

  if (replacement) {
    const content = clearContent(replacement);

    if (content?.['m.new_content']) {
      return {
        content: content['m.new_content'],
        edited: true,
      };
    }
  }

  const content = clearContent(event);

  return {
    content,
    edited: false,
  };
}

function isEditEvent(event) {
  const content = clearContent(event);
  const relates = content?.['m.relates_to'] || {};

  return relates.rel_type === 'm.replace';
}

function isRedacted(event) {
  return (
    event?.isRedacted?.() ||
    !!event?.event?.unsigned?.redacted_because ||
    event?.getType?.() === 'm.room.redaction'
  );
}

function isMessageLike(event) {
  const type = event?.getType?.();

  return (
    type === 'm.room.message' ||
    type === 'm.sticker' ||
    isRedacted(event)
  );
}

function linkifyEscapedText(text) {
  const escaped = escapeHtml(String(text || ''));

  return escaped.replace(
    /\b((?:https?:\/\/|mailto:)[^\s<]+)/gi,
    (full) => {
      const href = full.replace(/[),.;!?]+$/, '');
      const tail = full.slice(href.length);

      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>${tail}`;
    }
  ).replace(/\n/g, '<br>');
}

function sanitizeFormattedBody(html) {
  /*
    Why:
    Matrix federation means formatted_body can be supplied by any remote
    homeserver/client. Rendering arbitrary HTML would create XSS risk.
    We keep a tiny allowlist and normalize links after sanitizing.
  */
  const safe = DOMPurify.sanitize(String(html || ''), {
    ALLOWED_TAGS: SAFE_FORMATTED_BODY_TAGS,
    ALLOWED_ATTR: SAFE_FORMATTED_BODY_ATTRS,
    ALLOW_DATA_ATTR: false,
  });

  const tmp = document.createElement('div');
  tmp.innerHTML = safe;

  for (const a of tmp.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';

    if (!/^(https?:|mailto:)/i.test(href)) {
      a.removeAttribute('href');
      continue;
    }

    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }

  return tmp.innerHTML;
}

function mediaLabel(msgtype) {
  if (msgtype === 'm.image') return 'Photo';
  if (msgtype === 'm.video') return 'Video';
  if (msgtype === 'm.audio') return 'Audio';
  if (msgtype === 'm.file') return 'File';
  return 'Attachment';
}

function mediaIcon(msgtype) {
  if (msgtype === 'm.image') return 'image';
  if (msgtype === 'm.video') return 'video';
  if (msgtype === 'm.audio') return 'file-audio';
  return 'paperclip';
}

function bodyPreviewFromContent(content = {}) {
  const msgtype = content.msgtype || '';

  if (msgtype && msgtype !== 'm.text' && msgtype !== 'm.notice' && msgtype !== 'm.emote') {
    return mediaLabel(msgtype);
  }

  return String(content.body || '').trim();
}

/**
 * Create a short preview for room lists and replies.
 */
export function messagePreview(event) {
  if (!event) return '';

  if (isRedacted(event)) return 'Message deleted';

  const {
    content,
    edited,
  } = effectiveContent(event);

  const preview = bodyPreviewFromContent(content);

  return edited && preview
    ? `${preview} · edited`
    : preview;
}

function renderTextContent(content = {}) {
  const node = el('div', {
    class: 'yanta-chat-message-text',
  });

  const formatted =
    content.format === 'org.matrix.custom.html'
      ? String(content.formatted_body || '')
      : '';

  node.innerHTML = formatted
    ? sanitizeFormattedBody(formatted)
    : linkifyEscapedText(content.body || '');

  return node;
}

function renderMediaContent(client, content = {}) {
  const msgtype = content.msgtype || '';
  const url = content.url || content.file?.url || '';
  const info = content.info || {};
  const name = content.body || mediaLabel(msgtype);

  const wrap = el('div', {
    class: `yanta-chat-media ${msgtype.replace(/\./g, '-')}`,
  });

  const head = el('div', {
    class: 'yanta-chat-media-head',
  });

  head.innerHTML = `
    <span>${lucide(mediaIcon(msgtype), 15)}</span>
    <strong>${escapeHtml(name)}</strong>
  `;

  wrap.append(head);

  if (msgtype === 'm.image' && url) {
    const img = el('img', {
      class: 'yanta-chat-image',
      alt: name,
      loading: 'lazy',
    });

    img.hidden = true;

    wrap.append(img);

    mxcToBlobUrl(client, url, {
      thumbnail: true,
      w: Math.min(900, Number(info.w || 900)),
      h: Math.min(900, Number(info.h || 900)),
    })
      .then((objectUrl) => {
        if (!img.isConnected) return;
        img.src = objectUrl;
        img.hidden = false;
      })
      .catch((err) => {
        console.warn('[YANTA Chat] Could not hydrate image message', err);
        toast('Could not load chat image.', 'error');
      });
  }

  return wrap;
}

function renderMessageBody(client, content = {}) {
  const msgtype = content.msgtype || 'm.text';

  if (
    msgtype === 'm.image' ||
    msgtype === 'm.video' ||
    msgtype === 'm.audio' ||
    msgtype === 'm.file'
  ) {
    return renderMediaContent(client, content);
  }

  return renderTextContent(content);
}

function readByOther(room, event, ownUserId) {
  try {
    const receipts = room.getReceiptsForEvent?.(event) || [];

    return receipts.some((receipt) =>
      receipt?.type === 'm.read' &&
      receipt?.userId &&
      receipt.userId !== ownUserId
    );
  } catch {
    return false;
  }
}

function statusIcon(client, room, event) {
  const ownUserId = client?.getUserId?.() || '';
  const sender = event?.getSender?.() || event?.sender?.userId || '';

  if (!ownUserId || sender !== ownUserId) return null;

  const status = event.status || '';

  const wrap = el('span', {
    class: 'yanta-chat-status',
    title: 'Message status',
  });

  if (status && status !== 'sent') {
    wrap.innerHTML = lucide('clock-3', 12);
    wrap.title = 'Sending';
    return wrap;
  }

  if (readByOther(room, event, ownUserId)) {
    wrap.innerHTML = lucide('check-check', 12);
    wrap.title = 'Read';
    return wrap;
  }

  wrap.innerHTML = lucide('check', 12);
  wrap.title = 'Sent';

  return wrap;
}

function replyPreviewNode(event, eventMap, room) {
  const content = clearContent(event);
  const replyId = content?.['m.relates_to']?.['m.in_reply_to']?.event_id;

  if (!replyId) return null;

  const replied = eventMap.get(replyId);
  const sender = replied?.getSender?.() || '';
  const preview = replied
    ? messagePreview(replied)
    : 'Original message';

  const node = el('div', {
    class: 'yanta-chat-reply-preview',
  });

  node.innerHTML = `
    <strong>${escapeHtml(senderName(room, sender))}</strong>
    <span>${escapeHtml(preview || 'Message')}</span>
  `;

  return node;
}

function renderSingleMessage(event, {
  client,
  room,
  grouped,
  eventMap,
} = {}) {
  if (!isMessageLike(event)) return null;
  if (isEditEvent(event)) return null;

  const ownUserId = client?.getUserId?.() || '';
  const sender = event.getSender?.() || '';
  const outgoing = sender === ownUserId;

  const row = el('div', {
    class: `yanta-chat-event ${outgoing ? 'own' : 'other'} ${grouped ? 'grouped' : ''}`,
    dataset: {
      eventId: eventId(event),
    },
  });

  const bubble = el('div', {
    class: 'yanta-chat-bubble',
  });

  if (!grouped && !outgoing) {
    bubble.append(el('div', {
      class: 'yanta-chat-sender',
    }, senderName(room, sender)));
  }

  if (isRedacted(event)) {
    bubble.append(el('div', {
      class: 'yanta-chat-redacted',
    }, 'Message deleted'));
  } else {
    const reply = replyPreviewNode(event, eventMap, room);

    if (reply) {
      bubble.append(reply);
    }

    const {
      content,
      edited,
    } = effectiveContent(event);

    bubble.append(renderMessageBody(client, content));

    if (edited) {
      bubble.append(el('span', {
        class: 'yanta-chat-edited',
      }, 'edited'));
    }
  }

  const meta = el('div', {
    class: 'yanta-chat-meta',
  });

  meta.append(el('span', {}, timeLabel(eventTs(event))));

  const status = statusIcon(client, room, event);

  if (status) {
    meta.append(status);
  }

  bubble.append(meta);
  row.append(bubble);

  return row;
}

/**
 * Render a Matrix TimelineWindow event list.
 *
 * @param {Array} events Matrix events from TimelineWindow.getEvents().
 * @param {object} context Render context.
 * @returns {DocumentFragment}
 */
export function renderTimelineEvents(events = [], context = {}) {
  const fragment = document.createDocumentFragment();
  const eventMap = new Map();

  for (const event of events) {
    const id = eventId(event);

    if (id) {
      eventMap.set(id, event);
    }
  }

  let previousRenderable = null;
  let previousDayTs = 0;

  for (const event of events) {
    if (!isMessageLike(event) || isEditEvent(event)) continue;

    const ts = eventTs(event);

    if (!previousDayTs || !sameDay(previousDayTs, ts)) {
      fragment.append(el('div', {
        class: 'yanta-chat-day-separator',
      }, dayLabel(ts)));

      previousDayTs = ts;
      previousRenderable = null;
    }

    const sameSender =
      previousRenderable &&
      previousRenderable.getSender?.() === event.getSender?.();

    const closeInTime =
      previousRenderable &&
      Math.abs(eventTs(event) - eventTs(previousRenderable)) < FIVE_MINUTES;

    const grouped = !!(sameSender && closeInTime);

    const node = renderSingleMessage(event, {
      ...context,
      grouped,
      eventMap,
    });

    if (node) {
      fragment.append(node);
      previousRenderable = event;
    }
  }

  return fragment;
}

/**
 * Return the last message event suitable for read receipts.
 */
export function lastReadableEvent(events = []) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];

    if (isMessageLike(event) && !isEditEvent(event) && !isRedacted(event)) {
      return event;
    }
  }

  return null;
}

/**
 * Format a Matrix timestamp for compact room-list display.
 */
export function compactTime(ts) {
  if (!ts) return '';

  const now = Date.now();

  if (sameDay(ts, now)) {
    return timeLabel(ts);
  }

  return fmtDate(ts);
}
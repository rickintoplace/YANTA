// ============================================================
// YANTA — Markdown calendar references
//
// Supported syntax:
//
//   Paper einreichen @due(2026-05-31)
//   Call @date(2026-05-31 14:00-15:00){cat=cal_work loc="Zoom"}
//   Workshop @event(2026-05-31T09:00/2026-05-31T12:00){cat=cal_work}
//
// Attr aliases:
//   cat/category/categoryId
//   loc/location
//   desc/description
//   note/noteId
//   rrule
//   remind/reminder/reminders
//
// These refs are NOT stored as Vault calendar events. They are derived from
// note markdown and sync together with the note body.
// ============================================================

import { getMarkdownText } from './yjs.js';

const CAL_REF_RE = /@(due|date|event)\(([^)]*)\)(?:\{([^}\n]*)\})?/gi;

function cleanUndefined(obj) {
  const out = {};

  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }

  return out;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateKey(value) {
  if (!value) return '';

  // Only trust literal date-only strings.
  // Do NOT slice ISO datetime strings like 2026-05-18T22:00:00Z,
  // because for local all-day events that is often the previous UTC day.
  if (typeof value === 'string') {
    const raw = value.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }
  }

  const d = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(d.getTime())) return '';

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTimeKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDateTimeInput(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  return `${localDateKey(d)} ${localTimeKey(d)}`;
}

function parseBool(v, fallback = false) {
  if (v == null || v === '') return fallback;

  const s = String(v).trim().toLowerCase();

  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;

  return fallback;
}

export function parseCalendarRefAttrs(raw = '') {
  const out = {};
  const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;

  let m;

  while ((m = re.exec(String(raw || ''))) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }

  return out;
}

function attr(attrs, ...keys) {
  for (const key of keys) {
    if (attrs[key] != null && attrs[key] !== '') return attrs[key];
  }

  return undefined;
}

function titleFromLine(line, matchStart) {
  const before = String(line || '').slice(0, matchStart);

  const cleaned = before
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+\.\s+/, '')
    .replace(/[#*_`~>\[\]()]/g, '')
    .trim();

  return cleaned || 'Untitled event';
}

function taskCheckedPrefix(line) {
  const m = /^\s*[-*+]\s+\[([ xX])\]\s+/.exec(String(line || ''));
  if (!m) return '';

  return m[1].toLowerCase() === 'x' ? '✓ ' : '';
}

function toLocalIso(dateKey, timeKey = '00:00') {
  const d = new Date(`${dateKey}T${timeKey}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseDateLike(raw) {
  const s = String(raw || '').trim();

  // YYYY-MM-DD
  let m = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    return {
      start: m[1],
      end: null,
      allDay: true,
    };
  }

  // YYYY-MM-DD HH:mm
  m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/);
  if (m) {
    const start = toLocalIso(m[1], m[2]);
    if (!start) return null;

    return {
      start,
      end: null,
      allDay: false,
    };
  }

  // YYYY-MM-DD HH:mm-HH:mm
  m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (m) {
    const start = toLocalIso(m[1], m[2]);
    const end = toLocalIso(m[1], m[3]);

    if (!start) return null;

    return {
      start,
      end,
      allDay: false,
    };
  }

// start/end
m = s.match(/^(.+?)\s*\/\s*(.+)$/);
if (m) {
  const startParsed = parseDateLike(m[1]);
  const endParsed = parseDateLike(m[2]);

  if (!startParsed?.start) return null;

  // Same-day all-day ranges are single-day events.
  // This repairs old/bad tokens like:
  //   @date(2026-05-19/2026-05-19)
  if (startParsed.allDay && endParsed?.allDay) {
    const startKey = localDateKey(startParsed.start);
    const endKey = localDateKey(endParsed.start);

    return {
      start: startKey,
      end: endKey && endKey !== startKey ? endKey : null,
      allDay: true,
    };
  }

  return {
    start: startParsed.start,
    end: endParsed?.start || null,
    allDay: !!startParsed.allDay && !!endParsed?.allDay,
  };
}

  // Date.parse fallback
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return {
      start: d.toISOString(),
      end: null,
      allDay: false,
    };
  }

  return null;
}

function stableHash(text) {
  let h = 2166136261;

  for (let i = 0; i < String(text || '').length; i++) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return (h >>> 0).toString(36);
}

function normalizeReminders(value) {
  if (!value) return [];

  return String(value)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function markdownRefToEvent({
  kind,
  value,
  attrsRaw,
  line,
  lineIndex,
  matchStart,
  matchEnd,
  rawToken,
  note,
}) {
  const attrs = parseCalendarRefAttrs(attrsRaw || '');

  let parsed = null;

  if (kind === 'due') {
    const day = localDateKey(value);

    if (!day) return null;

    parsed = {
      start: day,
      end: null,
      allDay: true,
    };
  } else {
    parsed = parseDateLike(value);
  }

  if (!parsed?.start) return null;

  const explicitTitle = attr(attrs, 'title', 'summary');
  const noteId = attr(attrs, 'noteId', 'note') || note.id;

  const title =
    explicitTitle ||
    `${taskCheckedPrefix(line)}${titleFromLine(line, matchStart)}`;

  const recurrenceRule = attr(attrs, 'rrule', 'recurrence');
  const reminders = normalizeReminders(attr(attrs, 'remind', 'reminder', 'reminders'));

  const id = `mdcal:${note.id}:${lineIndex}:${stableHash(rawToken)}`;

  return cleanUndefined({
    id,
    title,

    start: parsed.start,
    end: parsed.end || null,
    allDay: attrs.allDay != null
      ? parseBool(attrs.allDay, parsed.allDay)
      : parsed.allDay,

    categoryId: attr(attrs, 'categoryId', 'category', 'cat') || undefined,
    color: attr(attrs, 'color') || undefined,

    location: attr(attrs, 'location', 'loc') || '',
    description: attr(attrs, 'description', 'desc') || '',

    noteId,
    relatedNoteIds: [],

    tags: [],
    status: attr(attrs, 'status') || 'confirmed',

    recurrence: recurrenceRule
      ? { rrule: recurrenceRule }
      : null,

    reminders,

    readonly: false,
    generated: true,
    markdownDerived: true,

    markdownRef: {
      noteId: note.id,
      lineIndex,
      tokenStart: matchStart,
      tokenEnd: matchEnd,
      kind,
      value,
      attrsRaw: attrsRaw || '',
      rawToken,
    },

    sourceLine: lineIndex,
  });
}

export function parseMarkdownCalendarRefs(md, note) {
  if (!note?.id) return [];

  const out = [];
  const lines = String(md || '').split('\n');

  lines.forEach((line, lineIndex) => {
    CAL_REF_RE.lastIndex = 0;

    let m;

    while ((m = CAL_REF_RE.exec(line)) !== null) {
      const rawToken = m[0];
      const kind = String(m[1] || '').toLowerCase();
      const value = m[2] || '';
      const attrsRaw = m[3] || '';

      const ev = markdownRefToEvent({
        kind,
        value,
        attrsRaw,
        line,
        lineIndex,
        matchStart: m.index,
        matchEnd: m.index + rawToken.length,
        rawToken,
        note,
      });

      if (ev) out.push(ev);
    }
  });

  return out;
}

function quoteAttrValue(v) {
  const s = String(v ?? '');

  if (!s) return '';

  if (/^[a-zA-Z0-9._:/#@+-]+$/.test(s)) return s;

  return `"${s.replace(/"/g, '\\"')}"`;
}

function serializeAttrs(attrs = {}) {
  const parts = [];

  const push = (key, value) => {
    if (value == null || value === '') return;
    parts.push(`${key}=${quoteAttrValue(value)}`);
  };

  push('cat', attrs.categoryId);
  push('loc', attrs.location);
  push('desc', attrs.description);

  if (attrs.status && attrs.status !== 'confirmed') {
    push('status', attrs.status);
  }

  if (attrs.recurrence?.rrule) {
    push('rrule', attrs.recurrence.rrule);
  }

  if (Array.isArray(attrs.reminders) && attrs.reminders.length) {
    push('remind', attrs.reminders.join(','));
  }

  if (attrs.noteId) {
    push('note', attrs.noteId);
  }

  return parts.length ? `{${parts.join(' ')}}` : '';
}

export function serializeMarkdownCalendarRef(eventLike, preferredKind = null) {
  const ev = eventLike || {};

  const allDay = !!ev.allDay;
  const startKey = allDay ? localDateKey(ev.start) : '';
  const endKey = allDay && ev.end ? localDateKey(ev.end) : '';

  // For all-day events:
  // - no end or same-day end => @due(YYYY-MM-DD)
  // - real multi-day => @date(start/end)
  if (allDay) {
    const meaningfulEnd =
      endKey && endKey !== startKey
        ? endKey
        : null;

    const attrs = serializeAttrs(ev);

    if (!meaningfulEnd) {
      return `@due(${startKey})${attrs}`;
    }

    return `@date(${startKey}/${meaningfulEnd})${attrs}`;
  }

  const kind = preferredKind || ev.markdownRef?.kind || 'date';
  const attrs = serializeAttrs(ev);

  if (kind === 'due') {
    return `@due(${localDateKey(ev.start)})${attrs}`;
  }

  const start = localDateTimeInput(ev.start);
  let value = start;

  if (ev.end) {
    if (localDateKey(ev.start) === localDateKey(ev.end)) {
      value = `${localDateTimeInput(ev.start)}-${localTimeKey(ev.end)}`;
    } else {
      value = `${localDateTimeInput(ev.start)}/${localDateTimeInput(ev.end)}`;
    }
  }

  return `@date(${value})${attrs}`;
}

export function markdownTokenForCalendarEvent(ev) {
  return serializeMarkdownCalendarRef(ev);
}

export function markdownLineForCalendarEvent(ev) {
  const title = String(ev?.title || 'Untitled event').trim() || 'Untitled event';
  const token = markdownTokenForCalendarEvent(ev);

  return `${title} ${token}`;
}

export function updateMarkdownCalendarRef({
  noteId,
  lineIndex,
  tokenStart,
  tokenEnd,
  nextToken,
}) {
  if (!noteId) return false;

  const ytext = getMarkdownText(noteId);
  const md = ytext.toString();
  const lines = md.split('\n');

  if (lineIndex < 0 || lineIndex >= lines.length) return false;

  let lineStart = 0;

  for (let i = 0; i < lineIndex; i++) {
    lineStart += lines[i].length + 1;
  }

  const from = lineStart + tokenStart;
  const to = lineStart + tokenEnd;

  if (from < 0 || to < from || to > md.length) return false;

  ytext.delete(from, to - from);

  if (nextToken) {
    ytext.insert(from, nextToken);
  }

  return true;
}
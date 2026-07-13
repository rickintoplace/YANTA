// ============================================================
// YANTA AI — UI-independent app actions
// ============================================================

import {
  uid,
  state,
  store,
  normalizeLucideName,
  safeCssColor,
  cssColorToHex,
  toast as appActionToast,
} from '../core.js';

import {
  getNoteDoc,
  getMarkdownText,
  noteMarkdown,
  destroyNoteDoc,
  setDrawing,
} from '../yjs.js';

import {
  getView,
} from '../editor.js';

import {
  renderTree,
} from '../tree.js';

import {
  getApproxUserLocation,
} from './location.js';

import {
  moveNoteToTrash,
} from '../trash.js';

import {
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

export {
  chatListRoomsAction,
  chatReadRecentMessagesAction,
  chatSearchMessagesAction,
  chatSendMessageAction,
} from '../chat/chat-ai-actions.js';

function now() {
  return Date.now();
}

function cloudApiUrl(path) {
  const base = String(YANTA_CLOUD_BASE_URL || '/cloud-api').replace(/\/+$/, '');
  const cleanPath = String(path || '').replace(/^\/+/, '');

  return `${base}/${cleanPath}`;
}

const WEB_SEARCH_CACHE = new Map();
const WEB_READ_CACHE = new Map();

function cachedJsonKey(prefix, obj = {}) {
  return `${prefix}:${JSON.stringify(obj, Object.keys(obj).sort())}`;
}

function getFreshCache(map, key, ttlMs) {
  const hit = map.get(key);

  if (!hit) return null;
  if (Date.now() - hit.ts > ttlMs) {
    map.delete(key);
    return null;
  }

  return hit.value;
}

function setFreshCache(map, key, value) {
  map.set(key, {
    ts: Date.now(),
    value,
  });

  return value;
}

function compactNote(note) {
  if (!note) return null;

  return {
    id: note.id,
    title: note.title || 'Untitled',
    type: note.type || 'markdown',
    folderId: note.folderId || null,
    tags: note.tags || [],
    pinned: !!note.pinned,
    icon: note.icon || null,
    color: note.color || null,
    created: note.created || null,
    updated: note.updated || null,
  };
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeAppearanceIcon(value, {
  allowReset = false,
} = {}) {
  if (value == null || String(value).trim() === '') {
    return allowReset ? null : undefined;
  }

  return normalizeLucideName(String(value).trim());
}

function normalizeAppearanceColor(value, {
  allowReset = false,
} = {}) {
  if (value == null || String(value).trim() === '') {
    return allowReset ? null : undefined;
  }

  const raw = String(value || '').trim();
  const safe = safeCssColor(raw);

  if (!safe) {
    throw new Error(
      `Invalid color "${raw}". Use a safe CSS color name or a hex color like #6ea8fe.`
    );
  }

  return cssColorToHex(safe) || safe;
}

function normalizeAppearancePatch(args = {}, {
  allowReset = false,
} = {}) {
  const patch = {};

  if (hasOwn(args, 'icon')) {
    patch.icon = normalizeAppearanceIcon(args.icon, {
      allowReset,
    });
  }

  if (hasOwn(args, 'color')) {
    patch.color = normalizeAppearanceColor(args.color, {
      allowReset,
    });
  }

  return patch;
}

function applyAppearancePatchToObject(target, patch = {}) {
  let changed = false;

  if (hasOwn(patch, 'icon')) {
    if (patch.icon == null) {
      if (target.icon != null) {
        delete target.icon;
        changed = true;
      }
    } else if (target.icon !== patch.icon) {
      target.icon = patch.icon;
      changed = true;
    }
  }

  if (hasOwn(patch, 'color')) {
    if (patch.color == null) {
      if (target.color != null) {
        delete target.color;
        changed = true;
      }
    } else if (target.color !== patch.color) {
      target.color = patch.color;
      changed = true;
    }
  }

  return changed;
}

function updateSearchIndexForNote(noteId) {
  const note = state.notes.get(noteId);
  if (!note) return;

  let md = '';

  try {
    md = noteMarkdown(noteId);
  } catch {}

  state.searchIndex.set(
    noteId,
    [
      note.title || '',
      (note.tags || []).join(' '),
      md,
    ].join(' ').toLowerCase()
  );
}

async function notifyNoteChanged(noteId, reason = 'ai') {
  const note = state.notes.get(noteId);

  if (note) {
    note.updated = now();
    await store.notes.put(note);
    updateSearchIndexForNote(noteId);
  }

  try {
    const { rebuildWikilinkIndex } = await import('../notes.js');
    rebuildWikilinkIndex();
  } catch {}

  renderTree();

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId,
      reason,
      source: 'ai',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));
}

export function getCurrentSelectionText() {
  const view = getView();

  if (!view) return '';

  const sel = view.state.selection.main;

  if (!sel || sel.empty) return '';

  return view.state.sliceDoc(sel.from, sel.to);
}

export async function searchNotesAction({ query = '', limit = 10 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(50, Number(limit || 10)));

  const scored = [...state.notes.values()]
    .map((note) => {
      const title = (note.title || '').toLowerCase();
      const tags = (note.tags || []).join(' ').toLowerCase();
      const hay = state.searchIndex.get(note.id) || `${title} ${tags}`;

      let score = 0;

      if (!q) score = 1;
      else {
        if (title.includes(q)) score += 50;
        if (tags.includes(q)) score += 20;
        if (hay.includes(q)) score += 10;
      }

      return { note, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.note.updated || 0) - (a.note.updated || 0))
    .slice(0, max);

  return scored.map(({ note }) => compactNote(note));
}

export async function readNoteAction({ noteId } = {}) {
  const note = state.notes.get(String(noteId || ''));

  if (!note) {
    throw new Error('Note not found');
  }

  return {
    ...compactNote(note),
    markdown: noteMarkdown(note.id),
  };
}

export async function readNotesAction({ noteIds = [] } = {}) {
  const ids = Array.isArray(noteIds) ? noteIds.map(String) : [];

  if (!ids.length) {
    throw new Error('No note IDs provided');
  }

  const out = [];

  for (const id of ids.slice(0, 20)) {
    const note = state.notes.get(id);

    if (!note) {
      out.push({
        id,
        error: 'Note not found',
      });
      continue;
    }

    out.push({
      ...compactNote(note),
      markdown: noteMarkdown(note.id),
    });
  }

  return out;
}

export async function createNoteAction({
  title = 'Untitled',
  body = '',
  folderId = null,
  tags = [],
  icon = undefined,
  color = undefined,
} = {}) {
  const id = uid();

  const appearance = normalizeAppearancePatch({
    ...(icon !== undefined ? { icon } : {}),
    ...(color !== undefined ? { color } : {}),
  });

  const note = {
    id,
    title: String(title || 'Untitled').trim() || 'Untitled',
    type: 'markdown',
    folderId: folderId || null,
    tags: Array.isArray(tags) ? tags.map(String) : [],
    pinned: false,
    created: now(),
    updated: now(),
  };

  if (appearance.icon) {
    note.icon = appearance.icon;
  }

  if (appearance.color) {
    note.color = appearance.color;
  }

  state.notes.set(id, note);
  await store.notes.put(note);

  const entry = getNoteDoc(id);
  await entry.ready;

  const ytext = entry.doc.getText('markdown');
  const text = String(body || '');

  if (text) {
    ytext.insert(0, text);
  }

  await notifyNoteChanged(id, 'ai-create-note');

  return compactNote(note);
}

export async function updateNoteAppearanceAction(args = {}) {
  const id = String(args.noteId || args.id || '');
  const note = state.notes.get(id);

  if (!note) {
    throw new Error('Note not found');
  }

  const patch = normalizeAppearancePatch(args, {
    allowReset: true,
  });

  if (!hasOwn(patch, 'icon') && !hasOwn(patch, 'color')) {
    throw new Error('No appearance fields provided. Provide icon and/or color.');
  }

  const changed = applyAppearancePatchToObject(note, patch);

  if (changed) {
    note.updated = now();
    await store.notes.put(note);
  }

  await notifyNoteChanged(id, 'ai-update-note-appearance');

  return {
    ok: true,
    changed,
    note: compactNote(note),
  };
}

export async function appendToNoteAction({ noteId, text } = {}) {
  const id = String(noteId || '');

  if (!state.notes.has(id)) {
    throw new Error('Note not found');
  }

  const ytext = getMarkdownText(id);
  const append = String(text || '');

  if (!append.trim()) {
    throw new Error('Nothing to append');
  }

  const prefix = ytext.length > 0 && !ytext.toString().endsWith('\n')
    ? '\n\n'
    : '';

  ytext.insert(ytext.length, prefix + append + '\n');

  await notifyNoteChanged(id, 'ai-append-note');

  return {
    ok: true,
    noteId: id,
    appendedChars: append.length,
  };
}

export async function replaceCurrentSelectionAction({ text } = {}) {
  const view = getView();

  if (!view || !state.currentNoteId) {
    throw new Error('No editor selection available');
  }

  const sel = view.state.selection.main;

  if (!sel || sel.empty) {
    throw new Error('No text selected');
  }

  const insert = String(text || '');

  view.dispatch({
    changes: {
      from: sel.from,
      to: sel.to,
      insert,
    },
    selection: {
      anchor: sel.from + insert.length,
    },
    scrollIntoView: true,
  });

  view.focus();

  await notifyNoteChanged(state.currentNoteId, 'ai-replace-selection');

  return {
    ok: true,
    noteId: state.currentNoteId,
    insertedChars: insert.length,
  };
}

export async function deleteNoteAction({ noteId } = {}) {
  const id = String(noteId || '');
  const note = state.notes.get(id);

  if (!note) {
    throw new Error('Note not found');
  }

  await moveNoteToTrash(id, {
    source: 'ai',
  });

  return {
    ok: true,
    trashedNoteId: id,
    title: note.title || 'Untitled',
  };
}

function startOfLocalDayDate(base = new Date()) {
  const d = base instanceof Date ? new Date(base) : new Date(base);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDaysDate(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfLocalWeekDate(base = new Date()) {
  const d = startOfLocalDayDate(base);

  // Monday as week start.
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);

  return d;
}

function parseDateRangeInput(value, {
  end = false,
} = {}) {
  if (!value) return null;

  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  // Date-only strings are interpreted as local day boundaries.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    return d.getTime();
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;

  return d.getTime();
}

function resolveCalendarRange({
  range = '',
  start = '',
  end = '',
} = {}) {
  const explicitStart = parseDateRangeInput(start);
  const explicitEnd = parseDateRangeInput(end);

  if (explicitStart != null || explicitEnd != null) {
    return {
      startMs: explicitStart,
      endMs: explicitEnd,
      label: start || end ? 'custom' : '',
    };
  }

  const now = new Date();
  const key = String(range || '').trim().toLowerCase();

  if (key === 'today') {
    const s = startOfLocalDayDate(now);
    const e = addDaysDate(s, 1);

    return {
      startMs: s.getTime(),
      endMs: e.getTime(),
      label: 'today',
    };
  }

  if (key === 'tomorrow') {
    const s = addDaysDate(startOfLocalDayDate(now), 1);
    const e = addDaysDate(s, 1);

    return {
      startMs: s.getTime(),
      endMs: e.getTime(),
      label: 'tomorrow',
    };
  }

  if (key === 'this_week') {
    const s = startOfLocalWeekDate(now);
    const e = addDaysDate(s, 7);

    return {
      startMs: s.getTime(),
      endMs: e.getTime(),
      label: 'this_week',
    };
  }

  if (key === 'next_week') {
    const s = addDaysDate(startOfLocalWeekDate(now), 7);
    const e = addDaysDate(s, 7);

    return {
      startMs: s.getTime(),
      endMs: e.getTime(),
      label: 'next_week',
    };
  }

  if (key === 'upcoming') {
    const s = startOfLocalDayDate(now);
    const e = addDaysDate(s, 30);

    return {
      startMs: s.getTime(),
      endMs: e.getTime(),
      label: 'upcoming',
    };
  }

  return {
    startMs: null,
    endMs: null,
    label: '',
  };
}

function eventStartMs(ev) {
  if (!ev?.start) return null;

  if (typeof ev.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.start)) {
    const d = new Date(ev.start + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }

  const d = new Date(ev.start);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function eventEndMs(ev) {
  const start = eventStartMs(ev);
  if (start == null) return null;

  if (ev.end) {
    if (typeof ev.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.end)) {
      const d = new Date(ev.end + 'T00:00:00');

      if (!Number.isNaN(d.getTime())) {
        // YANTA stored/markdown all-day end is inclusive.
        // Dynamic source events are already exclusive.
        return d.getTime() + (ev.allDay && ev.source !== 'source' ? 86400000 : 0);
      }
    }

    const d = new Date(ev.end);

    if (!Number.isNaN(d.getTime())) {
      return d.getTime() + (ev.allDay && ev.source !== 'source' ? 86400000 : 0);
    }
  }

  if (ev.allDay) return start + 86400000;

  return start + 1;
}

function eventIntersectsRangeForAi(ev, startMs, endMs) {
  if (startMs == null && endMs == null) return true;

  const s = eventStartMs(ev);
  const e = eventEndMs(ev);

  if (s == null || e == null) return false;

  if (startMs != null && e <= startMs) return false;
  if (endMs != null && s >= endMs) return false;

  return true;
}

function compactCalendarEventForAi(ev, {
  source = 'stored',
} = {}) {
  return {
    id: ev.id,
    title: ev.title || 'Untitled event',
    start: ev.start,
    end: ev.end || null,
    allDay: !!ev.allDay,

    categoryId: ev.categoryId || null,
    icon: ev.icon || null,
    color: ev.color || null,

    location: ev.location || '',
    description: ev.description || '',
    noteId: ev.noteId || null,
    relatedNoteIds: ev.relatedNoteIds || [],
    tags: ev.tags || [],

    status: ev.status || 'confirmed',
    recurrence: ev.recurrence || null,
    reminders: ev.reminders || [],

    readonly: ev.readonly === true,
    generated: ev.generated === true,
    markdownDerived: ev.markdownDerived === true,

    source,
  };
}

async function collectMarkdownDerivedCalendarEventsForAi() {
  try {
    const calendar = await import('../calendar.js');

    const fullCalendarEvents = calendar.derivedEventsFromTasksAndNotes?.() || [];

    return fullCalendarEvents
      .map((fcEv) => fcEv?.extendedProps?.raw)
      .filter(Boolean)
      .map((ev) => ({
        ...ev,
        generated: true,
        markdownDerived: true,
      }));
  } catch {
    return [];
  }
}

export async function searchEventsAction({
  query = '',
  limit = 20,
  range = '',
  start = '',
  end = '',
  includeStored = true,
  includeMarkdownDerived = true,
  includeCancelled = false,
} = {}) {
  const {
    hydrateCalendarStateFromVault,
    expandedCalendarRawEventsForRange,
  } = await import('../calendar.js');

  hydrateCalendarStateFromVault({ silent: true });

  const q = String(query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(120, Number(limit || 20)));

  const resolvedRange = resolveCalendarRange({
    range,
    start,
    end,
  });

  const rangeStartForExpansion = resolvedRange.startMs != null
    ? new Date(resolvedRange.startMs)
    : addDaysDate(startOfLocalDayDate(new Date()), -365);

  const rangeEndForExpansion = resolvedRange.endMs != null
    ? new Date(resolvedRange.endMs)
    : addDaysDate(startOfLocalDayDate(new Date()), 365);

  const all = expandedCalendarRawEventsForRange(
    rangeStartForExpansion,
    rangeEndForExpansion,
    {
      includeStored,
      includeMarkdownDerived,
      includeSources: true,
    }
  ).map((ev) => ({
    ...ev,
    source: ev.markdownDerived ? 'markdown' : ev.source?.type ? 'source' : 'stored',
  }));

  const filtered = all
    .filter((ev) => {
      if (!includeCancelled && ev.status === 'cancelled') return false;

      if (!eventIntersectsRangeForAi(
        ev,
        resolvedRange.startMs,
        resolvedRange.endMs
      )) {
        return false;
      }

      if (!q) return true;

      return [
        ev.title || '',
        ev.description || '',
        ev.location || '',
        ev.tags?.join(' ') || '',
        ev.noteId || '',
      ].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const as = eventStartMs(a) ?? 0;
      const bs = eventStartMs(b) ?? 0;
      return as - bs || String(a.title || '').localeCompare(String(b.title || ''));
    })
    .slice(0, max)
    .map((ev) => compactCalendarEventForAi(ev, {
      source: ev.source || 'stored',
    }));

  return {
    range: {
      requested: range || null,
      start: resolvedRange.startMs != null
        ? new Date(resolvedRange.startMs).toISOString()
        : null,
      end: resolvedRange.endMs != null
        ? new Date(resolvedRange.endMs).toISOString()
        : null,
    },
    query: q || null,
    count: filtered.length,
    events: filtered,
  };
}

export async function createEventAction(args = {}) {
  const {
    hydrateCalendarStateFromVault,
    putCalendarEvent,
  } = await import('../calendar.js');

  hydrateCalendarStateFromVault({ silent: true });

  const appearance = normalizeAppearancePatch({
    ...(args.icon !== undefined ? { icon: args.icon } : {}),
    ...(args.color !== undefined ? { color: args.color } : {}),
  });

  const ev = putCalendarEvent({
    title: args.title || 'Untitled event',
    start: args.start,
    end: args.end || null,
    allDay: !!args.allDay,
    location: args.location || '',
    description: args.description || '',
    noteId: args.noteId || null,
    categoryId: args.categoryId || undefined,
    icon: appearance.icon || undefined,
    color: appearance.color || undefined,
    recurrence: args.recurrence || null,
    recurrenceExceptions: Array.isArray(args.recurrenceExceptions)
      ? args.recurrenceExceptions
      : [],
    recurrenceOverrides: args.recurrenceOverrides || {},
  });

  if (!ev) {
    throw new Error('Could not create event');
  }

  return ev;
}

export async function updateEventAction(args = {}) {
  const {
    hydrateCalendarStateFromVault,
    putCalendarEvent,
  } = await import('../calendar.js');

  hydrateCalendarStateFromVault({ silent: true });

  const id = String(args.eventId || args.id || '');
  const existing = state.calendarEvents.get(id);

  if (!existing) {
    throw new Error('Calendar event not found');
  }

  const ev = putCalendarEvent({
    ...existing,
    ...(args.patch || {}),
    id,
  });

  if (!ev) {
    throw new Error('Could not update event');
  }

  return ev;
}

export async function updateEventAppearanceAction(args = {}) {
  const {
    hydrateCalendarStateFromVault,
    putCalendarEvent,
  } = await import('../calendar.js');

  hydrateCalendarStateFromVault({ silent: true });

  const id = String(args.eventId || args.id || '');
  const existing = state.calendarEvents.get(id);

  if (!existing) {
    throw new Error('Calendar event not found');
  }

  const patch = normalizeAppearancePatch(args, {
    allowReset: true,
  });

  if (!hasOwn(patch, 'icon') && !hasOwn(patch, 'color')) {
    throw new Error('No appearance fields provided. Provide icon and/or color.');
  }

  const next = {
    ...existing,
  };

  const changed = applyAppearancePatchToObject(next, patch);

  let linkedNoteUpdated = null;

  // Calendar UI uses linked note appearance first. Therefore, when an event
  // is linked to a note, update the linked note by default as well.
  if (args.updateLinkedNote !== false && next.noteId && state.notes.has(next.noteId)) {
    const note = state.notes.get(next.noteId);
    const noteChanged = applyAppearancePatchToObject(note, patch);

    if (noteChanged) {
      note.updated = now();
      await store.notes.put(note);
      await notifyNoteChanged(note.id, 'ai-update-event-appearance-linked-note');

      linkedNoteUpdated = compactNote(note);
    }
  }

  const ev = putCalendarEvent(next);

  if (!ev) {
    throw new Error('Could not update event appearance');
  }

  return {
    ok: true,
    changed,
    event: compactCalendarEventForAi(ev),
    linkedNoteUpdated,
  };
}

export async function linkEventToNoteAction({ eventId, noteId } = {}) {
  const {
    hydrateCalendarStateFromVault,
    linkCalendarEventToNote,
  } = await import('../calendar.js');

  hydrateCalendarStateFromVault({ silent: true });

  const ok = await linkCalendarEventToNote(eventId, noteId, {
    ask: false,
  });

  return {
    ok,
    eventId,
    noteId,
  };
}

const WMO_WEATHER = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function weatherCodeText(code) {
  return WMO_WEATHER[Number(code)] || `Weather code ${code}`;
}

async function geocodeOpenMeteoLocation(query) {
  const q = String(query || '').trim();

  if (!q) return null;

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', q);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'de');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.href);

  if (!res.ok) {
    throw new Error(`Open-Meteo geocoding failed: HTTP ${res.status}`);
  }

  const json = await res.json();
  const hit = json?.results?.[0];

  if (!hit) {
    throw new Error(`Location not found: ${q}`);
  }

  return {
    latitude: Number(hit.latitude),
    longitude: Number(hit.longitude),
    label: [
      hit.name,
      hit.admin1,
      hit.country,
    ].filter(Boolean).join(', '),
    timezone: hit.timezone || '',
    source: 'open-meteo-geocoding',
  };
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getWeatherAction({
  location = '',
  latitude = null,
  longitude = null,
  days = 3,
  language = 'de',
} = {}) {
  let resolved = null;

  const loc = String(location || '').trim();
  const lat = numberOrNull(latitude);
  const lon = numberOrNull(longitude);

  // City/place names have priority over coordinates.
  //
  // This is critical because LLMs sometimes fill optional numeric parameters
  // with 0. Previously, latitude=0 and longitude=0 overrode location="Rostock",
  // resulting in weather for Null Island instead of Rostock.
  if (loc) {
    resolved = await geocodeOpenMeteoLocation(loc);
  } else if (lat != null || lon != null) {
    if (lat == null || lon == null) {
      throw new Error(
        'Invalid weather coordinates: both latitude and longitude are required. Pass a city/place name instead.'
      );
    }

    if (lat === 0 && lon === 0) {
      throw new Error(
        'Invalid weather coordinates: 0,0 looks like an accidental default value. Pass a city/place name instead.'
      );
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error(
        `Invalid weather coordinates: latitude=${lat}, longitude=${lon}.`
      );
    }

    resolved = {
      latitude: lat,
      longitude: lon,
      label: 'provided coordinates',
      source: 'tool-arguments',
      timezone: '',
    };
  } else {
    const stored = getApproxUserLocation();

    if (!stored) {
      throw new Error(
        'No approximate user location is stored. Ask the user for a city or ask them to enable approximate location in AI settings.'
      );
    }

    resolved = {
      latitude: Number(stored.latitude),
      longitude: Number(stored.longitude),
      label: stored.label || 'approximate user location',
      source: stored.source || 'stored-approx-location',
      timezone: stored.timezone || '',
      roundedToDecimals: stored.roundedToDecimals ?? null,
      updatedAt: stored.updatedAt || null,
    };
  }

  if (!Number.isFinite(resolved.latitude) || !Number.isFinite(resolved.longitude)) {
    throw new Error('Invalid weather coordinates.');
  }

  if (resolved.latitude === 0 && resolved.longitude === 0) {
    throw new Error(
      'Invalid weather coordinates: 0,0 looks like an accidental default value.'
    );
  }

  const forecastDays = Math.max(1, Math.min(7, Number(days || 3)));

  const url = new URL('https://api.open-meteo.com/v1/forecast');

  url.searchParams.set('latitude', String(resolved.latitude));
  url.searchParams.set('longitude', String(resolved.longitude));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', String(forecastDays));

  url.searchParams.set(
    'current',
    [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
    ].join(',')
  );

  url.searchParams.set(
    'daily',
    [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_probability_max',
      'precipitation_sum',
    ].join(',')
  );

  const res = await fetch(url.href);

  if (!res.ok) {
    throw new Error(`Open-Meteo forecast failed: HTTP ${res.status}`);
  }

  const json = await res.json();

  const daily = [];
  const d = json.daily || {};

  for (let i = 0; i < (d.time || []).length; i++) {
    daily.push({
      date: d.time[i],
      weatherCode: d.weather_code?.[i] ?? null,
      weather: weatherCodeText(d.weather_code?.[i]),
      temperatureMaxC: d.temperature_2m_max?.[i] ?? null,
      temperatureMinC: d.temperature_2m_min?.[i] ?? null,
      precipitationProbabilityMaxPct: d.precipitation_probability_max?.[i] ?? null,
      precipitationSumMm: d.precipitation_sum?.[i] ?? null,
    });
  }

  const current = json.current || {};

  return {
    provider: 'Open-Meteo',
    providerUrl: 'https://open-meteo.com/',
    location: {
      label: resolved.label,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      timezone: json.timezone || resolved.timezone || '',
      source: resolved.source,
      roundedToDecimals: resolved.roundedToDecimals ?? null,
      updatedAt: resolved.updatedAt || null,
    },
    current: {
      time: current.time || null,
      temperatureC: current.temperature_2m ?? null,
      apparentTemperatureC: current.apparent_temperature ?? null,
      humidityPct: current.relative_humidity_2m ?? null,
      precipitationMm: current.precipitation ?? null,
      windSpeedKmh: current.wind_speed_10m ?? null,
      weatherCode: current.weather_code ?? null,
      weather: weatherCodeText(current.weather_code),
    },
    daily,
    note: 'Weather data from Open-Meteo. Coordinates may be approximate.',
  };
}

function sanitizeSvgForDrawing(rawSvg = '') {
  const raw = String(rawSvg || '').trim();

  if (!raw) {
    throw new Error('SVG is required.');
  }

  if (!/^<svg[\s>]/i.test(raw)) {
    throw new Error('Only inline SVG starting with <svg> is supported.');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'image/svg+xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid SVG.');
  }

  const svg = doc.documentElement;

  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
    throw new Error('Invalid SVG root.');
  }

  for (const node of [...svg.querySelectorAll('script, foreignObject, iframe, object, embed')]) {
    node.remove();
  }

  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '').trim().toLowerCase();

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }

      if (
        (name === 'href' || name.endsWith(':href')) &&
        value.startsWith('javascript:')
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  if (!svg.getAttribute('xmlns')) {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  return new XMLSerializer().serializeToString(svg);
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function svgSize(svgText = '') {
  const width = Number(svgText.match(/\bwidth=["']?(\d+(?:\.\d+)?)/i)?.[1] || 0);
  const height = Number(svgText.match(/\bheight=["']?(\d+(?:\.\d+)?)/i)?.[1] || 0);

  const viewBox = svgText.match(/\bviewBox=["']([^"']+)["']/i)?.[1] || '';
  const vb = viewBox
    .split(/\s+/)
    .map(Number)
    .filter(Number.isFinite);

  return {
    width: Math.max(24, Math.min(2000, width || vb[2] || 320)),
    height: Math.max(24, Math.min(2000, height || vb[3] || 240)),
  };
}

export async function createDrawingNoteAction({
  title = 'Drawing',
  body = '',
  svg = '',
  folderId = null,
  tags = [],
  icon = 'line-squiggle',
  color = '#38bdf8',
} = {}) {
  const safeSvg = sanitizeSvgForDrawing(svg);
  const size = svgSize(safeSvg);

  const note = await createNoteAction({
    title,
    body: [
      String(body || '').trim(),
      '',
      '',
    ].join('\n').trim(),
    folderId,
    tags: Array.isArray(tags) ? tags : [],
    icon,
    color,
  });

  const drawingId = `ai_draw_${uid()}`;
  const fileId = `svg_${uid()}`;

  const imageElement = {
    id: uid(),
    type: 'image',
    x: 40,
    y: 40,
    width: size.width,
    height: size.height,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: now(),
    link: null,
    locked: false,
    fileId,
    scale: [1, 1],
    status: 'saved',
    customData: {
      yanta: {
        generatedBy: 'ai',
        source: 'svg',
      },
    },
  };

  setDrawing(note.id, drawingId, {
    id: drawingId,
    title: title || 'AI Drawing',
    canvas: {
      width: Math.max(420, size.width + 80),
      height: Math.max(260, size.height + 80),
    },
    elements: [imageElement],
    appState: {},
    files: {
      [fileId]: {
        id: fileId,
        dataURL: svgToDataUrl(safeSvg),
        mimeType: 'image/svg+xml',
        created: now(),
        lastRetrieved: now(),
      },
    },
  }, 'ai-create-drawing');

  await appendToNoteAction({
    noteId: note.id,
    text: `draw://${drawingId}`,
  });

  await notifyNoteChanged(note.id, 'ai-create-drawing-note');

  return {
    ok: true,
    note,
    drawingId,
    svgBytes: new TextEncoder().encode(safeSvg).byteLength,
  };
}

export async function webSearchAction({
  query = '',
  limit = 6,
  country = '',
  freshness = '',
} = {}) {
  const q = String(query || '').trim();

  if (!q) {
    throw new Error('Search query is required.');
  }

  const args = {
    query: q,
    limit: Math.max(1, Math.min(10, Number(limit || 6))),
    country: String(country || '').trim(),
    freshness: String(freshness || '').trim(),
  };

  const cacheKey = cachedJsonKey('web-search', args);
  const cached = getFreshCache(WEB_SEARCH_CACHE, cacheKey, 10 * 60 * 1000);

  if (cached) {
    return {
      ...cached,
      cached: true,
    };
  }

  const url = new URL(cloudApiUrl('/api/search/brave'));
  url.searchParams.set('q', args.query);
  url.searchParams.set('limit', String(args.limit));

  if (args.country) url.searchParams.set('country', args.country.slice(0, 8));
  if (args.freshness) url.searchParams.set('freshness', args.freshness.slice(0, 20));

  const res = await fetch(url.href, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  let json = null;

  try {
    json = await res.json();
  } catch {}

  if (!res.ok) {
    throw new Error(
      json?.message ||
      json?.error?.message ||
      json?.error ||
      `Brave Search failed: HTTP ${res.status}`
    );
  }

  return setFreshCache(WEB_SEARCH_CACHE, cacheKey, json);
}

export async function webReadAction({
  url = '',
  maxChars = 12000,
} = {}) {
  const cleanUrl = String(url || '').trim();

  if (!cleanUrl) {
    throw new Error('URL is required.');
  }

  const args = {
    url: cleanUrl,
    maxChars: Math.max(1000, Math.min(30000, Number(maxChars || 12000))),
  };

  const cacheKey = cachedJsonKey('web-read', args);
  const cached = getFreshCache(WEB_READ_CACHE, cacheKey, 10 * 60 * 1000);

  if (cached) {
    return {
      ...cached,
      cached: true,
    };
  }

  const api = new URL(cloudApiUrl('/api/search/read'));
  api.searchParams.set('url', cleanUrl);
  api.searchParams.set('maxChars', String(args.maxChars));

  const res = await fetch(api.href, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  let json = null;

  try {
    json = await res.json();
  } catch {}

  if (!res.ok) {
    throw new Error(
      json?.message ||
      json?.error?.message ||
      json?.error ||
      `Web page read failed: HTTP ${res.status}`
    );
  }

  return setFreshCache(WEB_READ_CACHE, cacheKey, json);
}
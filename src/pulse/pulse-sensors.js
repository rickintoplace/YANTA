// ============================================================
// YANTA Pulse — sensors
//
// Deterministic, local, LLM-free change detection. Event-triggered
// routines only reach the model once a sensor reports something new,
// which is what keeps a quiet day free: no signal, no request, no
// Inbox card, no cost.
//
// Every sensor answers the same question: has anything relevant
// happened since `since`, and how would you describe it in one line?
// ============================================================

import { state } from '../core.js';

import { PULSE_EVENTS } from './pulse-config.js';

const CALENDAR_SOON_MS = 60 * 60 * 1000;

function eventStartMs(ev) {
  const raw = ev?.start ?? ev?.startAt ?? ev?.date;
  const ms = typeof raw === 'number' ? raw : Date.parse(raw || '');

  return Number.isFinite(ms) ? ms : 0;
}

async function rssNewSensor(since, now) {
  const { listRssItems } = await import('../rss/rss-store.js');

  const items = await listRssItems({ unreadOnly: true, limit: 200 });

  const fresh = items.filter((item) =>
    Number(item.discoveredAt || item.publishedAt || 0) > since
  );

  if (!fresh.length) return null;

  return {
    count: fresh.length,
    summary: `${fresh.length} new unread article${fresh.length === 1 ? '' : 's'} since the last run`,
    sample: fresh.slice(0, 8).map((item) => item.title || '').filter(Boolean),
    unreadTotal: items.length,
    now,
  };
}

function calendarSoonSensor(since, now) {
  const upcoming = [];

  for (const ev of state.calendarEvents.values()) {
    const start = eventStartMs(ev);

    if (start > now && start <= now + CALENDAR_SOON_MS) {
      upcoming.push({ id: ev.id, title: ev.title || 'Event', start });
    }
  }

  if (!upcoming.length) return null;

  upcoming.sort((a, b) => a.start - b.start);

  return {
    count: upcoming.length,
    summary: `${upcoming.length} event${upcoming.length === 1 ? '' : 's'} starting within the hour`,
    sample: upcoming.map((ev) => ev.title),
    eventIds: upcoming.map((ev) => ev.id),
  };
}

function calendarChangedSensor(since) {
  const changed = [...state.calendarEvents.values()]
    .filter((ev) => Number(ev.updated || 0) > since);

  if (!changed.length) return null;

  return {
    count: changed.length,
    summary: `${changed.length} calendar event${changed.length === 1 ? '' : 's'} changed since the last run`,
    sample: changed.slice(0, 8).map((ev) => ev.title || 'Event'),
    eventIds: changed.slice(0, 20).map((ev) => ev.id),
  };
}

function notesChangedSensor(since) {
  const changed = [...state.notes.values()]
    .filter((note) =>
      Number(note.updated || 0) > since &&
      !note.trashed &&
      !note.aiBrain
    );

  if (!changed.length) return null;

  return {
    count: changed.length,
    summary: `${changed.length} note${changed.length === 1 ? '' : 's'} changed since the last run`,
    sample: changed.slice(0, 8).map((note) => note.title || 'Untitled'),
    noteIds: changed.slice(0, 20).map((note) => note.id),
  };
}

async function chatUnreadSensor() {
  const { chatListRoomsAction } = await import('../chat/chat-ai-actions.js');

  let rooms = [];

  try {
    const result = await chatListRoomsAction({ limit: 60 });
    rooms = Array.isArray(result?.rooms) ? result.rooms : [];
  } catch {
    return null;
  }

  const unread = rooms.filter((room) => Number(room.unread || 0) > 0);

  if (!unread.length) return null;

  return {
    count: unread.reduce((sum, room) => sum + Number(room.unread || 0), 0),
    summary: `Unread messages in ${unread.length} chat${unread.length === 1 ? '' : 's'}`,
    sample: unread.slice(0, 8).map((room) => room.name || room.roomId),
  };
}

const SENSORS = {
  [PULSE_EVENTS.RSS_NEW]: rssNewSensor,
  [PULSE_EVENTS.CALENDAR_SOON]: calendarSoonSensor,
  [PULSE_EVENTS.CALENDAR_CHANGED]: calendarChangedSensor,
  [PULSE_EVENTS.NOTES_CHANGED]: notesChangedSensor,
  [PULSE_EVENTS.CHAT_UNREAD]: chatUnreadSensor,
};

/**
 * Reads one sensor. Returns null for "nothing new" — callers treat
 * that as a reason to skip the run entirely.
 */
export async function readSensor(event, since = 0, now = Date.now()) {
  const sensor = SENSORS[event];

  if (!sensor) return null;

  try {
    return await sensor(since, now);
  } catch (err) {
    console.warn('[YANTA Pulse] sensor failed', event, err);
    return null;
  }
}

/**
 * Reads every sensor a routine subscribes to.
 *
 * @returns {Promise<{signals: Object, hasSignal: boolean, summary: string}>}
 */
export async function readSensors(events = [], since = 0, now = Date.now()) {
  const signals = {};

  for (const event of events) {
    const signal = await readSensor(event, since, now);
    if (signal) signals[event] = signal;
  }

  const lines = Object.entries(signals).map(([event, signal]) =>
    `- ${event}: ${signal.summary}${
      signal.sample?.length ? ` (${signal.sample.slice(0, 5).join('; ')})` : ''
    }`
  );

  return {
    signals,
    hasSignal: lines.length > 0,
    summary: lines.join('\n'),
  };
}

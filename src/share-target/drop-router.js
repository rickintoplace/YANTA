// ============================================================
// YANTA — text dropped into the app from elsewhere
//
// Mark text in a browser, a mail or a chat and drag it onto YANTA:
//   - a feed or a YouTube channel link becomes a source, right away;
//   - text that names a moment opens the event editor, filled in
//     (the same parser and second look as the share sheet);
//   - text dropped on a calendar day without a date of its own becomes
//     an event on that day;
//   - anything else asks once whether to make a note of it — in the
//     folder it was dropped on, or the one open on the dashboard.
//
// main.js decides that a drop is ours (external, not onto an editor or
// another drop zone) and passes the target; this module only routes.
// Lazy, like the share router it reuses.
// ============================================================

import { actionToast, state, toast } from '../core.js';
import { getLocale, t } from '../i18n/index.js';
import { draftEventFromText } from '../calendar-text-event.js';
import { dateOrderForLocale } from '../calendar-text-parse.js';
import { openEventFromText } from './share-router.js';

const TITLE_MAX = 80;

/** The one URL a drop consists of, or ''. */
export function droppedUrl(text, uriList = '') {
  const fromList = String(uriList || '').split(/\r?\n/).find((l) => l && !l.startsWith('#')) || '';
  const candidate = (fromList || String(text || '')).trim();
  return /^https?:\/\/\S+$/i.test(candidate) ? candidate : '';
}

/*
  Links that are a subscription in themselves: feed files and paths, and
  YouTube channels (not single videos — those are something to note).
*/
export function isSubscribableUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }

  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  const path = u.pathname.toLowerCase();

  if (host === 'youtube.com') {
    return /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(?:\/(?:videos|featured|streams)?)?\/?$/.test(u.pathname) ||
      path.startsWith('/feeds/videos.xml');
  }

  return /\.(?:rss|atom)$/.test(path) ||
    /\/(?:feed|rss|atom)(?:\.xml)?\/?$/.test(path) ||
    /\/feeds?\//.test(path) ||
    /(?:^|\.)feeds?\./.test(host) ||
    /\.xml$/.test(path) && /rss|feed|atom/.test(path);
}

function folderName(folderId) {
  if (!folderId) return t('drop.rootFolder');
  return state.folders.get(folderId)?.name || t('drop.rootFolder');
}

function noteTitleFrom(text) {
  const first = String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const clean = first.replace(/^#+\s*/, '').replace(/\s+/g, ' ');
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean;
}

async function addSource(url) {
  const { addRssFeedFromUniversalInput } = await import('../rss/rss-actions.js');
  try {
    await addRssFeedFromUniversalInput(url);
    toast(t('shareTarget.saved.rss'), 'success');
    return true;
  } catch (err) {
    toast(err?.message || t('drop.sourceFailed'), 'error');
    return false;
  }
}

async function createNote(text, folderId) {
  const { createNoteAction } = await import('../ai/app-actions.js');
  const lines = String(text || '').trim().split(/\r?\n/);
  const title = noteTitleFrom(text) || t('drop.untitled');

  // The first line is the title; the rest is the body — unless the text
  // is a single line, which then also stays in the body.
  const body = lines.length > 1 ? lines.slice(1).join('\n').trim() : String(text || '').trim();

  const note = await createNoteAction({ title, body, folderId: folderId || null });

  actionToast(t('drop.noteCreated', { folder: folderName(folderId) }), {
    actionLabel: t('drop.openNote'),
    onAction: async () => {
      const { openNote } = await import('../notes.js');
      await openNote(note.id);
    },
    type: 'success',
  });
}

/**
 * Routes a drop. Resolves to what happened: 'source', 'event', 'note',
 * 'capture' or null (cancelled / nothing to do).
 *
 * @param {object} drop
 * @param {string} drop.text      text/plain of the drag
 * @param {string} [drop.uriList] text/uri-list of the drag
 * @param {string|null} [drop.folderId]  folder it was dropped on, if any
 * @param {string} [drop.date]    YYYY-MM-DD of a calendar day it was dropped on
 */
export async function routeDroppedText({ text = '', uriList = '', folderId = undefined, date = '' } = {}) {
  const source = String(text || '').trim() || String(uriList || '').trim();
  if (!source) return null;

  const url = droppedUrl(source, uriList);

  if (url && isSubscribableUrl(url)) {
    return (await addSource(url)) ? 'source' : null;
  }

  const draft = url ? null : draftEventFromText(source, { dateOrder: dateOrderForLocale(getLocale()) });

  if (draft) {
    await openEventFromText(source, { draft });
    return 'event';
  }

  // A day in the calendar is a date of its own.
  if (date) {
    const { openCalendar, openNewCalendarEvent } = await import('../calendar.js');
    openCalendar?.({ push: false });
    openNewCalendarEvent({
      title: noteTitleFrom(source).slice(0, 140),
      start: `${date}T00:00:00`,
      allDay: true,
      description: source,
    });
    return 'event';
  }

  const targetFolder = folderId !== undefined ? folderId : (state.dashboardFolderId || null);
  const { yantaChoice } = await import('../dialogs.js');

  const choices = [
    { id: 'note', icon: 'file-plus', primary: true, label: t('drop.createNoteIn', { folder: folderName(targetFolder) }) },
    { id: 'capture', icon: 'zap', label: t('drop.capture'), hint: t('drop.captureHint') },
  ];
  if (url) choices.push({ id: 'source', icon: 'rss', label: t('drop.addSource'), hint: t('drop.addSourceHint') });

  const preview = source.length > 160 ? `${source.slice(0, 159)}…` : source;
  const choice = await yantaChoice({
    title: t('drop.title'),
    message: preview,
    icon: 'download',
    choices,
    cancelLabel: t('common.cancel'),
  });

  if (choice === 'note') {
    await createNote(source, targetFolder);
    return 'note';
  }

  if (choice === 'capture') {
    const { captureToJournal } = await import('../journal.js');
    await captureToJournal(source, { source: 'drop' });
    toast(t('shareTarget.saved.capture'), 'success');
    return 'capture';
  }

  if (choice === 'source') return (await addSource(url)) ? 'source' : null;

  return null;
}

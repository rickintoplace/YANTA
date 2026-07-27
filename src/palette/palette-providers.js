// ============================================================
// YANTA — Palette result providers.
//
// Everything the palette can find, split by cost:
//
//   collectInstant()   pure in-memory reads (notes, folders, events,
//                      commands). Safe to run on every keystroke.
//   collectDeferred()  IndexedDB / worker backed (chat messages, semantic
//                      matches). Debounced, streamed in as each resolves.
//
// Providers only *find* things. Loading a heavy feature module is deferred
// to the moment an item is actually accepted, so typing never pulls in
// calendar.js or the Matrix stack.
// ============================================================

import { state } from '../core.js';
import { openNote } from '../notes.js';
import { renderTree } from '../tree.js';
import { isNoteInTrash } from '../trash.js';
import { noteMarkdown } from '../yjs.js';
import { vaultEventsMap, vaultTombstonesMap } from '../sync2/vault-doc.js';
import { formatDateTime } from '../i18n/format.js';
import { scoreFuzzy, scoreText, snippetFor } from '../text-search.js';
import { listCommands, recentCommands, searchCommands } from './palette-commands.js';

/**
 * Render order. Notes come first because "jump to my stuff" is the dominant
 * intent; commands stay one `>` away and still surface here by name.
 * Deferred groups sit at the bottom so late arrivals never push the
 * selection around.
 */
export const GROUPS = [
  { id: 'recentNotes', labelKey: 'palette.group.recentNotes' },
  { id: 'recentCommands', labelKey: 'palette.group.recentCommands' },
  { id: 'notes', labelKey: 'palette.group.notes' },
  { id: 'commands', labelKey: 'palette.group.commands' },
  { id: 'folders', labelKey: 'palette.group.folders' },
  { id: 'events', labelKey: 'palette.group.events' },
  { id: 'messages', labelKey: 'palette.group.messages' },
  { id: 'related', labelKey: 'palette.group.related' },
];

const LIMIT = {
  recentNotes: 5,
  recentCommands: 5,
  notes: 8,
  commands: 8,
  folders: 4,
  events: 5,
  messages: 5,
  related: 4,
};

/** A title match must always outrank a body-only match, whatever the lengths. */
const TITLE_TIER = 2000;

/** Newer items win ties, capped so recency never beats relevance. */
function recencyBoost(updated) {
  const ageDays = Math.max(0, (Date.now() - Number(updated || 0)) / 86_400_000);
  return 60 * Math.exp(-ageDays / 30);
}

function folderPath(folderId) {
  const parts = [];
  let f = folderId ? state.folders.get(folderId) : null;

  // Hop cap guards against a cyclic parentId — a corrupt vault must not hang.
  for (let hops = 0; f && hops < 32; hops++) {
    parts.unshift(f.name || '');
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  return parts.filter(Boolean).join(' / ');
}

// -------- Notes ------------------------------------------------

function noteItem(note, { score, snippet = '' }) {
  return {
    key: `note:${note.id}`,
    group: 'notes',
    icon: note.pinned ? 'pin' : 'file',
    label: note.title || '',
    meta: folderPath(note.folderId),
    snippet,
    score,
    run: () => openNote(note.id),
  };
}

function searchNotes(query, tokens) {
  const hits = [];

  for (const note of state.notes.values()) {
    if (isNoteInTrash(note)) continue;

    const title = scoreFuzzy(note.title || '', query);

    // searchIndex holds a pre-lowercased title+tags+body+drawings haystack and
    // is always populated — title/tags immediately, bodies progressively at boot.
    const body = scoreText(state.searchIndex.get(note.id) || '', query, tokens);

    if (!title && !body) continue;

    hits.push({
      note,
      titleHit: title > 0,
      score: (title ? TITLE_TIER + title * 10 : 0) + body + recencyBoost(note.updated),
    });
  }

  hits.sort((a, b) => b.score - a.score);

  // Snippets need the full markdown, so build them only for what is shown.
  return hits.slice(0, LIMIT.notes).map(({ note, titleHit, score }) => {
    let snippet = '';

    if (!titleHit) {
      try {
        // Little leading context: the row is one clipped line, so the match
        // has to survive the ellipsis.
        snippet = snippetFor(noteMarkdown(note.id), query, { before: 24, after: 140 });
      } catch {}
    }

    return noteItem(note, { score, snippet });
  });
}

function recentNotes() {
  return [...state.notes.values()]
    .filter((n) => !isNoteInTrash(n))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .slice(0, LIMIT.recentNotes)
    .map((note) => ({ ...noteItem(note, { score: 0 }), group: 'recentNotes' }));
}

// -------- Folders ----------------------------------------------

function revealFolder(folderId) {
  let f = state.folders.get(folderId);

  for (let hops = 0; f && hops < 32; hops++) {
    state.expandedFolders.add(f.id);
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  renderTree();

  requestAnimationFrame(() => {
    document
      .querySelector(`.tree-folder-node[data-folder-id="${CSS.escape(folderId)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function searchFolders(query) {
  return [...state.folders.values()]
    .map((folder) => ({ folder, score: scoreFuzzy(folder.name || '', query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT.folders)
    .map(({ folder, score }) => ({
      key: `folder:${folder.id}`,
      group: 'folders',
      icon: 'folder',
      label: folder.name || '',
      meta: folderPath(folder.parentId),
      score,
      run: () => revealFolder(folder.id),
    }));
}

// -------- Calendar events --------------------------------------

/**
 * Prefers the hydrated calendar state (sanitized, shared-space events merged
 * in) and falls back to the raw vault map when the calendar has not been
 * opened yet — so search works from a cold start without pulling in
 * calendar.js, at the cost of not seeing mounted shared-space events.
 */
function calendarEventSource() {
  if (state.calendarEvents.size) return [...state.calendarEvents.values()];

  try {
    const tombstones = vaultTombstonesMap();

    return [...vaultEventsMap().entries()]
      .filter(([id, raw]) => raw && !tombstones.has(id))
      .map(([, raw]) => raw);
  } catch {
    return [];
  }
}

function searchEvents(query, tokens) {
  const out = [];

  for (const ev of calendarEventSource()) {
    if (!ev?.id) continue;

    const title = scoreFuzzy(ev.title || '', query);
    const detail = scoreText(
      `${ev.location || ''} ${ev.description || ''}`.toLowerCase(),
      query,
      tokens
    );

    if (!title && !detail) continue;

    out.push({
      key: `event:${ev.id}`,
      group: 'events',
      icon: 'calendar-days',
      label: ev.title || '',
      meta: ev.start ? formatDateTime(new Date(ev.start)) : '',
      snippet: ev.location || '',
      score: (title ? TITLE_TIER + title * 10 : 0) + detail,
      run: () => import('../calendar.js').then((m) => m.openCalendarEvent(ev.id)),
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, LIMIT.events);
}

// -------- Commands ---------------------------------------------

function commandItem(command, score, group = 'commands') {
  return {
    key: `command:${command.label}`,
    group,
    icon: command.icon || 'square',
    label: command.label,
    hint: command.hint || '',
    command,
    score,
    run: () => command.action?.(),
  };
}

// -------- Public API -------------------------------------------

/**
 * In-memory results for `query`. `scope === 'commands'` is the `>` prefix mode.
 * An empty query returns the resume surface: recent notes and recent commands.
 */
export function collectInstant({ query, tokens, scope }) {
  const matchedCommands = () =>
    searchCommands(query)
      .slice(0, LIMIT.commands)
      .map(({ command, score }) => commandItem(command, score));

  const browseCommands = () => listCommands().map((c) => commandItem(c, 0));

  if (scope === 'commands') {
    return query ? matchedCommands() : browseCommands();
  }

  if (!query) {
    const resume = [
      ...recentNotes(),
      ...recentCommands().map((c) => commandItem(c, 0, 'recentCommands')),
    ];

    // Nothing to resume yet (fresh vault): offer the catalogue rather than
    // an empty overlay.
    return resume.length ? resume : browseCommands();
  }

  return [
    ...searchNotes(query, tokens),
    ...matchedCommands(),
    ...searchFolders(query),
    ...searchEvents(query, tokens),
  ];
}

/**
 * Slow results. Each provider streams into `onGroup(groupId, items)` as soon
 * as it resolves; `signal` aborts everything once the query moves on.
 * Failures stay local to their provider — a missing chat index must never
 * break note search.
 */
export async function collectDeferred({ query, exclude, onGroup, signal }) {
  // One character matches nearly everything; the cost is not worth the noise.
  if (query.length < 2) return;

  const live = () => !signal.aborted;

  await Promise.allSettled([
    (async () => {
      const { searchChatMessages } = await import('../chat/chat-search.js');
      const rows = await searchChatMessages(query, { limit: LIMIT.messages });

      if (!live() || !rows.length) return;

      onGroup('messages', rows.map((row) => ({
        key: `message:${row.id}`,
        group: 'messages',
        icon: 'message-square',
        label: row.sender || '',
        meta: row.ts ? formatDateTime(new Date(row.ts)) : '',
        snippet: row.snippet || '',
        score: row.score || 0,
        run: () =>
          import('../chat/chat-ui.js').then((m) => m.jumpToMessageFromSearch(row)),
      })));
    })(),

    (async () => {
      const semantic = await import('../semantic/semantic-index.js');

      if (!semantic.semanticEnabled() || !semantic.semanticReady()) return;

      const rows = await semantic.semanticSearchDebounced(query, {
        topK: LIMIT.related * 3,
      });

      if (!live()) return;

      // Only genuinely *new* finds: a note already listed under "Notes"
      // would just be the same row again with a different icon.
      const items = rows
        .map((r) => ({ note: state.notes.get(r.noteId), preview: r.preview }))
        .filter(({ note }) =>
          note && !isNoteInTrash(note) && !exclude.has(`note:${note.id}`))
        .slice(0, LIMIT.related)
        .map(({ note, preview }) => ({
          ...noteItem(note, { score: 0, snippet: preview || '' }),
          key: `related:${note.id}`,
          group: 'related',
          icon: 'sparkles',
        }));

      if (items.length) onGroup('related', items);
    })(),
  ]);
}

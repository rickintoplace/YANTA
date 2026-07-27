// ============================================================
// YANTA — Palette commands.
//
// The command catalogue plus its "frecency" ranking. Command labels stay
// English on purpose: this is a keyboard/power-user surface, consistent with
// the shortcuts themselves. Only the palette chrome is localized.
//
// Callers inject their actions via buildCommandList() so this module never
// has to import the heavy feature modules (calendar, sync, sharing, …).
// ============================================================

import { $, state } from '../core.js';
import { cycleAppearanceMode } from '../settings.js';
import { deleteCurrentNote, newNote, newFolder, togglePin } from '../notes.js';
import { currentFolderForNew } from '../tree.js';
import { insertAtCursor } from '../editor.js';
import { scoreFuzzy } from '../text-search.js';

const MRU_KEY = 'yanta.palette.commandUse.v1';
const MRU_MAX = 40;

let commandList = [];

// -------- Frecency ---------------------------------------------
//
// Device-local by nature (like the theme or the language choice), so
// localStorage rather than the synced vault: which commands *you* run on
// *this* machine is not something other devices should inherit.

/** @type {Record<string, { at: number, n: number }>} */
let usage = null;

function loadUsage() {
  if (usage) return usage;

  try {
    const raw = JSON.parse(localStorage.getItem(MRU_KEY) || '{}');
    usage = raw && typeof raw === 'object' ? raw : {};
  } catch {
    usage = {};
  }

  return usage;
}

/**
 * Recency dominates, repetition keeps a command warm.
 * Half-life ≈ 7 days, so yesterday's workflow outranks last month's.
 */
function frecency(entry) {
  if (!entry) return 0;

  const ageDays = Math.max(0, (Date.now() - entry.at) / 86_400_000);

  return 100 * Math.exp(-ageDays / 10) + 20 * Math.log2(1 + entry.n);
}

/** Records one command run. Called by the palette when an item is accepted. */
export function noteCommandUsed(label) {
  const key = String(label || '');
  if (!key) return;

  const store = loadUsage();
  const prev = store[key];

  store[key] = { at: Date.now(), n: (prev?.n || 0) + 1 };

  // Keep the store bounded: drop the coldest entries, not the oldest ones,
  // so a rarely-but-recently used command survives a prune.
  const keys = Object.keys(store);

  if (keys.length > MRU_MAX) {
    keys
      .sort((a, b) => frecency(store[a]) - frecency(store[b]))
      .slice(0, keys.length - MRU_MAX)
      .forEach((k) => delete store[k]);
  }

  try {
    localStorage.setItem(MRU_KEY, JSON.stringify(store));
  } catch {}
}

// -------- Lookup -----------------------------------------------

/** The commands run most recently on this device, newest-relevant first. */
export function recentCommands(limit = 5) {
  const store = loadUsage();

  return commandList
    .filter((c) => store[c.label])
    .sort((a, b) => frecency(store[b.label]) - frecency(store[a.label]))
    .slice(0, limit);
}

/**
 * The full catalogue for browsing (empty query): what you reach for most,
 * then everything else in its authored order.
 */
export function listCommands() {
  const recent = recentCommands();
  const seen = new Set(recent.map((c) => c.label));

  return [...recent, ...commandList.filter((c) => !seen.has(c.label))];
}

/**
 * Fuzzy-matches `query` against command labels.
 * Prefix matches and frequently used commands float to the top.
 */
export function searchCommands(query) {
  const store = loadUsage();

  return commandList
    .map((c) => {
      const base = scoreFuzzy(c.label, query);
      if (!base) return null;

      const prefix = c.label.toLowerCase().startsWith(query) ? 50 : 0;

      return { command: c, score: base + prefix + frecency(store[c.label]) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

// -------- Catalogue --------------------------------------------

export function buildCommandList({
  openImageModal,
  openIconInsertPicker,
  openDraw,
  openGraph,
  openDashboard,
  openCalendar,
  openCalendarPane,
  openDashboardPane,
  openCitationManager,
  openChat,
  openAssistant,
  openAssistantFloating,
  openSources,
  openPresentationPairing,
  exportAsZip,
  exportNoteAsMd,
  exportBundle,
  exportEveryNoteMd,
  openSyncSetup,
  syncFull,
  syncDisconnect,
  cleanupUnusedImages,
  openShareModal,
  stopSharing,
  openPublicSharesManager,
  openChatSearch,
  importChatArchive,
}) {
  commandList = [
    { label: 'Quick capture (to today’s note)', icon: 'zap', hint: 'Ctrl+Shift+Space', action: () => import('../journal.js').then((m) => m.openQuickCapture({ source: 'palette' })) },
    { label: 'Open today’s note', icon: 'sun', action: () => import('../journal.js').then((m) => m.openTodayNote()) },
    { label: 'New note', icon: 'plus', hint: 'Ctrl+N', action: () => newNote(currentFolderForNew()) },
    { label: 'New shopping/checklist (live-friendly)', icon: 'shopping-cart', action: () => newNote(currentFolderForNew(), 'list') },
    { label: 'New folder', icon: 'folder-plus', action: () => newFolder(null) },
    { label: 'Open dashboard', icon: 'layout-dashboard', hint: 'Ctrl+H', action: openDashboard },
    { label: 'Open dashboard in side pane', icon: 'panel-right', action: openDashboardPane },
    { label: 'Open calendar', icon: 'calendar-days', hint: 'Ctrl+Shift+C', action: openCalendar },
    { label: 'Open calendar in side pane', icon: 'panel-right', action: openCalendarPane },
    { label: 'Open Sources', icon: 'rss', hint: 'RSS / feeds', action: openSources },
    { label: 'Open chat', icon: 'messages-square', action: () => openChat?.() },
    { label: 'Open AI assistant', icon: 'sparkles', hint: 'Ctrl+J', action: openAssistant },
    { label: 'Open AI assistant as floating window', icon: 'picture-in-picture-2', action: openAssistantFloating },
    { label: 'Open graph view', icon: 'network', hint: 'Ctrl+G', action: openGraph },
    { label: 'Filter notes in sidebar', icon: 'list-filter', hint: 'Ctrl+K', action: () => $('search')?.focus() },
    {
      label: 'Search chat messages',
      icon: 'messages-square',
      hint: 'Local E2EE index',
      action: () => openChatSearch?.(),
    },
    {
      label: 'Import YANTA chat archive…',
      icon: 'archive',
      action: () => importChatArchive?.(),
    },
    { label: 'Toggle preview/edit/split', icon: 'eye', hint: 'Ctrl+/', action: () => window.dispatchEvent(new CustomEvent('yanta-cycle-view')) },
    { label: 'Insert image', icon: 'image', hint: 'Ctrl+I', action: openImageModal },
    { label: 'Insert citation', icon: 'quote', hint: '/cite', action: openCitationManager },
    { label: 'Insert drawing', icon: 'line-squiggle', hint: '/drawing', action: openDraw },
    { label: 'Insert Lucide icon', icon: 'sparkles', action: openIconInsertPicker },
    { label: 'Insert wikilink', icon: 'link', action: () => insertAtCursor('[[') },
    { label: 'Toggle pin', icon: 'pin', action: togglePin },
    { label: 'Cycle theme (auto/dark/light)', icon: 'moon', hint: 'T', action: cycleAppearanceMode },
    { label: 'Share this note…', icon: 'share', action: openShareModal },
    {
      label: 'Pair meeting-room display',
      icon: 'camera',
      hint: 'Scan QR from yanta.page/present',
      action: openPresentationPairing,
    },
    { label: 'Manage public shared notes', icon: 'globe', action: openPublicSharesManager },
    { label: 'Stop live sharing this note', icon: 'x', action: stopSharing },
    { label: 'Sync: set up folder…', icon: 'refresh', action: openSyncSetup },
    { label: 'Sync: pull + push now', icon: 'refresh', action: () => syncFull(true) },
    { label: 'Sync: disconnect folder', icon: 'x', action: syncDisconnect },
    { label: 'Export as folder ZIP', icon: 'download', action: exportAsZip },
    { label: 'Export current note (.md)', icon: 'download', hint: 'Ctrl+E', action: () => { const n = state.notes.get(state.currentNoteId); if (n) exportNoteAsMd(n); } },
    { label: 'Export full bundle (.json)', icon: 'download', action: exportBundle },
    { label: 'Export every note as .md', icon: 'download', action: exportEveryNoteMd },
    { label: 'Import files (md/json/zip)…', icon: 'upload', action: () => $('importFile')?.click() },
    { label: 'Import folder…', icon: 'upload', action: () => $('importFolder')?.click() },
    { label: 'Find unused images…', icon: 'image', action: cleanupUnusedImages },
    { label: 'Delete current note', icon: 'trash', action: deleteCurrentNote },
  ];
}

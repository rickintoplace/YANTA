// ============================================================
// YANTA Pulse — run state, Inbox and history
//
// Backed by the shared Pulse document (pulse-doc.js), so everything
// here is cross-device: the phone shows what the laptop produced, and
// reading a card on either clears it on both.
//
// Day counters are derived rather than stored, so devices in different
// timezones cannot disagree about what "today" means: each device reads
// the run timestamps and counts the ones inside its own local day.
// ============================================================

import { store, uid } from '../core.js';

import {
  pulseMaps,
  touchPulseNote,
  observePulseDoc,
} from './pulse-doc.js';

const LEGACY_STATE_KEY = 'yanta.pulse.state.v1';
const LEGACY_INBOX_KEY = 'yanta.pulse.inbox.v1';
const MIGRATED_KEY = 'yanta.pulse.migrated.v2';

const INBOX_MAX = 60;
const HISTORY_MAX = 120;

export const INBOX_STATUS = Object.freeze({
  NEW: 'new',
  READ: 'read',
  DONE: 'done',
  DISMISSED: 'dismissed',
});

export const RUN_HISTORY_MAX = HISTORY_MAX;

function startOfLocalDay(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Small non-cryptographic digest — this only powers repeat detection. */
export function contentDigest(text) {
  let hash = 2166136261;

  for (const ch of String(text || '')) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function emitInboxChanged(items) {
  window.dispatchEvent(new CustomEvent('yanta-pulse-inbox-changed', {
    detail: { unread: items.filter(isUnread).length },
  }));
}

function isUnread(item) {
  return item.status === INBOX_STATUS.NEW;
}

// ---------------- migration ---------------------------------------

/**
 * Moves the previous device-local records into the shared document.
 * One-way and idempotent: the legacy keys are read, merged in, and the
 * device marked done. Items already in the document win.
 */
async function migrateLegacy() {
  if (await store.settings.get(MIGRATED_KEY, false).catch(() => false)) return;

  const { inbox, runs } = await pulseMaps();

  const legacyInbox = await store.settings.get(LEGACY_INBOX_KEY, null).catch(() => null);
  const legacyState = await store.settings.get(LEGACY_STATE_KEY, null).catch(() => null);

  if (Array.isArray(legacyInbox)) {
    for (const item of legacyInbox) {
      if (item?.id && !inbox.has(item.id)) inbox.set(item.id, item);
    }
  }

  if (legacyState?.routines && typeof legacyState.routines === 'object') {
    for (const [name, entry] of Object.entries(legacyState.routines)) {
      if (!runs.has(name)) runs.set(name, { ...entry, name });
    }
  }

  await store.settings.set(MIGRATED_KEY, true);
}

let ready = null;

async function maps() {
  if (!ready) ready = migrateLegacy().catch(() => {});
  await ready;

  return pulseMaps();
}

// ---------------- run state ---------------------------------------

export async function getRoutineState(name, now = Date.now()) {
  const { runs } = await maps();

  const entry = runs.get(name) || {};
  const dayStart = startOfLocalDay(now);

  return {
    lastRunAt: 0,
    lastDueAt: 0,
    lastDigest: '',
    lastError: '',
    ...entry,

    // Derived, never stored: a counter written on another device in
    // another timezone would be meaningless here.
    runsToday: countRunsSince(entry, dayStart),
  };
}

function countRunsSince(entry, since) {
  const stamps = Array.isArray(entry?.recentRuns) ? entry.recentRuns : [];
  return stamps.filter((at) => at >= since).length;
}

/** Total counted runs across all routines inside the current local day. */
export async function countRunsToday(now = Date.now()) {
  const { runs } = await maps();
  const dayStart = startOfLocalDay(now);

  let total = 0;

  for (const entry of runs.values()) {
    total += countRunsSince(entry, dayStart);
  }

  return total;
}

export async function recordRun(name, patch = {}, now = Date.now()) {
  const { runs } = await maps();

  const previous = runs.get(name) || {};
  const counted = patch.counted !== false;

  // Keep only the stamps that can still matter to a daily cap.
  const recentRuns = [
    ...(Array.isArray(previous.recentRuns) ? previous.recentRuns : []),
    ...(counted ? [now] : []),
  ].filter((at) => now - at < 48 * 60 * 60 * 1000).slice(-48);

  runs.set(name, {
    name,
    lastRunAt: now,
    lastDueAt: patch.dueAt || now,
    lastDigest: patch.digest ?? previous.lastDigest ?? '',
    lastError: patch.error || '',
    recentRuns,
  });

  await touchPulseNote();
}

// ---------------- history -----------------------------------------

/**
 * Appends what a run actually did. This is the record the overview
 * shows, so it stores the tools that were called, not just the outcome —
 * "it ran" is not an answer to "what did it do".
 */
export async function recordHistory({
  routineName = '',
  outcome = '',
  title = '',
  delivered = [],
  tools = [],
  error = '',
  manual = false,
} = {}) {
  const { history } = await maps();

  history.push([{
    id: uid(),
    at: Date.now(),
    routineName,
    outcome,
    title,
    delivered,
    tools: tools.slice(0, 12),
    error,
    manual,
  }]);

  const overflow = history.length - HISTORY_MAX;
  if (overflow > 0) history.delete(0, overflow);

  await touchPulseNote();

  window.dispatchEvent(new CustomEvent('yanta-pulse-history-changed'));
}

/** Newest first. */
export async function listRunHistory({ limit = HISTORY_MAX, routineName = '' } = {}) {
  const { history } = await maps();

  const all = history.toArray().filter((entry) =>
    !routineName || entry.routineName === routineName
  );

  return all.reverse().slice(0, Math.max(1, limit));
}

export async function clearRunHistory() {
  const { history } = await maps();

  if (history.length) history.delete(0, history.length);

  await touchPulseNote();

  window.dispatchEvent(new CustomEvent('yanta-pulse-history-changed'));
}

// ---------------- inbox -------------------------------------------

function sortedInbox(inbox) {
  return [...inbox.values()]
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function listInboxItems({ includeArchived = false } = {}) {
  const { inbox } = await maps();

  const items = sortedInbox(inbox);

  return includeArchived
    ? items
    : items.filter((item) => item.status !== INBOX_STATUS.DISMISSED);
}

export async function countUnreadInbox() {
  const { inbox } = await maps();
  return sortedInbox(inbox).filter(isUnread).length;
}

/**
 * Adds one card. `proposals` are deferred tool calls the user can run
 * with a tap — the routine never executed them itself.
 */
export async function addInboxItem({
  routineName = '',
  routineTitle = '',
  title = '',
  body = '',
  proposals = [],
} = {}) {
  const { inbox } = await maps();

  const item = {
    id: uid(),
    routineName,
    routineTitle,
    createdAt: Date.now(),
    title: String(title || '').trim(),
    body: String(body || '').trim(),
    status: INBOX_STATUS.NEW,
    feedback: null,
    proposals: proposals.map((proposal) => ({
      id: uid(),
      label: String(proposal.label || 'Run').trim(),
      tool: String(proposal.tool || ''),
      args: proposal.args && typeof proposal.args === 'object' ? proposal.args : {},
      status: 'pending',
      error: '',
    })),
  };

  inbox.set(item.id, item);

  // Trim oldest beyond the cap so the document cannot grow without end.
  const items = sortedInbox(inbox);
  for (const stale of items.slice(INBOX_MAX)) inbox.delete(stale.id);

  await touchPulseNote();
  emitInboxChanged(sortedInbox(inbox));

  return item;
}

export async function updateInboxItem(id, patch = {}) {
  const { inbox } = await maps();

  const item = inbox.get(id);
  if (!item) return null;

  const next = { ...item, ...patch };
  inbox.set(id, next);

  await touchPulseNote();
  emitInboxChanged(sortedInbox(inbox));

  return next;
}

export async function updateInboxProposal(itemId, proposalId, patch = {}) {
  const { inbox } = await maps();

  const item = inbox.get(itemId);
  if (!item) return null;

  const next = {
    ...item,
    proposals: (item.proposals || []).map((proposal) =>
      proposal.id === proposalId ? { ...proposal, ...patch } : proposal
    ),
  };

  inbox.set(itemId, next);

  await touchPulseNote();
  emitInboxChanged(sortedInbox(inbox));

  return next;
}

export async function markInboxRead() {
  const { inbox } = await maps();

  const unread = sortedInbox(inbox).filter(isUnread);

  if (!unread.length) return [];

  for (const item of unread) {
    inbox.set(item.id, { ...item, status: INBOX_STATUS.READ });
  }

  await touchPulseNote();
  emitInboxChanged(sortedInbox(inbox));

  return sortedInbox(inbox);
}

export async function dismissInboxItem(id) {
  return updateInboxItem(id, { status: INBOX_STATUS.DISMISSED });
}

export async function clearInbox() {
  const { inbox } = await maps();

  for (const key of [...inbox.keys()]) inbox.delete(key);

  await touchPulseNote();
  emitInboxChanged([]);
}

/** Items produced by one routine — powers "3 cards came from this routine". */
export async function inboxCountByRoutine() {
  const items = await listInboxItems();
  const counts = new Map();

  for (const item of items) {
    if (!item.routineName) continue;
    counts.set(item.routineName, (counts.get(item.routineName) || 0) + 1);
  }

  return counts;
}

/**
 * Re-emits the unread count whenever the shared document changes, so a
 * card delivered on another device lights the badge here too.
 */
export async function watchPulseDocForInbox() {
  return observePulseDoc(async () => {
    emitInboxChanged(await listInboxItems({ includeArchived: true }));
  });
}

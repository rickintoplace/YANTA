// ============================================================
// YANTA Pulse — run state and Inbox persistence
//
// Two records in the settings store: per-routine run bookkeeping
// (last run, daily counters, last content digest) and the Inbox list.
// Both stay device-local on purpose — a run that already happened on
// the laptop should not re-announce itself on the phone.
// ============================================================

import { store, uid } from '../core.js';

const STATE_KEY = 'yanta.pulse.state.v1';
const INBOX_KEY = 'yanta.pulse.inbox.v1';

const INBOX_MAX = 60;

export const INBOX_STATUS = Object.freeze({
  NEW: 'new',
  READ: 'read',
  DONE: 'done',
  DISMISSED: 'dismissed',
});

let stateCache = null;
let inboxCache = null;

function today(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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

// ---------------- run state ---------------------------------------

async function loadState() {
  if (stateCache) return stateCache;

  const raw = await store.settings.get(STATE_KEY, null).catch(() => null);

  stateCache = {
    day: today(),
    runsToday: 0,
    routines: {},
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  return stateCache;
}

async function saveState(next) {
  stateCache = next;
  await store.settings.set(STATE_KEY, next);
}

/** Rolls daily counters over when the calendar day changed. */
export async function getPulseState(now = Date.now()) {
  const state = await loadState();
  const day = today(now);

  if (state.day === day) return state;

  const rolled = {
    ...state,
    day,
    runsToday: 0,
    routines: Object.fromEntries(
      Object.entries(state.routines).map(([name, entry]) => [
        name,
        { ...entry, runsToday: 0 },
      ])
    ),
  };

  await saveState(rolled);

  return rolled;
}

export async function getRoutineState(name, now = Date.now()) {
  const state = await getPulseState(now);

  return {
    lastRunAt: 0,
    lastDueAt: 0,
    runsToday: 0,
    lastDigest: '',
    lastError: '',
    ...(state.routines[name] || {}),
  };
}

export async function recordRun(name, patch = {}, now = Date.now()) {
  const state = await getPulseState(now);
  const previous = state.routines[name] || {};

  const next = {
    ...state,
    runsToday: (state.runsToday || 0) + (patch.counted === false ? 0 : 1),
    routines: {
      ...state.routines,
      [name]: {
        lastRunAt: now,
        lastDueAt: patch.dueAt || now,
        runsToday: (previous.runsToday || 0) + (patch.counted === false ? 0 : 1),
        lastDigest: patch.digest ?? previous.lastDigest ?? '',
        lastError: patch.error || '',
      },
    },
  };

  await saveState(next);

  return next;
}

// ---------------- inbox -------------------------------------------

async function loadInbox() {
  if (inboxCache) return inboxCache;

  const raw = await store.settings.get(INBOX_KEY, null).catch(() => null);

  inboxCache = Array.isArray(raw) ? raw : [];

  return inboxCache;
}

async function saveInbox(items) {
  inboxCache = items.slice(0, INBOX_MAX);

  await store.settings.set(INBOX_KEY, inboxCache);

  window.dispatchEvent(new CustomEvent('yanta-pulse-inbox-changed', {
    detail: { unread: inboxCache.filter(isUnread).length },
  }));

  return inboxCache;
}

function isUnread(item) {
  return item.status === INBOX_STATUS.NEW;
}

export async function listInboxItems({ includeArchived = false } = {}) {
  const items = await loadInbox();

  return includeArchived
    ? [...items]
    : items.filter((item) => item.status !== INBOX_STATUS.DISMISSED);
}

export async function countUnreadInbox() {
  return (await loadInbox()).filter(isUnread).length;
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
  const items = await loadInbox();

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

  await saveInbox([item, ...items]);

  return item;
}

export async function updateInboxItem(id, patch = {}) {
  const items = await loadInbox();
  const index = items.findIndex((item) => item.id === id);

  if (index < 0) return null;

  const next = [...items];
  next[index] = { ...next[index], ...patch };

  await saveInbox(next);

  return next[index];
}

export async function updateInboxProposal(itemId, proposalId, patch = {}) {
  const items = await loadInbox();
  const index = items.findIndex((item) => item.id === itemId);

  if (index < 0) return null;

  const item = items[index];

  const proposals = item.proposals.map((proposal) =>
    proposal.id === proposalId ? { ...proposal, ...patch } : proposal
  );

  const next = [...items];
  next[index] = { ...item, proposals };

  await saveInbox(next);

  return next[index];
}

export async function markInboxRead() {
  const items = await loadInbox();

  if (!items.some(isUnread)) return items;

  return saveInbox(items.map((item) =>
    isUnread(item) ? { ...item, status: INBOX_STATUS.READ } : item
  ));
}

export async function dismissInboxItem(id) {
  return updateInboxItem(id, { status: INBOX_STATUS.DISMISSED });
}

export async function clearInbox() {
  return saveInbox([]);
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

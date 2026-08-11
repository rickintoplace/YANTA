// ============================================================
// YANTA Dashboard — the single ask slot
//
// Everything on the dashboard that asks the user for something —
// finish setting up, turn on sync, install the app — competes for one
// slot, and only the winner is rendered.
//
// Why an arbiter instead of per-module gates: every nudge used to
// decide for itself whether it applied, and several of them applied at
// the same time by construction. The first-steps checklist and the sync
// nudge share a condition (workspace has content, storage choice open),
// so a newcomer reliably got two cards saying the same thing above a
// dashboard that was already busy — plus a third one from the reminder
// toast that knew about neither.
//
// Registration order does not matter, `order` does: the lowest order
// whose build() yields a node wins and the rest stay silent this render.
//
// One more rule that makes the slot feel calm rather than whack-a-mole:
// dismissing any nudge quiets the whole slot for a while, not just the
// card that was dismissed. "Not now" is an answer about the moment, not
// about one message.
// ============================================================

const NUDGE_SNOOZE_KEY = 'yanta.dashboardNudges.snoozedUntil.v1';

// Matches the sync reminder's own cooldown, so the two never disagree
// about how long "not now" lasts.
const DEFAULT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

const nudges = new Map();

/*
  Which nudge currently owns the slot, as of the last dashboard render.

  Read synchronously by surfaces that must not talk over an open ask but
  cannot await — the info panel's collector and the sync reminder's
  should-show check. Stale only in the window before the first dashboard
  render, where `null` (say nothing is pending) is the safe answer.
*/
let activeId = null;

/**
 * Register a candidate for the ask slot.
 *
 * `build(actions)` returns the card element, or null to pass — that is
 * the whole eligibility contract, so a nudge cannot report "I apply"
 * and then render nothing.
 */
export function registerDashboardNudge({ id, order = 100, build } = {}) {
  if (!id || typeof build !== 'function') return;

  nudges.set(id, { id, order, build });
}

/** The nudge occupying the slot, or null. Synchronous, cached. */
export function pendingNudgeId() {
  return activeId;
}

function setActive(id) {
  if (activeId === id) return;

  activeId = id;

  window.dispatchEvent(new CustomEvent('yanta-dashboard-nudge-changed', {
    detail: { id },
  }));
}

function snoozedUntil() {
  try {
    return Number(localStorage.getItem(NUDGE_SNOOZE_KEY) || 0);
  } catch {
    return 0;
  }
}

/** Quiet the whole slot until `ms` from now. */
export function snoozeDashboardNudges(ms = DEFAULT_SNOOZE_MS) {
  try {
    localStorage.setItem(NUDGE_SNOOZE_KEY, String(Date.now() + ms));
  } catch {}
}

/**
 * What a nudge's dismiss button should call: drop the card, and buy
 * quiet for the slot so the next-priority nudge does not pop straight
 * into the space that was just cleared.
 */
export function dismissDashboardNudge(node, { snoozeMs = DEFAULT_SNOOZE_MS } = {}) {
  node?.remove();
  snoozeDashboardNudges(snoozeMs);
  setActive(null);
}

/**
 * Render the single highest-priority applicable nudge into `host`.
 * Safe to call on every dashboard render; a no-op when nothing applies.
 *
 * `actions` is handed to each build() so cards can trigger flows they
 * must not import themselves (the storage chooser lives downstream of
 * first-contact.js and would close the import cycle).
 */
export async function renderTopNudgeInto(host, actions = {}) {
  if (!host) return;

  if (snoozedUntil() > Date.now()) {
    setActive(null);
    return;
  }

  const ordered = [...nudges.values()].sort((a, b) => a.order - b.order);

  for (const def of ordered) {
    let node = null;

    try {
      node = await def.build(actions);
    } catch (err) {
      console.warn('[YANTA Nudges] build failed:', def.id, err);
    }

    if (!node) continue;

    // The dashboard may have re-rendered while we were awaiting; the host
    // we were handed is detached and appending to it would be invisible.
    if (host.isConnected === false) return;

    host.append(node);
    setActive(def.id);

    return;
  }

  setActive(null);
}

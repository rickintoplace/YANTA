// ============================================================
// YANTA Pulse — prefetch before a run
//
// A routine reads the vault, and the vault is only as fresh as the last
// sync into it. For Sources/RSS that used to mean: nothing. Feeds are
// pulled once at startup and then never again, so a 07:00 morning brief
// on a laptop that has been open since yesterday summarised yesterday's
// articles and called them "what arrived overnight".
//
// So: pull the feeds a routine is about to read, before the sensors look
// and before the model does. Refresh is throttled by the user's own
// `minRefreshIntervalMinutes`, so a run right after a manual refresh
// costs nothing, and every failure here is non-fatal — a run on slightly
// stale data still beats no run at all.
// ============================================================

import { PULSE_EVENTS } from './pulse-config.js';

/** Tools whose answers come out of the Sources/RSS cache. */
const RSS_TOOL_RE = /\brss_(search_items|read_item|save_item_as_note|mark_item_read)\b/;

const PREFETCH_TIMEOUT_MS = 45_000;

/**
 * Whether this routine reads Sources at all.
 *
 * Two signals, because a routine can reach the feeds either way: it
 * subscribes to the `rss-new` sensor, or its procedure names one of the
 * RSS tools. The markdown check is deliberately loose — a false positive
 * costs one throttled refresh, a false negative costs a stale brief.
 */
export function routineReadsRss(routine = {}) {
  if (routine.events?.includes?.(PULSE_EVENTS.RSS_NEW)) return true;

  return RSS_TOOL_RE.test(String(routine.markdown || ''));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => window.setTimeout(() => resolve('timeout'), ms)),
  ]);
}

async function refreshRssSources() {
  const { getRssSettings } = await import('../rss/rss-settings.js');
  const settings = await getRssSettings();

  if (!settings.enabled) return { skipped: 'disabled' };

  // The cloud fetcher needs a signed-in account. Asking for one here
  // would pop a modal at 07:00 with nobody watching, so an unauthenticated
  // device simply runs on what it already has.
  if (settings.fetchProvider === 'yanta-cloud') {
    const { getRssCloudAuthState } = await import('../rss/rss-cloud-auth.js');
    const auth = await getRssCloudAuthState();

    if (!auth.authenticated) return { skipped: 'signed-out' };
  }

  const { refreshAllRssFeeds } = await import('../rss/rss-actions.js');

  const result = await withTimeout(
    refreshAllRssFeeds({ force: false }),
    PREFETCH_TIMEOUT_MS
  );

  if (result === 'timeout') return { skipped: 'timeout' };

  // Articles read on another device must not come back as new here.
  try {
    const { applyRssItemStateFromVault } = await import('../rss/rss-item-sync.js');
    await applyRssItemStateFromVault();
  } catch {}

  const fetched = Array.isArray(result)
    ? result.filter((entry) => !entry?.error && !entry?.skipped).length
    : 0;

  return { feeds: Array.isArray(result) ? result.length : 0, fetched };
}

/**
 * Pulls whatever this routine is about to read.
 *
 * Never throws: the caller runs the routine either way.
 *
 * @returns {Promise<object>} what was refreshed, for the run log
 */
export async function prefetchForRoutine(routine) {
  if (!routineReadsRss(routine)) return {};

  try {
    return { rss: await refreshRssSources() };
  } catch (err) {
    console.warn('[YANTA Pulse] source prefetch failed', routine?.name, err);
    return { rss: { error: err?.message || String(err) } };
  }
}

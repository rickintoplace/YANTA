// ============================================================
// YANTA Sync2 — Bounded parallel downloads
//
// Why this exists:
// Sync is latency-bound, not bandwidth-bound. A fresh device pulls ~1000
// small encrypted objects; fetched strictly one after another at ~150ms
// round-trip that is minutes of an almost idle connection.
//
// Two invariants this module exists to keep:
//
//  1. Downloads run in parallel, but results are CONSUMED IN ORDER.
//     Vault updates are last-write-wins, so apply order is load-bearing.
//     Only the network/decrypt part is parallel — every caller still
//     applies into the Yjs docs sequentially, exactly as before.
//
//  2. At most `limit` payloads are in flight or buffered at any moment.
//     A vault with thousands of objects must never balloon the renderer
//     heap — an out-of-memory renderer crash corrupts IndexedDB, and
//     Chromium then deletes the whole origin database.
//
// Nesting rule:
// The per-note outer loops pass NO limiter, only a window. Just the leaf
// object fetches acquire `runSyncDownload`. If an outer task held a slot
// while waiting for inner tasks that need slots, the pool would deadlock.
// ============================================================

/*
  Leaf object fetches in flight across the whole app (app engine plus any
  space engines). 8 keeps a single HTTP/2 connection busy without making
  the request queue unfair to interactive traffic.
*/
export const SYNC2_DOWNLOAD_CONCURRENCY = 8;

/*
  Notes processed concurrently in the per-note loops.

  This is a feeder, not a limit. Most notes contribute only one or two
  objects per phase (one head and one snapshot per device), so a window
  at or below the leaf limit would starve it: the loop would wait on four
  notes while five download slots sat idle. Deliberately above
  SYNC2_DOWNLOAD_CONCURRENCY so the shared limiter stays the only cap
  that binds — including when many notes turn out to have nothing to
  fetch and complete without touching the network.
*/
export const SYNC2_NOTE_CONCURRENCY = 12;

/*
  Assets are the only payloads that are big (images). A smaller window
  keeps peak memory bounded while still cutting the round-trip count.
*/
export const SYNC2_ASSET_CONCURRENCY = 4;

export function createLimiter(limit) {
  const max = Math.max(1, Number(limit) || 1);

  let active = 0;
  const queue = [];

  const pump = () => {
    if (active >= max || !queue.length) return;

    const job = queue.shift();
    active++;

    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        pump();
      });
  };

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  };
}

/*
  Shared across every sync engine so that a background space sync cannot
  multiply the request count against the same origin.
*/
export const runSyncDownload = createLimiter(SYNC2_DOWNLOAD_CONCURRENCY);

/*
  Ordered sliding-window map.

  Yields { item, index, value } in the original order of `items` while
  keeping up to `limit` tasks running ahead of the consumer.

  Errors surface at the position where they happened, so a failing object
  aborts the loop at exactly the point the old sequential code would have.
*/
export async function* mapOrdered(items, mapFn, {
  limit = SYNC2_DOWNLOAD_CONCURRENCY,
  run = null,
} = {}) {
  const list = Array.isArray(items) ? items : [...items];
  const window = Math.max(1, Number(limit) || 1);

  const pending = new Map();

  let started = 0;
  let emitted = 0;

  /*
    Settled results are stored as { ok, value|error } so a task that
    rejects while the consumer is still awaiting an earlier index can
    never surface as an unhandled rejection.
  */
  const start = (index) => {
    pending.set(index, (async () => {
      try {
        const value = run
          ? await run(() => mapFn(list[index], index))
          : await mapFn(list[index], index);

        return { ok: true, value };
      } catch (error) {
        return { ok: false, error };
      }
    })());
  };

  while (emitted < list.length) {
    while (started < list.length && pending.size < window) {
      start(started++);
    }

    const settled = await pending.get(emitted);
    pending.delete(emitted);

    if (!settled.ok) throw settled.error;

    yield {
      item: list[emitted],
      index: emitted,
      value: settled.value,
    };

    emitted++;
  }
}

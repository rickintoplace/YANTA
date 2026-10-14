// ============================================================
// YANTA Present — protocol (pure, no DOM, no network)
//
// One device presents ("host"): it has the drawing and decides what is on
// screen. Any number of devices join as a screen (shows the slides) or a
// remote (controls them). The protocol is state-based, not a stream of
// "next" events: the host keeps one position and a revision number and
// sends the whole position whenever it changes, and again whenever a device
// says hello. A device that drops off the network and comes back is
// therefore on the right slide with its first message — nothing to replay,
// nothing to miss.
//
// Commands from remotes carry an id. The host applies each id once and
// names the last one in its state, so a remote can resend a press the
// network swallowed without it ever counting twice.
// ============================================================

export const PROTOCOL_VERSION = 1;

/** A device counts as gone after this long without a word. */
export const PEER_TIMEOUT_MS = 30_000;
export const HELLO_EVERY_MS = 10_000;

/** A press older than this is dropped instead of replayed after a reconnect. */
export const COMMAND_STALE_MS = 6_000;

// ---- Positions

/** Clicks each slide takes (its build steps), the shape every function below reads. */
export function clampPosition(counts, pos = {}) {
  const last = Math.max(0, counts.length - 1);
  const index = Math.max(0, Math.min(last, Math.round(Number(pos.index) || 0)));
  const max = counts[index] || 0;
  const step = Math.max(0, Math.min(max, Math.round(Number(pos.step) || 0)));

  return { index, step };
}

export function nextPosition(counts, pos) {
  const { index, step } = clampPosition(counts, pos);

  if (step < (counts[index] || 0)) return { index, step: step + 1 };
  if (index < counts.length - 1) return { index: index + 1, step: 0 };

  return null;
}

export function previousPosition(counts, pos) {
  const { index, step } = clampPosition(counts, pos);

  if (step > 0) return { index, step: step - 1 };
  if (index > 0) return { index: index - 1, step: counts[index - 1] || 0 };

  return null;
}

/**
 * How a screen gets from one position to the next, so it plays what the
 * presenter's screen played: one build step forwards or backwards on the
 * same slide animates; anything else is a move to another slide.
 */
export function motionBetween(from, to) {
  if (!from || !to) return 'jump';

  if (from.index === to.index) {
    if (to.step === from.step + 1) return 'reveal';
    if (to.step === from.step - 1) return 'unreveal';
    if (to.step === from.step) return 'none';
  }

  return 'jump';
}

/** Overall progress 0..1, counting build steps, for progress bars. */
export function progressOf(counts, pos) {
  const total = counts.reduce((sum, c) => sum + c + 1, 0);
  if (total <= 1) return 1;

  const { index, step } = clampPosition(counts, pos);
  const done = counts.slice(0, index).reduce((sum, c) => sum + c + 1, 0) + step;

  return done / (total - 1);
}

// ---- Commands

/** Remembers which command ids the host already applied (bounded). */
export function createCommandLog(limit = 256) {
  const seen = new Set();
  const order = [];

  return {
    /** True the first time an id is seen. */
    accept(id) {
      if (!id || seen.has(id)) return false;

      seen.add(id);
      order.push(id);

      while (order.length > limit) seen.delete(order.shift());

      return true;
    },
  };
}

/**
 * The remote side: presses wait here until the host's state names them.
 * Resent on reconnect; dropped once stale, because a "next" that arrives
 * half a minute late is worse than one that never arrives.
 */
export function createCommandQueue({ now = () => Date.now(), staleMs = COMMAND_STALE_MS } = {}) {
  let pending = [];

  return {
    push(command) {
      pending.push({ ...command, at: command.at || now() });
    },

    /** The host confirmed everything up to and including this id. */
    acknowledge(id) {
      if (!id) return;

      const i = pending.findIndex((c) => c.id === id);
      if (i >= 0) pending = pending.slice(i + 1);
    },

    /** Commands still worth sending, oldest first. */
    due() {
      const limit = now() - staleMs;
      pending = pending.filter((c) => c.at >= limit);
      return pending.slice();
    },

    get size() {
      return pending.length;
    },
  };
}

// ---- Peers

export function createPeerTable({ now = () => Date.now(), timeoutMs = PEER_TIMEOUT_MS } = {}) {
  const peers = new Map();

  return {
    seen(id, info = {}) {
      if (!id) return null;

      const prev = peers.get(id);
      const next = { ...prev, ...info, id, lastSeen: now() };
      peers.set(id, next);

      return prev ? null : next;
    },

    remove(id) {
      peers.delete(id);
    },

    /** Drops devices not heard from in time; returns the ones dropped. */
    prune() {
      const limit = now() - timeoutMs;
      const gone = [];

      for (const [id, peer] of peers) {
        if (peer.lastSeen < limit) {
          peers.delete(id);
          gone.push(peer);
        }
      }

      return gone;
    },

    list() {
      return [...peers.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    },

    get(id) {
      return peers.get(id) || null;
    },
  };
}

// ---- Chunks: the relay takes at most 512 KB per message

export const CHUNK_CHARS = 240_000;

export function splitIntoChunks(text, size = CHUNK_CHARS) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts.length ? parts : [''];
}

export function createReassembler({ now = () => Date.now(), maxAgeMs = 60_000 } = {}) {
  const partial = new Map();

  return {
    /** Returns the whole text once every part of message `mid` arrived. */
    add({ mid, i, n, part }) {
      if (!mid || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n) return null;

      const limit = now() - maxAgeMs;
      for (const [key, entry] of partial) {
        if (entry.at < limit) partial.delete(key);
      }

      const entry = partial.get(mid) || { parts: new Array(n), got: 0, at: now() };

      if (entry.parts.length !== n) return null;

      if (entry.parts[i] === undefined) {
        entry.parts[i] = String(part || '');
        entry.got += 1;
      }

      if (entry.got < n) {
        partial.set(mid, entry);
        return null;
      }

      partial.delete(mid);
      return entry.parts.join('');
    },
  };
}

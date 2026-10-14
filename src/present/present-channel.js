// ============================================================
// YANTA Present — relay channel
//
// One WebSocket to the YANTA relay (signaling.js) that does not give up:
//
// - reconnects with backoff, and at once when the network comes back or
//   the page becomes visible again (a phone screen that was off);
// - notices a dead socket that never closed (mobile NAT, captive Wi-Fi):
//   the relay answers every ping, so silence for 25 s means the line is
//   gone and is replaced;
// - re-subscribes every topic after each reconnect.
//
// Secure topics on top of it seal every message with AES-GCM and split
// large ones into chunks (the relay takes at most 512 KB per message).
// Nothing is queued here: the presentation protocol is state-based and
// resends what matters itself (see present-protocol.js).
// ============================================================

import { SIGNALING_URL } from '../signaling.js';
import { openJson, randomId, sealJson } from './present-crypto.js';
import { CHUNK_CHARS, PROTOCOL_VERSION, createReassembler, splitIntoChunks } from './present-protocol.js';

const PING = '{"type":"ping"}';

/** Mutable for tests only; nothing in the app changes these. */
export const channelTimings = {
  pingEveryMs: 8_000,
  silenceLimitMs: 25_000,
  maxBackoffMs: 8_000,
};

export function createRelayChannel({
  url = SIGNALING_URL,
  onStatus = null,
} = {}) {
  const handlers = new Map(); // topic -> Set<fn(data)>
  const statusListeners = new Set(onStatus ? [onStatus] : []);

  let ws = null;
  let status = 'connecting';
  let attempt = 0;
  let retryTimer = 0;
  let pingTimer = 0;
  let lastHeard = 0;
  let closed = false;

  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    statusListeners.forEach((fn) => {
      try {
        fn(next);
      } catch {}
    });
  };

  const stopPing = () => {
    clearInterval(pingTimer);
    pingTimer = 0;
  };

  const startPing = () => {
    stopPing();

    pingTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      if (Date.now() - lastHeard > channelTimings.silenceLimitMs) {
        reconnectNow();
        return;
      }

      try {
        ws.send(PING);
      } catch {}
    }, channelTimings.pingEveryMs);
  };

  const scheduleReconnect = () => {
    if (closed) return;

    setStatus('reconnecting');

    const delay = Math.min(channelTimings.maxBackoffMs, 400 * 2 ** attempt) * (0.8 + Math.random() * 0.4);
    attempt += 1;

    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delay);
  };

  function connect() {
    if (closed) return;

    clearTimeout(retryTimer);

    let socket;

    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws = socket;

    socket.addEventListener('open', () => {
      if (socket !== ws) return;

      attempt = 0;
      lastHeard = Date.now();

      const topics = [...handlers.keys()];
      if (topics.length) socket.send(JSON.stringify({ type: 'subscribe', topics }));

      setStatus('online');
      startPing();
    });

    socket.addEventListener('message', (event) => {
      if (socket !== ws) return;

      lastHeard = Date.now();

      let msg = null;

      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg?.type !== 'publish') return;

      const set = handlers.get(msg.topic);
      if (!set) return;

      for (const fn of set) {
        try {
          fn(msg.data);
        } catch (err) {
          console.warn('[YANTA Present] message handler failed', err);
        }
      }
    });

    socket.addEventListener('close', () => {
      if (socket !== ws) return;

      ws = null;
      stopPing();
      scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      try {
        socket.close();
      } catch {}
    });
  }

  function reconnectNow() {
    if (closed) return;

    const old = ws;
    ws = null;
    stopPing();

    try {
      old?.close();
    } catch {}

    attempt = 0;
    setStatus('reconnecting');
    connect();
  }

  const onOnline = () => {
    if (status !== 'online') reconnectNow();
  };

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (status !== 'online' || Date.now() - lastHeard > channelTimings.pingEveryMs * 1.5) reconnectNow();
  };

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  connect();

  return {
    get status() {
      return status;
    },

    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },

    /** Listens on a topic; returns the function that stops it. */
    listen(topic, fn) {
      let set = handlers.get(topic);

      if (!set) {
        set = new Set();
        handlers.set(topic, set);

        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribe', topics: [topic] }));
        }
      }

      set.add(fn);

      return () => {
        set.delete(fn);
        if (set.size) return;

        handlers.delete(topic);

        if (ws?.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'unsubscribe', topics: [topic] }));
          } catch {}
        }
      };
    },

    /** False when the line is down right now (the caller decides about retrying). */
    publish(topic, data) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;

      try {
        ws.send(JSON.stringify({ type: 'publish', topic, data }));
        return true;
      } catch {
        return false;
      }
    },

    reconnectNow,

    close() {
      closed = true;
      clearTimeout(retryTimer);
      stopPing();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);

      try {
        ws?.close();
      } catch {}

      ws = null;
      handlers.clear();
      setStatus('closed');
    },
  };
}

/**
 * A topic whose messages are sealed with one key. `onMessage(kind, body,
 * envelope)` sees only messages from other devices that are addressed to
 * everyone or to this device.
 */
export function openSecureTopic(channel, { topic, key, deviceId, onMessage }) {
  const reassembler = createReassembler();
  let seq = 0;

  const receive = async (sealed) => {
    let envelope = null;

    try {
      envelope = await openJson(key, sealed);
    } catch {
      return; // Not for us (another key on the same topic) or damaged.
    }

    if (!envelope || envelope.v !== PROTOCOL_VERSION) return;
    if (envelope.from === deviceId) return;
    if (envelope.to && envelope.to !== deviceId) return;

    onMessage?.(envelope.kind, envelope.body || {}, envelope);
  };

  const stop = channel.listen(topic, (data) => {
    if (typeof data?.s === 'string') {
      receive(data.s);
      return;
    }

    if (data?.m) {
      const whole = reassembler.add({ mid: data.m, i: data.i, n: data.n, part: data.p });
      if (whole) receive(whole);
    }
  });

  return {
    topic,

    /** Seals and sends; false when it could not go out right now. */
    async post(kind, body = {}, { to = null } = {}) {
      const sealed = await sealJson(key, {
        v: PROTOCOL_VERSION,
        from: deviceId,
        to,
        seq: ++seq,
        at: Date.now(),
        kind,
        body,
      });

      if (sealed.length <= CHUNK_CHARS) return channel.publish(topic, { s: sealed });

      const mid = randomId(12);
      const parts = splitIntoChunks(sealed);

      return parts.every((part, i) => channel.publish(topic, { m: mid, i, n: parts.length, p: part }));
    },

    close: stop,
  };
}

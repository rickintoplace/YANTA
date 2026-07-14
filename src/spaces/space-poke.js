// ============================================================
// YANTA Shared Spaces — poke channel
//
// Near-live change notifications over the existing signaling server
// (same subscribe/publish pub/sub protocol y-webrtc uses). Writers
// publish a poke after uploading an encrypted batch; subscribers
// then pull from the worker. Pokes carry no secrets — only "this
// space changed" — so a public relay is fine.
//
// One shared WebSocket serves all mounted spaces. Delivery is
// best-effort: engines keep a slow polling fallback regardless.
// ============================================================

import { DEFAULT_SIGNALING } from '../providers.js';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const PING_INTERVAL_MS = 25_000;

let socket = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer = null;
let pingTimer = null;

// topic -> Set<handler(data)>
const handlersByTopic = new Map();

function signalingUrl() {
  return DEFAULT_SIGNALING[0];
}

function socketOpen() {
  return socket && socket.readyState === WebSocket.OPEN;
}

function send(msg) {
  if (!socketOpen()) return false;
  try {
    socket.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

function ensureSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (!handlersByTopic.size) return;

  try {
    socket = new WebSocket(signalingUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectDelay = RECONNECT_MIN_MS;

    const topics = [...handlersByTopic.keys()];
    if (topics.length) {
      send({ type: 'subscribe', topics });
    }

    clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping' }), PING_INTERVAL_MS);
  };

  socket.onmessage = (event) => {
    let msg = null;

    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg?.type !== 'publish' || !msg.topic) return;

    const handlers = handlersByTopic.get(msg.topic);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(msg.data);
      } catch (err) {
        console.warn('[YANTA Spaces] poke handler failed', err);
      }
    }
  };

  socket.onclose = () => {
    clearInterval(pingTimer);
    pingTimer = null;
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    try {
      socket?.close();
    } catch {}
  };
}

function scheduleReconnect() {
  if (reconnectTimer || !handlersByTopic.size) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureSocket();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    reconnectDelay = RECONNECT_MIN_MS;
    ensureSocket();
  });
}

/**
 * Subscribe to pokes for a topic. Returns an unsubscribe function.
 */
export function subscribeSpacePoke(topic, handler) {
  if (!topic || typeof handler !== 'function') return () => {};

  let handlers = handlersByTopic.get(topic);

  if (!handlers) {
    handlers = new Set();
    handlersByTopic.set(topic, handlers);

    if (socketOpen()) {
      send({ type: 'subscribe', topics: [topic] });
    }
  }

  handlers.add(handler);
  ensureSocket();

  return () => {
    const set = handlersByTopic.get(topic);
    if (!set) return;

    set.delete(handler);

    if (!set.size) {
      handlersByTopic.delete(topic);

      if (socketOpen()) {
        send({ type: 'unsubscribe', topics: [topic] });
      }

      if (!handlersByTopic.size && socket) {
        try {
          socket.close();
        } catch {}
        socket = null;
      }
    }
  };
}

/**
 * Publish a poke (best-effort, silently dropped while offline).
 */
export function publishSpacePoke(topic, data = {}) {
  if (!topic) return;
  send({ type: 'publish', topic, data });
}

export function spacePokeConnected() {
  return socketOpen();
}

// ============================================================
// YANTA Cloud Worker — signaling relay (Durable Object)
//
// Topic pub/sub for every live feature: y-webrtc note sharing,
// shared-space and vault pokes, and presentation remote control.
// Wire protocol is unchanged from the previous Cloud Run relay
// (subscribe / unsubscribe / publish / ping), because y-webrtc
// speaks it and multiplexes many topics over one connection.
//
// Why a Durable Object: Cloud Run bills an open WebSocket as a
// running request, so idle clients kept an instance alive around
// the clock. Hibernatable sockets cost nothing while quiet — the
// runtime answers the clients' pings via setWebSocketAutoResponse
// without ever waking this object.
//
// One object serves all connections (a single client subscribes to
// topics from several features at once, so sharding by topic would
// need one socket per topic). Cloud Run ran the same way; the
// per-object ceiling is ~32k sockets.
// ============================================================

const MAX_PAYLOAD = 512 * 1024;
const MAX_CLIENTS = 4_000;
const MAX_TOPICS_PER_CONN = 32;
const MAX_TOPIC_LEN = 256;
const MAX_MSGS_PER_10S = 300;

// serializeAttachment() is capped at 2 KB; stay clear of the edge.
const ATTACHMENT_BUDGET = 1_600;

// Byte-exact strings: the auto-response only matches identical
// payloads. Every client sends JSON.stringify({ type: 'ping' }).
const PING = '{"type":"ping"}';
const PONG = '{"type":"pong"}';

export const RELAY_PATH = '/relay';
export const RELAY_STATS_PATH = '/relay/stats';

// Single named instance — see the header note on sharding.
const RELAY_INSTANCE = 'relay-v1';

function originList(env) {
  return String(env.RELAY_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/*
  Empty RELAY_ALLOWED_ORIGINS means "allow everyone", which is what
  the Cloud Run relay did. Topics are unguessable secrets, so an
  allowlist only stops other sites from using us as a free relay;
  it is not what protects the payloads. Requests without an Origin
  (native shells, CLI) always pass.
*/
function originAllowed(env, req) {
  const allowed = originList(env);
  if (!allowed.length) return true;

  const origin = (req.headers.get('origin') || '').replace(/\/+$/, '');
  if (!origin) return true;

  return allowed.some((entry) => {
    if (entry === origin) return true;

    const wildcard = entry.match(/^(https?:\/\/)\*\.(.+)$/);
    if (!wildcard) return false;

    return origin.startsWith(wildcard[1]) && origin.endsWith(`.${wildcard[2]}`);
  });
}

/**
 * Route hook for the Worker: handles the WebSocket upgrade and the
 * small public stats endpoint.
 */
export function handleRelayRequest(req, env, url) {
  if (!env.SIGNAL_RELAY) {
    return new Response('relay not configured\n', { status: 503 });
  }

  const stub = env.SIGNAL_RELAY.get(env.SIGNAL_RELAY.idFromName(RELAY_INSTANCE));

  if (url.pathname === RELAY_STATS_PATH) {
    return stub.fetch(req);
  }

  if ((req.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('expected websocket\n', { status: 426 });
  }

  if (!originAllowed(env, req)) {
    return new Response('origin not allowed\n', { status: 403 });
  }

  return stub.fetch(req);
}

function readTopics(ws) {
  try {
    const attachment = ws.deserializeAttachment();
    return Array.isArray(attachment?.t) ? attachment.t : [];
  } catch {
    return [];
  }
}

function writeTopics(ws, topics) {
  ws.serializeAttachment({ t: topics });
}

function validTopic(topic) {
  return typeof topic === 'string' &&
    topic.length > 0 &&
    topic.length <= MAX_TOPIC_LEN;
}

export class SignalRelay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    // topic -> Set<WebSocket>, rebuilt from the sockets' attachments
    // after a hibernation wake-up (see index()).
    this.topics = null;

    // Per-socket send budget. Lives in memory only: a hibernated
    // object was quiet by definition, so a reset costs nothing.
    this.rate = new WeakMap();

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(PING, PONG)
    );
  }

  index() {
    if (this.topics) return this.topics;

    const map = new Map();

    for (const ws of this.ctx.getWebSockets()) {
      for (const topic of readTopics(ws)) {
        let subs = map.get(topic);

        if (!subs) {
          subs = new Set();
          map.set(topic, subs);
        }

        subs.add(ws);
      }
    }

    this.topics = map;
    return map;
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === RELAY_STATS_PATH) {
      const sockets = this.ctx.getWebSockets();
      const map = this.index();

      let subscriptions = 0;
      for (const subs of map.values()) subscriptions += subs.size;

      return new Response(
        JSON.stringify({
          clients: sockets.length,
          topics: map.size,
          subscriptions,
        }) + '\n',
        { headers: { 'content-type': 'application/json; charset=utf-8' } }
      );
    }

    if (this.ctx.getWebSockets().length >= MAX_CLIENTS) {
      return new Response('relay overloaded\n', { status: 503 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    writeTopics(server, []);

    return new Response(null, { status: 101, webSocket: client });
  }

  rateOk(ws) {
    const now = Date.now();
    let r = this.rate.get(ws);

    if (!r || now - r.windowStart > 10_000) {
      r = { windowStart: now, count: 0 };
      this.rate.set(ws, r);
    }

    r.count++;

    return r.count <= MAX_MSGS_PER_10S;
  }

  subscribe(ws, list) {
    if (!Array.isArray(list)) return;

    const map = this.index();
    const topics = readTopics(ws);
    let changed = false;

    for (const topic of list) {
      if (!validTopic(topic) || topics.includes(topic)) continue;
      if (topics.length >= MAX_TOPICS_PER_CONN) break;

      const next = [...topics, topic];
      if (JSON.stringify({ t: next }).length > ATTACHMENT_BUDGET) break;

      topics.push(topic);
      changed = true;

      let subs = map.get(topic);

      if (!subs) {
        subs = new Set();
        map.set(topic, subs);
      }

      subs.add(ws);
    }

    if (changed) writeTopics(ws, topics);
  }

  unsubscribe(ws, list) {
    if (!Array.isArray(list)) return;

    const map = this.index();
    let topics = readTopics(ws);
    let changed = false;

    for (const topic of list) {
      if (!topics.includes(topic)) continue;

      topics = topics.filter((t) => t !== topic);
      changed = true;

      const subs = map.get(topic);

      if (subs) {
        subs.delete(ws);
        if (!subs.size) map.delete(topic);
      }
    }

    if (changed) writeTopics(ws, topics);
  }

  publish(ws, topic, data) {
    if (!validTopic(topic)) return;

    const subs = this.index().get(topic);
    if (!subs) return;

    const out = JSON.stringify({ type: 'publish', topic, data });

    for (const peer of subs) {
      if (peer === ws) continue;

      try {
        peer.send(out);
      } catch {
        this.drop(peer);
      }
    }
  }

  drop(ws) {
    const map = this.index();

    for (const topic of readTopics(ws)) {
      const subs = map.get(topic);
      if (!subs) continue;

      subs.delete(ws);
      if (!subs.size) map.delete(topic);
    }
  }

  webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    if (raw.length > MAX_PAYLOAD) return;

    if (!this.rateOk(ws)) {
      this.drop(ws);

      try {
        ws.close(1008, 'rate limit exceeded');
      } catch {}

      return;
    }

    let msg = null;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'subscribe') {
      this.subscribe(ws, msg.topics);
      return;
    }

    if (msg.type === 'unsubscribe') {
      this.unsubscribe(ws, msg.topics);
      return;
    }

    if (msg.type === 'publish') {
      this.publish(ws, msg.topic, msg.data);
      return;
    }

    // Pings normally never reach us — the auto-response answers them
    // while the object sleeps. This covers non-identical payloads.
    if (msg.type === 'ping') {
      try {
        ws.send(PONG);
      } catch {}
    }
  }

  webSocketClose(ws) {
    this.drop(ws);
  }

  webSocketError(ws) {
    this.drop(ws);
  }
}

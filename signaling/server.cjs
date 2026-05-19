'use strict';

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const MAX_PAYLOAD = parseInt(process.env.MAX_PAYLOAD || String(1024 * 1024), 10);
const MAX_CLIENTS = parseInt(process.env.MAX_CLIENTS || '1000', 10);
const MAX_TOPICS_PER_CONN = parseInt(process.env.MAX_TOPICS_PER_CONN || '64', 10);
const MAX_TOPIC_LEN = parseInt(process.env.MAX_TOPIC_LEN || '256', 10);
const MAX_MSGS_PER_10S = parseInt(process.env.MAX_MSGS_PER_10S || '300', 10);

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// topic/room -> Set<WebSocket>
const topics = new Map();

// WebSocket -> Set<topic>
const connTopics = new Map();

// WebSocket -> rate info
const rate = new WeakMap();

function getTopic(topic) {
  let conns = topics.get(topic);
  if (!conns) {
    conns = new Set();
    topics.set(topic, conns);
  }
  return conns;
}

function validTopic(topic) {
  return typeof topic === 'string' &&
    topic.length > 0 &&
    topic.length <= MAX_TOPIC_LEN;
}

function allowedOrigin(req) {
  if (!ALLOWED_ORIGINS.size) return true;
  const origin = req.headers.origin || '';
  return ALLOWED_ORIGINS.has(origin);
}

function rateOk(conn) {
  const now = Date.now();
  let r = rate.get(conn);

  if (!r || now - r.windowStart > 10000) {
    r = { windowStart: now, count: 0 };
    rate.set(conn, r);
  }

  r.count++;

  return r.count <= MAX_MSGS_PER_10S;
}

function subscribe(conn, topic) {
  if (!validTopic(topic)) return;

  let subs = connTopics.get(conn);
  if (!subs) {
    subs = new Set();
    connTopics.set(conn, subs);
  }

  if (!subs.has(topic) && subs.size >= MAX_TOPICS_PER_CONN) return;

  getTopic(topic).add(conn);
  subs.add(topic);
}

function unsubscribe(conn, topic) {
  if (!validTopic(topic)) return;

  const conns = topics.get(topic);
  if (conns) {
    conns.delete(conn);
    if (conns.size === 0) topics.delete(topic);
  }

  const subs = connTopics.get(conn);
  if (subs) {
    subs.delete(topic);
    if (subs.size === 0) connTopics.delete(conn);
  }
}

function cleanup(conn) {
  const subs = connTopics.get(conn);
  if (!subs) return;

  for (const topic of subs) {
    const conns = topics.get(topic);
    if (conns) {
      conns.delete(conn);
      if (conns.size === 0) topics.delete(topic);
    }
  }

  connTopics.delete(conn);
}

function send(conn, obj) {
  if (conn.readyState === WebSocket.OPEN) {
    try {
      conn.send(JSON.stringify(obj));
    } catch {}
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok\n');
    return;
  }

  if (req.url === '/metrics') {
    let subCount = 0;
    for (const s of topics.values()) subCount += s.size;

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      clients: wss.clients.size,
      topics: topics.size,
      subscriptions: subCount,
    }) + '\n');
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found\n');
});

const wss = new WebSocket.Server({
  server,
  maxPayload: MAX_PAYLOAD,
});

wss.on('connection', (conn, req) => {
  if (wss.clients.size > MAX_CLIENTS) {
    conn.close(1013, 'server overloaded');
    return;
  }

  if (!allowedOrigin(req)) {
    conn.close(1008, 'origin not allowed');
    return;
  }

  conn.isAlive = true;

  conn.on('pong', () => {
    conn.isAlive = true;
  });

  conn.on('message', raw => {
    if (!rateOk(conn)) {
      conn.close(1008, 'rate limit exceeded');
      return;
    }

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'subscribe') {
      if (Array.isArray(msg.topics)) {
        for (const topic of msg.topics) subscribe(conn, topic);
      }
      return;
    }

    if (msg.type === 'unsubscribe') {
      if (Array.isArray(msg.topics)) {
        for (const topic of msg.topics) unsubscribe(conn, topic);
      }
      return;
    }

    if (msg.type === 'publish') {
      const topic = msg.topic;
      if (!validTopic(topic)) return;

      const receivers = topics.get(topic);
      if (!receivers) return;

      const out = {
        type: 'publish',
        topic,
        data: msg.data,
      };

      for (const receiver of receivers) {
        if (receiver !== conn) send(receiver, out);
      }

      return;
    }

    if (msg.type === 'ping') {
      send(conn, { type: 'pong' });
    }
  });

  conn.on('close', () => cleanup(conn));
  conn.on('error', () => cleanup(conn));
});

setInterval(() => {
  for (const conn of wss.clients) {
    if (conn.isAlive === false) {
      cleanup(conn);
      conn.terminate();
      continue;
    }

    conn.isAlive = false;

    try {
      conn.ping();
    } catch {
      cleanup(conn);
      conn.terminate();
    }
  }
}, 30000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`YANTA signaling server listening on 0.0.0.0:${PORT}`);
});
'use strict';

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

// topic/room -> Set<WebSocket>
const topics = new Map();
// WebSocket -> Set<topic>
const connTopics = new Map();

function getTopic(topic) {
  let conns = topics.get(topic);
  if (!conns) {
    conns = new Set();
    topics.set(topic, conns);
  }
  return conns;
}

function subscribe(conn, topic) {
  if (typeof topic !== 'string' || !topic) return;

  getTopic(topic).add(conn);

  let subs = connTopics.get(conn);
  if (!subs) {
    subs = new Set();
    connTopics.set(conn, subs);
  }
  subs.add(topic);
}

function unsubscribe(conn, topic) {
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
    conn.send(JSON.stringify(obj));
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok\n');
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found\n');
});

const wss = new WebSocket.Server({
  server,
  maxPayload: 1024 * 1024
});

wss.on('connection', (conn, req) => {
  conn.isAlive = true;
  conn.on('pong', () => {
    conn.isAlive = true;
  });

  conn.on('message', raw => {
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
      if (typeof topic !== 'string' || !topic) return;

      const receivers = topics.get(topic);
      if (!receivers) return;

      const out = {
        type: 'publish',
        topic,
        data: msg.data
      };

      for (const receiver of receivers) {
        // Nicht an den Sender zurückschicken.
        if (receiver !== conn) send(receiver, out);
      }

      return;
    }

    // y-webrtc benutzt ggf. ping-artige Nachrichten; harmlos ignorieren/antworten.
    if (msg.type === 'ping') {
      send(conn, { type: 'pong' });
    }
  });

  conn.on('close', () => cleanup(conn));
  conn.on('error', () => cleanup(conn));
});

// Verhindert tote WebSocket-Verbindungen.
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
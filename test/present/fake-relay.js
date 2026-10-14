// An in-memory stand-in for the YANTA relay (yanta-cloud-worker/src/signal-relay.js):
// subscribe / unsubscribe / publish to every other subscriber, ping → pong.
// Tests can cut a socket the hard way (no close event — a dead mobile
// connection) or drop every socket at once.

export function installFakeRelay() {
  const sockets = new Set();
  const topics = new Map(); // topic -> Set<socket>
  let delivered = 0;

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.listeners = { open: new Set(), message: new Set(), close: new Set(), error: new Set() };
      this.topics = new Set();
      this.deaf = false;
      sockets.add(this);

      setTimeout(() => {
        if (this.readyState !== FakeWebSocket.CONNECTING) return;
        if (relay.offline) {
          this.readyState = FakeWebSocket.CLOSED;
          sockets.delete(this);
          this.emit('close', {});
          return;
        }
        this.readyState = FakeWebSocket.OPEN;
        this.emit('open', {});
      }, 2);
    }

    addEventListener(type, fn) {
      this.listeners[type]?.add(fn);
    }

    removeEventListener(type, fn) {
      this.listeners[type]?.delete(fn);
    }

    emit(type, event) {
      for (const fn of this.listeners[type] || []) fn(event);
    }

    send(raw) {
      if (this.readyState !== FakeWebSocket.OPEN) throw new Error('not open');
      if (this.deaf) return; // A dead line: nothing gets through, nothing comes back.

      const msg = JSON.parse(raw);

      if (msg.type === 'ping') {
        setTimeout(() => this.deliver('{"type":"pong"}'), 1);
        return;
      }

      if (msg.type === 'subscribe') {
        for (const t of msg.topics) {
          this.topics.add(t);
          if (!topics.has(t)) topics.set(t, new Set());
          topics.get(t).add(this);
        }
        return;
      }

      if (msg.type === 'unsubscribe') {
        for (const t of msg.topics) {
          this.topics.delete(t);
          topics.get(t)?.delete(this);
        }
        return;
      }

      if (msg.type === 'publish') {
        if (raw.length > 512 * 1024) return; // The relay drops oversized messages.

        const out = JSON.stringify({ type: 'publish', topic: msg.topic, data: msg.data });

        for (const peer of topics.get(msg.topic) || []) {
          if (peer === this) continue;
          setTimeout(() => peer.deliver(out), 1);
        }
      }
    }

    deliver(raw) {
      if (this.readyState !== FakeWebSocket.OPEN || this.deaf) return;
      delivered += 1;
      this.emit('message', { data: raw });
    }

    close() {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.CLOSED;
      this.detach();
      setTimeout(() => this.emit('close', {}), 1);
    }

    detach() {
      sockets.delete(this);
      for (const t of this.topics) topics.get(t)?.delete(this);
    }
  }

  const relay = {
    offline: false,

    get delivered() {
      return delivered;
    },

    get openSockets() {
      return [...sockets].filter((s) => s.readyState === FakeWebSocket.OPEN).length;
    },

    /** Every socket closes (relay restart, Wi-Fi switch). */
    dropAll() {
      for (const s of [...sockets]) s.close();
    },

    /** Sockets that go silent without closing (dead NAT mapping). */
    deafenAll() {
      for (const s of [...sockets]) {
        s.deaf = true;
        s.detach();
      }
    },
  };

  globalThis.WebSocket = FakeWebSocket;
  if (typeof window !== 'undefined') window.WebSocket = FakeWebSocket;

  return relay;
}

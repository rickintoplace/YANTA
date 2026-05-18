// ============================================================
// YANTA — Live-sync providers.
//
// A provider wires a note's Y.Doc to one or more peers over a transport.
//   - WebRTC: peer-to-peer, public signaling, E2EE via room password.
//   - WebSocket: optional self-hosted y-websocket relay.
//
// Provider interface:
//   { connect(): Promise<void>, disconnect(): void, on(event, cb), awareness }
// ============================================================

import { WebrtcProvider } from 'y-webrtc';
import { getNoteDoc } from './yjs.js';

// Public signaling servers maintained by the y-webrtc project.
// Users can override via settings (see core.js settings.signalingServers).
const DEFAULT_SIGNALING = [
  'wss://yanta-signaling-932960946294.europe-west1.run.app/'
];

export function createWebRTCProvider({ noteId, room, password, signaling }) {
  const { doc } = getNoteDoc(noteId);

  const provider = new WebrtcProvider(room, doc, {
    signaling: signaling && signaling.length ? signaling : DEFAULT_SIGNALING,
    password,
    maxConns: 20,
    filterBcConns: true,
    peerOpts: {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      }
    }
  });

  return {
    kind: 'webrtc',
    provider,
    awareness: provider.awareness,
    async connect() { provider.connect(); },
    disconnect() { provider.disconnect(); provider.destroy(); },
    on(event, cb) { provider.on(event, cb); },
    off(event, cb) { provider.off(event, cb); },
    get peers() {
      try { return [...provider.awareness.getStates().keys()]; } catch { return []; }
    },
  };
}

// Stub: WebSocket-based provider (self-hosted y-websocket server).
// Returns a provider object with the same shape, but throws on connect()
// until a server URL is configured.
export function createWebSocketProvider({ noteId, room, url, password }) {
  return {
    kind: 'websocket',
    provider: null,
    awareness: null,
    async connect() { throw new Error('WebSocket provider not yet wired — set a server URL first'); },
    disconnect() {},
    on() {}, off() {},
    peers: [],
  };
}

// Generate a random room id + AES key for a new share.
// The key never leaves the device unless embedded in a share URL.
export async function generateShareCredentials() {
  const room = 'yanta-' + crypto.randomUUID();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = base64UrlEncode(keyBytes);
  return { room, key };
}

export function base64UrlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function base64UrlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

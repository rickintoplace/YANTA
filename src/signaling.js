// ============================================================
// YANTA — signaling relay endpoint.
//
// One relay serves every live feature: y-webrtc note sharing,
// shared-space and vault pokes, and presentation remote control.
// It runs as a hibernating Durable Object inside the YANTA Cloud
// Worker (yanta-cloud-worker/src/signal-relay.js).
//
// Deliberately import-free: space-poke.js needs the URL on every
// boot with a cloud vault and must not drag y-webrtc in with it.
// ============================================================

export const SIGNALING_URL =
  import.meta.env.VITE_YANTA_SIGNALING_URL ||
  'wss://yanta-cloud.rickintoplace.workers.dev/relay';

export const DEFAULT_SIGNALING = [SIGNALING_URL];

const KEEPALIVE_MS = 25_000;

/*
  Byte-exact: the relay answers this payload from its hibernation
  auto-response, so a ping neither wakes the object nor costs
  anything. Any other spelling takes the slow path.
*/
const PING = '{"type":"ping"}';

/**
 * Keep a mostly idle relay socket alive (mobile NATs and proxies
 * drop silent connections). Returns a stop function; also stops
 * itself when the socket closes.
 */
export function keepSignalingAlive(socket, intervalMs = KEEPALIVE_MS) {
  if (!socket) return () => {};

  const timer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return;

    try {
      socket.send(PING);
    } catch {}
  }, intervalMs);

  const stop = () => clearInterval(timer);

  socket.addEventListener('close', stop);
  socket.addEventListener('error', stop);

  return stop;
}

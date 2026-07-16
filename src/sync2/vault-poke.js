// ============================================================
// YANTA Sync2 — vault poke channel
//
// Near-live "this vault changed" hints between the user's own
// devices, over the same public pub/sub relay the shared spaces
// use. A device publishes after uploading vault changes; the
// others pull right away instead of waiting for the periodic
// sync interval (e.g. the desktop dashboard clears its
// "notification not covered" item seconds after the phone acks).
//
// The topic is a hash of the sync key: only devices holding the
// vault secret can derive it, and the poke itself carries no
// content. Delivery is best-effort — the periodic sync in
// main.js remains the safety net.
// ============================================================

import {
  subscribeSpacePoke,
  publishSpacePoke,
} from '../spaces/space-poke.js';

let unsubscribe = null;
let currentTopic = '';

async function vaultPokeTopic(syncKey) {
  const bytes = new TextEncoder().encode(`yanta-vault-poke:v1:${syncKey}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `yanta-vault-${hex.slice(0, 32)}`;
}

/**
 * Listen for pokes from the user's other devices. Replaces any
 * previous subscription (runtime restarts re-wire cleanly).
 */
export async function startVaultPokeSubscription({
  syncKey = '',
  deviceId = '',
  onPoke,
} = {}) {
  if (!syncKey || typeof onPoke !== 'function') return () => {};

  stopVaultPokeSubscription();
  currentTopic = await vaultPokeTopic(syncKey);

  unsubscribe = subscribeSpacePoke(currentTopic, (data) => {
    // Own pokes only echo what this device just uploaded.
    if (data?.deviceId && data.deviceId === deviceId) return;

    onPoke(data || {});
  });

  return stopVaultPokeSubscription;
}

export function stopVaultPokeSubscription() {
  try {
    unsubscribe?.();
  } catch {}

  unsubscribe = null;
  currentTopic = '';
}

/**
 * Tell the other devices to pull. Call after a sync that uploaded
 * local changes.
 */
export async function publishVaultPoke({
  syncKey = '',
  deviceId = '',
} = {}) {
  if (!syncKey) return;

  const topic = currentTopic || await vaultPokeTopic(syncKey);

  publishSpacePoke(topic, {
    t: 'vault-changed',
    deviceId,
    ts: Date.now(),
  });
}

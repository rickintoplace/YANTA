// ============================================================
// YANTA — localStorage entries sealed while the lock is on
//
// A few things live in localStorage and are personal: the AI key kept
// on this device and the last AI conversation. localStorage is
// synchronous, sealing is not — so the opened values are held in memory
// after unlocking, reads come from there, and writes are sealed and
// stored a moment later. Without the lock, it is plain localStorage.
// ============================================================

import { atRestActive, isSealedString, openString, sealString } from './at-rest.js';

export const SEALED_LOCAL_KEYS = [
  'yanta.ai.openrouter.key.local',
  'yanta.ai.chat.transient.v1',
];

const opened = new Map();
let writeChain = Promise.resolve();

/** After unlocking: open the sealed entries into memory. */
export async function loadSealedLocal() {
  for (const key of SEALED_LOCAL_KEYS) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch {}
    if (raw === null) continue;

    try {
      opened.set(key, await openString(raw, `local:${key}`));
    } catch (err) {
      // A value sealed under another key (an old lock) is gone for good.
      console.warn('[YANTA] Sealed entry unreadable, dropped', key, err);
      try { localStorage.removeItem(key); } catch {}
    }
  }
}

/** Seals entries still stored in the clear (part of the at-rest migration). */
export async function sealLocalEntries() {
  if (!atRestActive()) return;
  for (const key of SEALED_LOCAL_KEYS) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch {}
    if (raw === null || isSealedString(raw)) continue;
    setSealedItem(key, opened.has(key) ? opened.get(key) : raw);
  }
  await writeChain;
}

export function getSealedItem(key) {
  if (opened.has(key)) return opened.get(key);

  let raw = null;
  try { raw = localStorage.getItem(key); } catch {}
  // Sealed but not opened (still locked at start): nothing to show yet.
  return isSealedString(raw) ? null : raw;
}

export function setSealedItem(key, value) {
  const text = String(value);

  if (!atRestActive()) {
    opened.delete(key);
    localStorage.setItem(key, text);
    return;
  }

  opened.set(key, text);
  writeChain = writeChain.catch(() => {}).then(async () => {
    const sealed = await sealString(text, `local:${key}`);
    // Removed or replaced while sealing? Then this write is stale.
    if (opened.get(key) === text) localStorage.setItem(key, sealed);
  });
}

export function removeSealedItem(key) {
  opened.delete(key);
  try { localStorage.removeItem(key); } catch {}
}

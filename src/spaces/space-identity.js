// ============================================================
// YANTA Shared Spaces — own identity
//
// Who "I" am inside a shared space. The Matrix ID is the identity every
// participant agrees on (member grants, key delivery and the people
// roster all key on it), so it wins over any local display name.
//
// Two entry points on purpose:
//   peekOwnIdentity()     synchronous, zero-cost — usable in render
//                         paths (the dashboard excludes "me" from the
//                         collaborator avatars on every card)
//   resolveOwnIdentity()  awaits the chat session, loading it if needed
//
// Warum der Settings-Cache: die Matrix-Session startet erst spät im
// Boot. Ohne den gecachten Wert würde man sich selbst kurzzeitig als
// eigener Mitarbeiter auf jeder Karte sehen.
// ============================================================

import { store } from '../core.js';

const CACHE_KEY = 'spaces.identity.v1';

let cached = '';
let hydrating = null;

/** The live Matrix client IF chat is already running — never loads it. */
export function peekMatrixClient() {
  if (typeof window === 'undefined') return null;

  return window.yantaChatSession?.client || window.yantaMatrixClient || null;
}

export function peekOwnMatrixUserId() {
  try {
    return String(peekMatrixClient()?.getUserId?.() || '');
  } catch {
    return '';
  }
}

/** Best identity known right now, without any await. May be ''. */
export function peekOwnIdentity() {
  return peekOwnMatrixUserId() || cached;
}

function remember(matrixUserId) {
  const id = String(matrixUserId || '');
  if (!id || id === cached) return cached;

  cached = id;
  store.settings.set(CACHE_KEY, id).catch(() => {});

  return cached;
}

/**
 * Restore the last known Matrix ID from disk. Cheap (one settings read)
 * and safe to call during startup — it never pulls in the Matrix SDK.
 */
export async function hydrateOwnIdentity() {
  if (hydrating) return hydrating;

  hydrating = (async () => {
    const live = peekOwnMatrixUserId();
    if (live) return remember(live);

    const saved = await store.settings.get(CACHE_KEY, '').catch(() => '');
    if (saved && !cached) cached = String(saved);

    return cached;
  })();

  return hydrating;
}

/**
 * Identity for attribution, with graceful degradation: Matrix ID →
 * cached Matrix ID → local display name → 'Someone'. Never loads the
 * chat session (callers on hot paths must stay cheap).
 */
export async function ownIdentityOrLabel() {
  const known = peekOwnIdentity() || (await hydrateOwnIdentity());
  if (known) return known;

  try {
    const name = await store.settings.get('userName', '');
    if (name) return String(name);
  } catch {}

  return 'Someone';
}

/**
 * Full resolve — loads the chat session if that is what it takes, then
 * falls back to the local display name and the cloud account e-mail.
 */
export async function resolveOwnIdentity() {
  const live = peekOwnMatrixUserId();
  if (live) return remember(live);

  try {
    const { resolveMatrixClient } = await import('../chat/chat-actions.js');
    const client = await resolveMatrixClient();
    const userId = client?.getUserId?.();

    if (userId) return remember(String(userId));
  } catch {}

  const known = await hydrateOwnIdentity();
  if (known) return known;

  try {
    const name = await store.settings.get('userName', '');
    if (name) return String(name);
  } catch {}

  try {
    const { cloudMe } = await import('../cloud/cloud-api.js');
    const me = await cloudMe();
    if (me?.user?.email) return String(me.user.email);
  } catch {}

  return 'Someone';
}

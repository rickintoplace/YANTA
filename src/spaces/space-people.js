// ============================================================
// YANTA Shared Spaces — people (roster, profiles, activity)
//
// "Who is this shared with, and who touched it last?" must be answerable
// instantly, offline, on every participant — that is what makes sharing
// legible in the UI (dashboard cards, tree, share dialog).
//
// The member list lives on the worker, but only the OWNER may read it,
// and asking the network on every render is out of the question. So the
// owner publishes it into a tiny per-space Y.Doc that travels through
// the very same end-to-end encrypted channel as the content:
//
//   roster    matrixUserId -> { role, at }      (owner writes)
//   profiles  identity     -> { name, avatar }  (each writer writes its
//                                                own; the owner fills in
//                                                what it knows for the
//                                                rest, so read-only
//                                                members have a face too)
//   activity  itemKey      -> { by, at }        (writers stamp their own
//                                                edits; itemKey is the
//                                                doc's space-stable
//                                                remote key)
//
// The doc is attached to the space engine like any other document, so it
// inherits encryption, journal compaction and access control for free.
// The server never sees a name: it only ever stores ciphertext.
// ============================================================

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

import { state } from '../core.js';

import {
  peekMatrixClient,
  peekOwnIdentity,
  hydrateOwnIdentity,
  ownIdentityOrLabel,
} from './space-identity.js';

// Space-stable remote key — identical on every participant.
export const PEOPLE_REMOTE_KEY = 'people';

// Local doc id inside the engine. Cannot collide with note IDs.
const peopleLocalKey = (spaceId) => `people:${spaceId}`;

const PEOPLE_ORIGIN = 'space-people';

// One stamp per minute is plenty for "edited 5 minutes ago" and keeps
// a typing burst from turning into a stream of tiny uploads.
const ACTIVITY_THROTTLE_MS = 60_000;

// The owner republishes the roster at most this often per session.
const ROSTER_REFRESH_MS = 5 * 60_000;

const entries = new Map(); // spaceId -> { doc, persistence, ready, observer }
const activityStamps = new Map(); // `${spaceId}:${itemKey}` -> ts
const rosterRefreshedAt = new Map(); // spaceId -> ts

// ---------------- doc plumbing ----------------------------------

function getEntry(spaceId) {
  const existing = entries.get(spaceId);
  if (existing) return existing;

  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`yanta-space-people-${spaceId}`, doc);

  const ready = new Promise((resolve) => {
    persistence.once('synced', () => resolve());
  });

  const entry = { doc, persistence, ready, observer: null };
  entries.set(spaceId, entry);

  return entry;
}

function docFor(spaceId) {
  return entries.get(spaceId)?.doc || null;
}

const rosterMap = (doc) => doc.getMap('roster');
const profilesMap = (doc) => doc.getMap('profiles');
const activityMap = (doc) => doc.getMap('activity');

let emitTimer = null;

function emitPeopleChanged(spaceId) {
  clearTimeout(emitTimer);

  emitTimer = setTimeout(() => {
    window.dispatchEvent(new CustomEvent('yanta-space-people-changed', {
      detail: { spaceId },
    }));
  }, 60);
}

// ---------------- mount / unmount --------------------------------

/**
 * Attach the people doc of a mounted space to its engine and start
 * publishing what this participant knows.
 */
export async function attachSpacePeople(session) {
  const { spaceId } = session;
  const entry = getEntry(spaceId);

  await entry.ready;
  await hydrateOwnIdentity();

  await session.engine.attachDoc(peopleLocalKey(spaceId), PEOPLE_REMOTE_KEY, entry.doc);

  if (!entry.observer) {
    entry.observer = () => emitPeopleChanged(spaceId);
    entry.doc.on('update', entry.observer);
  }

  // Persisted state was applied before the observer existed.
  emitPeopleChanged(spaceId);

  publishOwnProfile(spaceId);

  if (session.role === 'owner') {
    // Deferred: the roster needs the network, and a mount happens during
    // startup where every request competes with the vault sync.
    setTimeout(() => {
      refreshSpaceRoster(spaceId).catch(() => {});
    }, 4_000);
  }
}

export function detachSpacePeople(spaceId) {
  const entry = entries.get(spaceId);
  if (!entry) return;

  if (entry.observer) {
    try {
      entry.doc.off('update', entry.observer);
    } catch {}

    entry.observer = null;
  }

  rosterRefreshedAt.delete(spaceId);

  for (const key of [...activityStamps.keys()]) {
    if (key.startsWith(`${spaceId}:`)) activityStamps.delete(key);
  }
}

/** Leaving or stopping a share: drop the local copy of its people doc. */
export async function destroySpacePeopleDoc(spaceId) {
  const entry = entries.get(spaceId);
  if (!entry) return;

  detachSpacePeople(spaceId);
  entries.delete(spaceId);

  try {
    await entry.persistence.clearData();
  } catch {}

  try {
    entry.doc.destroy();
  } catch {}
}

// ---------------- publishing --------------------------------------

function canWrite(session) {
  return session?.role === 'owner' || session?.role === 'write';
}

function matrixProfile(client, userId) {
  try {
    const user = client?.getUser?.(userId);
    if (!user) return null;

    return {
      name: String(user.displayName || '').trim(),
      avatar: String(user.avatarUrl || '').startsWith('mxc://') ? String(user.avatarUrl) : '',
    };
  } catch {
    return null;
  }
}

function writeProfile(doc, id, profile, { self = false } = {}) {
  const profiles = profilesMap(doc);
  const existing = profiles.get(id);

  // A participant's own entry is authoritative — never overwrite it with
  // the second-hand copy another participant happens to have cached.
  if (existing?.self && !self) return false;

  if (
    existing &&
    existing.name === profile.name &&
    existing.avatar === profile.avatar &&
    !!existing.self === self
  ) {
    return false;
  }

  profiles.set(id, { ...profile, self, at: Date.now() });
  return true;
}

/**
 * Publish this participant's own name and avatar. Silently does nothing
 * until the chat session is up — `yanta-chat-ready` retries it, and a
 * read-only member cannot write to the space at all.
 */
export function publishOwnProfile(spaceId) {
  const session = state.spaces.get(spaceId);
  const doc = docFor(spaceId);

  if (!doc || !canWrite(session)) return;

  const client = peekMatrixClient();
  const id = peekOwnIdentity();

  if (!client || !id) return;

  const profile = matrixProfile(client, id);
  if (!profile) return;

  doc.transact(() => {
    writeProfile(doc, id, profile, { self: true });
  }, PEOPLE_ORIGIN);
}

/**
 * Owner only: mirror the server's member list into the space so every
 * participant — who may not ask the server — knows who else is here.
 * Callers that just fetched the member list (the share dialog) pass it
 * in; everyone else uses refreshSpaceRoster().
 */
export async function publishSpaceRoster(spaceId, members = []) {
  const session = state.spaces.get(spaceId);
  const doc = docFor(spaceId);

  if (!doc || session?.role !== 'owner') return;

  const me = await ownIdentityOrLabel();
  const client = peekMatrixClient();

  const next = new Map();

  if (me) next.set(me, 'owner');

  for (const member of members) {
    const id = String(member.matrixUserId || '').trim();
    if (!id || id === me) continue;

    next.set(id, member.role === 'write' ? 'write' : 'read');
  }

  doc.transact(() => {
    const roster = rosterMap(doc);

    for (const [id, role] of next) {
      const existing = roster.get(id);

      if (existing?.role !== role) {
        roster.set(id, { role, at: existing?.at || Date.now() });
      }

      // Give members without a published profile a name and a face by
      // reusing what the owner's Matrix session already knows.
      const profile = client ? matrixProfile(client, id) : null;

      if (profile && (profile.name || profile.avatar)) {
        writeProfile(doc, id, profile, { self: id === me });
      }
    }

    for (const id of [...roster.keys()]) {
      if (!next.has(id)) roster.delete(id);
    }
  }, PEOPLE_ORIGIN);
}

/**
 * Owner only: fetch the member list and publish it. Throttled, because
 * every mounted space would otherwise hit the worker on every startup.
 *
 * Warum dynamischer Import: space-session mountet uns, ein statischer
 * Import zurück wäre ein Zyklus. Beide Module liegen im Hauptbundle,
 * der Import kostet also nichts.
 */
export async function refreshSpaceRoster(spaceId, { force = false } = {}) {
  const session = state.spaces.get(spaceId);
  if (session?.role !== 'owner') return;

  const last = rosterRefreshedAt.get(spaceId) || 0;
  if (!force && Date.now() - last < ROSTER_REFRESH_MS) return;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  rosterRefreshedAt.set(spaceId, Date.now());

  try {
    const { apiListSpaceMembers } = await import('./space-session.js');
    await publishSpaceRoster(spaceId, await apiListSpaceMembers(spaceId));
  } catch (err) {
    rosterRefreshedAt.delete(spaceId);
    console.warn('[YANTA Spaces] roster refresh failed', spaceId, err);
  }
}

/**
 * Stamp "I just edited this" for one document of the space. Called by
 * the session right after the engine uploaded local changes, so it
 * reflects real edits rather than mere presence.
 */
export async function recordSpaceActivity(spaceId, itemKey) {
  const session = state.spaces.get(spaceId);
  const doc = docFor(spaceId);
  const key = String(itemKey || '');

  if (!doc || !key || key === PEOPLE_REMOTE_KEY || !canWrite(session)) return;

  const stampKey = `${spaceId}:${key}`;
  const last = activityStamps.get(stampKey) || 0;

  if (Date.now() - last < ACTIVITY_THROTTLE_MS) return;
  activityStamps.set(stampKey, Date.now());

  const by = await ownIdentityOrLabel();

  doc.transact(() => {
    activityMap(doc).set(key, { by, at: Date.now() });
  }, PEOPLE_ORIGIN);
}

// ---------------- reading ------------------------------------------

function localpart(id) {
  const raw = String(id || '');
  if (!raw.startsWith('@')) return raw;

  return raw.slice(1).split(':')[0] || raw;
}

function personFrom(doc, id, role) {
  const profile = profilesMap(doc).get(id) || null;

  return {
    id,
    role: role || 'read',
    name: String(profile?.name || '').trim() || localpart(id),
    avatar: String(profile?.avatar || ''),
  };
}

const ROLE_ORDER = { owner: 0, write: 1, read: 2 };

/**
 * Everyone this space is shared with. Self is excluded by default —
 * collaborator avatars answer "who else", not "who".
 */
export function spacePeople(spaceId, { includeSelf = false } = {}) {
  const doc = docFor(spaceId);
  if (!doc) return [];

  const me = peekOwnIdentity();
  const people = [];

  for (const [id, value] of rosterMap(doc)) {
    if (!includeSelf && id && id === me) continue;

    people.push(personFrom(doc, id, value?.role));
  }

  return people.sort((a, b) =>
    (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * The most recent edit by someone else, either for one document of the
 * space (`itemKey`) or across the whole space (no key). Own edits are
 * left out: "you edited this" is noise on your own card.
 */
export function spaceLastEdit(spaceId, itemKey = '') {
  const doc = docFor(spaceId);
  if (!doc) return null;

  const me = peekOwnIdentity();
  const key = String(itemKey || '');

  let best = null;

  for (const [entryKey, value] of activityMap(doc)) {
    if (key && entryKey !== key) continue;

    const by = String(value?.by || '');
    const at = Number(value?.at || 0);

    if (!by || !at || (me && by === me)) continue;
    if (best && at <= best.at) continue;

    best = { by, at };
  }

  if (!best) return null;

  return {
    at: best.at,
    person: personFrom(doc, best.by, rosterMap(doc).get(best.by)?.role),
  };
}

// ---------------- chat readiness ------------------------------------

// Profiles need the Matrix session; spaces mount long before it exists.
if (typeof window !== 'undefined') {
  window.addEventListener('yanta-chat-ready', () => {
    hydrateOwnIdentity().then(() => {
      for (const spaceId of entries.keys()) {
        publishOwnProfile(spaceId);
        refreshSpaceRoster(spaceId, { force: true }).catch(() => {});
      }
    });
  });
}

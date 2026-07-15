// ============================================================
// YANTA Shared Spaces — session orchestration
//
// Ties everything together for one mounted space:
//   SpaceObjectStore  (encrypted storage on the worker)
//   SpaceEngine       (upload/pull encrypted Yjs state)
//   y-webrtc          (real-time fast path, writers only)
//   poke channel      (near-live pull triggers for everyone)
//
// Entry points:
//   createSpaceForNote(noteId)  owner starts sharing a note
//   handleSpaceUrl()            recipient opens a #space= link
//   restoreSpaces()             remount persisted spaces on startup
//   stopSpaceShare(spaceId)     owner ends the share (deletes server data)
//   leaveSpace(spaceId)         recipient unmounts + cleans up locally
// ============================================================

import { state, store, toast } from '../core.js';
import { createWebRTCProvider } from '../providers.js';
import { YANTA_CLOUD_BASE_URL } from '../cloud/cloud-api.js';
import { fetchWithRetry, errorFromResponse } from '../cloud/cloud-fetch.js';

import { SpaceObjectStore } from './space-object-store.js';
import { SpaceEngine } from './space-engine.js';
import { buildSpaceLink, parseSpaceFragment } from './space-link.js';
import {
  generateSpaceSecret,
  generateSpaceToken,
  deriveWriterRoomCredentials,
} from './space-keys.js';
import { subscribeSpacePoke, publishSpacePoke } from './space-poke.js';
import {
  WORKSPACE_REMOTE_KEY,
  waitForWorkspaceDoc,
  destroyWorkspaceDoc,
} from './workspace-doc.js';
import {
  installWorkspaceBridge,
  uninstallWorkspaceBridge,
} from './workspace-bridge.js';

const POLL_INTERVAL_MS = 60_000;
const POKE_PULL_DEBOUNCE_MS = 400;

// Remote key of a note-space's single document. Local note IDs differ
// between participants (recipients mount a placeholder note), so remote
// paths derive from this space-stable key, never from local IDs.
const MAIN_DOC_KEY = 'main';

function emitSpaceChanged(spaceId) {
  window.dispatchEvent(new CustomEvent('yanta-space-changed', { detail: { spaceId } }));
}

// ---------------- worker API ------------------------------------

function apiUrl(path) {
  return `${String(YANTA_CLOUD_BASE_URL || '/cloud-api').replace(/\/+$/, '')}${path}`;
}

function tokenHeaders(record, extra = {}) {
  const h = { ...extra };
  if (record?.readToken) h['x-yanta-space-read-token'] = record.readToken;
  if (record?.writeToken) h['x-yanta-space-write-token'] = record.writeToken;
  return h;
}

async function apiJson(res, fallback) {
  if (!res.ok) throw await errorFromResponse(res, fallback);
  return res.json();
}

async function apiCreateSpace(body) {
  const res = await fetchWithRetry(apiUrl('/api/spaces'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, { label: 'Create space' });

  return (await apiJson(res, 'Could not create shared space')).space;
}

async function apiGetSpace(spaceId, record = null) {
  const res = await fetchWithRetry(apiUrl(`/api/spaces/${encodeURIComponent(spaceId)}`), {
    method: 'GET',
    credentials: 'include',
    headers: tokenHeaders(record),
  }, { label: 'Get space' });

  return (await apiJson(res, 'Could not load shared space')).space;
}

async function apiPatchSpace(spaceId, body) {
  const res = await fetchWithRetry(apiUrl(`/api/spaces/${encodeURIComponent(spaceId)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, { label: 'Update space' });

  return (await apiJson(res, 'Could not update shared space')).space;
}

async function apiDeleteSpace(spaceId) {
  const res = await fetchWithRetry(apiUrl(`/api/spaces/${encodeURIComponent(spaceId)}`), {
    method: 'DELETE',
    credentials: 'include',
  }, { label: 'Delete space' });

  return apiJson(res, 'Could not delete shared space');
}

export async function apiListSpaceMembers(spaceId) {
  const res = await fetchWithRetry(apiUrl(`/api/spaces/${encodeURIComponent(spaceId)}/members`), {
    method: 'GET',
    credentials: 'include',
  }, { label: 'List members' });

  return (await apiJson(res, 'Could not load members')).members || [];
}

export async function apiAddSpaceMember(spaceId, { matrixUserId, role }) {
  const res = await fetchWithRetry(apiUrl(`/api/spaces/${encodeURIComponent(spaceId)}/members`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matrixUserId, role }),
  }, { label: 'Add member' });

  return apiJson(res, 'Could not add member');
}

export async function apiRemoveSpaceMember(spaceId, userId) {
  const res = await fetchWithRetry(
    apiUrl(`/api/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`),
    { method: 'DELETE', credentials: 'include' },
    { label: 'Remove member' }
  );

  return apiJson(res, 'Could not remove member');
}

// ---------------- session registry ------------------------------

export function spaceSessionFor(spaceId) {
  return state.spaces.get(spaceId) || null;
}

export function spaceSessionForNote(noteId) {
  for (const session of state.spaces.values()) {
    if (session.noteId === noteId) return session;
  }
  return null;
}

export function spaceLinksFor(session) {
  const base = {
    spaceId: session.spaceId,
    rootKey: session.record.rootKey,
    readToken: session.record.readToken,
    title: session.record.title || '',
    sourceType: session.record.sourceType || 'note',
  };

  const links = {
    read: buildSpaceLink(base),
    write: null,
  };

  if (session.role === 'owner' && session.record.writeToken && session.record.writerSecret) {
    links.write = buildSpaceLink({
      ...base,
      writeToken: session.record.writeToken,
      writerSecret: session.record.writerSecret,
      epoch: session.record.epoch || 1,
      includeWrite: true,
    });
  }

  return links;
}

async function randomColor() {
  const palette = ['#6ea8fe', '#8ab4f8', '#f78b6e', '#aed581', '#ffcc80', '#ce93d8', '#80deea'];
  return palette[Math.floor(Math.random() * palette.length)];
}

// ---------------- mounting --------------------------------------

async function mountSpace(record) {
  if (state.spaces.has(record.spaceId)) {
    return state.spaces.get(record.spaceId);
  }

  const remote = new SpaceObjectStore({
    spaceId: record.spaceId,
    readToken: record.readToken,
    writeToken: record.writeToken,
  });

  const isFolder = record.sourceType === 'folder';

  const session = {
    spaceId: record.spaceId,
    noteId: record.noteId,
    sourceType: record.sourceType || 'note',
    role: record.role,
    record,
    engine: null,
    provider: null,
    workspaceDoc: null,
    peers: 0,
    unsubscribePoke: null,
    pollTimer: null,
    lastPullAt: 0,
  };

  const engine = new SpaceEngine({
    spaceId: record.spaceId,
    rootKey: record.rootKey,
    role: record.role,
    remote,
    onDidUpload: () => {
      publishSpacePoke(record.signalingTopic, {
        t: 'poke',
        s: record.spaceId,
        p: engine.state?.participantId || '',
        ts: Date.now(),
      });
    },
    onDidApply: () => {
      session.lastPullAt = Date.now();
      window.dispatchEvent(new CustomEvent('yanta-space-doc-applied', {
        detail: { spaceId: record.spaceId, noteId: record.noteId },
      }));
    },
  });

  await engine.init();

  session.engine = engine;
  state.spaces.set(record.spaceId, session);

  if (isFolder) {
    // A folder space syncs a workspace doc (the subtree's notes and
    // folders) plus one content doc per note inside it. The bridge
    // owns attaching/detaching those note docs as items come and go.
    session.workspaceDoc = await waitForWorkspaceDoc(record.spaceId);
    await engine.attachDoc(WORKSPACE_REMOTE_KEY, WORKSPACE_REMOTE_KEY, session.workspaceDoc);
    await installWorkspaceBridge(session);
  } else {
    await engine.attachDoc(record.noteId, MAIN_DOC_KEY);
  }

  // The owner guarantees a restorable full state on the server the
  // moment the share exists — this is what makes the share survive
  // the owner going offline.
  if (session.role === 'owner') {
    await engine.ensureHeads().catch((err) => {
      console.warn('[YANTA Spaces] ensureHeads failed', err);
    });
  }

  engine.pull().catch(() => {});

  // Near-live pull triggers: poke channel + slow polling safety net.
  let pokeTimer = null;

  session.unsubscribePoke = subscribeSpacePoke(record.signalingTopic, (data) => {
    if (data?.s !== record.spaceId) return;
    if (data?.p && data.p === engine.state?.participantId) return;

    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => {
      engine.pull().catch(() => {});
    }, POKE_PULL_DEBOUNCE_MS);
  });

  session.pollTimer = setInterval(() => {
    engine.pull().catch(() => {});
  }, POLL_INTERVAL_MS);

  // Real-time fast path between writers only. Readers never receive
  // the writer secret, so they cannot join (or inject into) this room.
  //
  // Note spaces only: a folder space has many docs, and one WebRTC room
  // per note would be costly. Its writers converge over the poke channel
  // instead (a couple of seconds rather than sub-second).
  if (!isFolder && engine.canWrite && record.writerSecret) {
    try {
      const creds = await deriveWriterRoomCredentials(record.writerSecret, record.epoch || 1);

      const provider = createWebRTCProvider({
        noteId: record.noteId,
        room: creds.room,
        password: creds.password,
      });

      await provider.connect();

      try {
        const me = await store.settings.get('userName', 'Anonymous');
        const color = await store.settings.get('userColor', await randomColor());
        provider.awareness.setLocalStateField('user', { name: me, color });
      } catch {}

      provider.awareness.on('change', () => {
        session.peers = Math.max(0, provider.awareness.getStates().size - 1);
        emitSpaceChanged(record.spaceId);
      });

      session.provider = provider;
    } catch (err) {
      console.warn('[YANTA Spaces] WebRTC fast path unavailable', err);
    }
  }

  emitSpaceChanged(record.spaceId);
  return session;
}

function unmountSpace(spaceId) {
  const session = state.spaces.get(spaceId);
  if (!session) return;

  try {
    session.unsubscribePoke?.();
  } catch {}

  clearInterval(session.pollTimer);

  try {
    session.provider?.disconnect();
  } catch {}

  if (session.sourceType === 'folder') {
    uninstallWorkspaceBridge(spaceId);
  }

  try {
    session.engine?.detach();
  } catch {}

  state.spaces.delete(spaceId);
  emitSpaceChanged(spaceId);
}

// ---------------- owner: create / stop ---------------------------

export async function createSpaceForNote(noteId) {
  const existing = spaceSessionForNote(noteId);
  if (existing) return existing;

  const note = state.notes.get(noteId);
  if (!note) throw new Error('Note not found');

  const rootKey = generateSpaceSecret();
  const writerSecret = generateSpaceSecret();
  const readToken = generateSpaceToken();
  const writeToken = generateSpaceToken();

  const meta = await apiCreateSpace({
    sourceType: 'note',
    sourceId: noteId,
    readToken,
    writeToken,
  });

  const record = {
    spaceId: meta.id,
    noteId,
    role: 'owner',
    sourceType: 'note',
    title: note.title || '',
    rootKey,
    readToken,
    writeToken,
    writerSecret,
    epoch: meta.webrtcEpoch || 1,
    signalingTopic: meta.signalingTopic,
  };

  await store.spaces.put(record);

  // mountSpace uploads the initial full state (ensureHeads) before
  // returning, so the links are valid the moment they appear.
  return mountSpace(record);
}

export function spaceSessionForFolder(folderId) {
  for (const session of state.spaces.values()) {
    if (session.sourceType === 'folder' && session.record.rootFolderId === folderId) {
      return session;
    }
  }
  return null;
}

/**
 * Share a folder subtree as a live workspace. Writers can create,
 * edit and delete notes inside it; membership of the subtree stays
 * the owner's call (they move notes in and out of the folder).
 */
export async function createSpaceForFolder(folderId) {
  const existing = spaceSessionForFolder(folderId);
  if (existing) return existing;

  const folder = state.folders.get(folderId);
  if (!folder) throw new Error('Folder not found');

  const rootKey = generateSpaceSecret();
  const writerSecret = generateSpaceSecret();
  const readToken = generateSpaceToken();
  const writeToken = generateSpaceToken();

  const meta = await apiCreateSpace({
    sourceType: 'folder',
    sourceId: folderId,
    readToken,
    writeToken,
  });

  const record = {
    spaceId: meta.id,
    noteId: '',
    rootFolderId: folderId,
    role: 'owner',
    sourceType: 'folder',
    title: folder.name || '',
    rootKey,
    readToken,
    writeToken,
    writerSecret,
    epoch: meta.webrtcEpoch || 1,
    signalingTopic: meta.signalingTopic,
  };

  await store.spaces.put(record);

  return mountSpace(record);
}

export async function stopSpaceShare(spaceId) {
  const session = state.spaces.get(spaceId);
  const record = session?.record || await store.spaces.get(spaceId);

  unmountSpace(spaceId);

  if (record) {
    try {
      await session?.engine?.forgetState?.();
    } catch {}

    await store.spaces.del(spaceId);
  }

  try {
    await apiDeleteSpace(spaceId);
  } catch (err) {
    console.warn('[YANTA Spaces] server delete failed', err);
    toast('Share stopped locally — server cleanup failed', 'error');
    return;
  }

  toast('Stopped live sharing');
}

/**
 * Rotate all write credentials of a space: new write token, new
 * writer secret, epoch bump. Removed writers keep nothing usable —
 * the server rejects their old token and the WebRTC room moves.
 *
 * Key re-delivery to remaining write members is the caller's job
 * (send a fresh invite bundle per member via space-matrix).
 */
export async function rotateSpaceWriteAccess(spaceId) {
  const session = state.spaces.get(spaceId);
  const record = session?.record || await store.spaces.get(spaceId);

  if (!record || record.role !== 'owner') {
    throw new Error('Only the owner can rotate write access');
  }

  const writerSecret = generateSpaceSecret();
  const writeToken = generateSpaceToken();

  const meta = await apiPatchSpace(spaceId, {
    writeToken,
    bumpEpoch: true,
  });

  record.writerSecret = writerSecret;
  record.writeToken = writeToken;
  record.epoch = meta.webrtcEpoch || (record.epoch || 1) + 1;

  await store.spaces.put(record);

  // Reconnect with the new WebRTC credentials.
  unmountSpace(spaceId);
  await mountSpace(record);

  return record;
}

// ---------------- recipient: open link / leave -------------------

export async function handleSpaceUrl() {
  const parsed = parseSpaceFragment(location.hash);
  if (!parsed) return null;

  // Ask the server for live metadata (signaling topic, epoch, and the
  // role the current session actually has — an owner opening their own
  // link on a second device gets 'owner' back).
  let meta = null;

  try {
    meta = await apiGetSpace(parsed.spaceId, parsed);
  } catch (err) {
    console.error('[YANTA Spaces] space link unavailable', err);
    toast('This share link is no longer valid', 'error');
    return null;
  }

  const existing = await store.spaces.get(parsed.spaceId);
  const role = meta.role === 'owner' ? 'owner' : parsed.role;
  const sourceType = meta.sourceType === 'folder' ? 'folder' : parsed.sourceType;

  const record = {
    spaceId: parsed.spaceId,
    noteId: existing?.noteId || '',
    rootFolderId: existing?.rootFolderId || (role === 'owner' ? meta.sourceId : '') || '',
    role,
    sourceType,
    title: parsed.title || '',
    rootKey: parsed.rootKey,
    readToken: parsed.readToken,
    writeToken: parsed.writeToken,
    writerSecret: parsed.writerSecret,
    epoch: meta.webrtcEpoch || parsed.epoch || 1,
    signalingTopic: meta.signalingTopic,
  };

  if (sourceType === 'note') {
    // Owners opening their own link (e.g. second device) reattach their
    // real note; everyone else gets a placeholder with a space-derived
    // ID that cannot collide with their own notes.
    record.noteId =
      record.noteId ||
      (role === 'owner' && meta.sourceId ? meta.sourceId : `spacenote_${parsed.spaceId}`);

    await ensurePlaceholderNote(record, parsed.title);
  }

  await store.spaces.put(record);
  await mountSpace(record);

  // A folder workspace opens on its root folder, not a single note.
  const openNoteId = sourceType === 'note' ? record.noteId : '';

  history.replaceState(
    { noteId: openNoteId },
    '',
    openNoteId ? '#' + encodeURIComponent(openNoteId) : location.pathname
  );

  return {
    noteId: openNoteId,
    folderId: record.rootFolderId || '',
    sourceType,
    role,
    spaceId: parsed.spaceId,
  };
}

async function ensurePlaceholderNote(record, title = '') {
  if (state.notes.has(record.noteId)) return;

  const note = {
    id: record.noteId,
    title: title || record.title || 'Shared note',
    type: 'markdown',
    folderId: null,
    tags: ['shared'],
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
    spaceId: record.spaceId,
    spaceRole: record.role,
  };

  state.notes.set(note.id, note);
  await store.notes.put(note);
}

/**
 * Mount a space from a key bundle delivered over E2EE Matrix
 * (me.yanta.space.invite.v1). The server's member row is the
 * authoritative role; the bundle only carries key material.
 */
export async function mountSpaceFromInvite({
  spaceId,
  title = '',
  sourceType = 'note',
  bundle = {},
  invitedBy = '',
}) {
  if (!spaceId || !bundle.k) return null;

  const existing = await store.spaces.get(spaceId);

  if (existing?.role === 'owner') return null;

  let meta = null;

  try {
    meta = await apiGetSpace(spaceId);
  } catch (err) {
    console.warn('[YANTA Spaces] invite for inaccessible space', spaceId, err);
    return null;
  }

  const role = meta.role === 'write' ? 'write' : 'read';
  const epoch = Number(bundle.ep || meta.webrtcEpoch || 1);

  // Re-deliveries with the same key material and role are no-ops.
  if (
    existing &&
    existing.role === role &&
    existing.epoch === epoch &&
    existing.rootKey === bundle.k &&
    (existing.writerSecret || '') === (bundle.ws || '')
  ) {
    return state.spaces.get(spaceId) || mountSpace(existing);
  }

  const kind = meta.sourceType === 'folder' ? 'folder' : sourceType;

  const record = {
    spaceId,
    noteId: existing?.noteId || (kind === 'note' ? `spacenote_${spaceId}` : ''),
    rootFolderId: existing?.rootFolderId || '',
    role,
    sourceType: kind,
    title: title || existing?.title || '',
    rootKey: bundle.k,
    readToken: '',
    writeToken: '',
    writerSecret: bundle.ws || '',
    epoch,
    signalingTopic: meta.signalingTopic,
    invitedBy,
  };

  if (kind === 'note') {
    await ensurePlaceholderNote(record, title);

    // A role change (e.g. viewer promoted to editor) must reach the
    // already-materialized note, otherwise the editor stays locked.
    const note = state.notes.get(record.noteId);

    if (note?.spaceId === spaceId && note.spaceRole !== role) {
      note.spaceRole = role;
      await store.notes.put(note);
    }
  }

  await store.spaces.put(record);

  // Rotation / role change: remount so WebRTC creds and observers
  // match the new material.
  if (state.spaces.has(spaceId)) {
    unmountSpace(spaceId);
  }

  const session = await mountSpace(record);

  if (!existing) {
    toast(
      `"${record.title || (kind === 'folder' ? 'A folder' : 'A note')}" was shared with you`,
      'success'
    );
  }

  return session;
}

export async function leaveSpace(spaceId) {
  const record = await store.spaces.get(spaceId);

  unmountSpace(spaceId);

  if (!record) return;

  try {
    await store.settings.set(`space.${spaceId}.state`, null);
  } catch {}

  await store.spaces.del(spaceId);

  // Recipients drop everything they materialized from the space; the
  // owner keeps their own notes and folders untouched.
  if (record.role !== 'owner') {
    for (const note of [...state.notes.values()]) {
      if (note.spaceId !== spaceId) continue;

      state.notes.delete(note.id);
      await store.notes.del(note.id);

      if (state.currentNoteId === note.id) state.currentNoteId = null;
    }

    for (const folder of [...state.folders.values()]) {
      if (folder.spaceId !== spaceId) continue;

      state.folders.delete(folder.id);
      await store.folders.del(folder.id);
    }
  }

  if (record.sourceType === 'folder') {
    await destroyWorkspaceDoc(spaceId);
  }

  emitSpaceChanged(spaceId);
}

// ---------------- startup restore --------------------------------

export async function restoreSpaces() {
  let records = [];

  try {
    records = await store.spaces.all();
  } catch {
    return;
  }

  for (const record of records) {
    // A stale share: its local source is gone (owner deleted the note
    // or folder, recipient deleted their materialized copy).
    const sourceGone =
      record.sourceType === 'folder'
        ? record.rootFolderId && !state.folders.has(record.rootFolderId)
        : !state.notes.has(record.noteId);

    // Recipients of a folder space materialize their root folder on the
    // first pull, so a missing root folder is normal on a fresh mount.
    const notYetMaterialized =
      record.sourceType === 'folder' &&
      record.role !== 'owner' &&
      !record.rootFolderId;

    if (sourceGone && !notYetMaterialized) {
      await store.spaces.del(record.spaceId);
      await store.settings.set(`space.${record.spaceId}.state`, null).catch(() => {});
      continue;
    }

    mountSpace(record).catch((err) => {
      console.warn('[YANTA Spaces] restore failed', record.spaceId, err);
    });
  }
}

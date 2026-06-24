// ============================================================
// YANTA AI — Persisted AI Sessions
//
// Stored as normal system note metadata + per-note Y.Doc map.
// Therefore sessions are encrypted/synced by existing Sync2.
// ============================================================

import {
  uid,
  state,
  store,
} from '../core.js';

import {
  getNoteDoc,
} from '../yjs.js';

import {
  renderTree,
} from '../tree.js';

import {
  compactContextItemForStorage,
  aiContextTotals,
} from './context-attachments.js';

export const AI_SESSION_IDS = Object.freeze({
  rootFolder: 'system_ai_sessions',
});

const NOW = () => Date.now();

function withoutTrashFields(item = {}) {
  const {
    trashed,
    deletedAt,
    deletedBy,
    trashOriginalFolderId,
    trashOriginalFolderPath,
    trashOriginalParentId,
    trashOriginalParentPath,
    ...rest
  } = item || {};

  return rest;
}

function systemFolderPatch(extra = {}) {
  return {
    system: true,
    aiSessionRoot: true,
    dashboardHidden: true,
    hiddenFromDashboard: true,
    icon: 'messages-square',
    color: '#38bdf8',
    ...extra,
  };
}

function systemSessionNotePatch(extra = {}) {
  return {
    system: true,
    aiSession: true,
    dashboardHidden: true,
    hiddenFromDashboard: true,
    type: 'ai-session',
    icon: 'messages-square',
    color: '#38bdf8',
    ...extra,
  };
}

export async function ensureAiSessionsFolder() {
  const existingRaw = state.folders.get(AI_SESSION_IDS.rootFolder);
  const existing = existingRaw ? withoutTrashFields(existingRaw) : null;

  const folder = {
    ...(existing || {}),
    id: AI_SESSION_IDS.rootFolder,
    name: 'AI Sessions',
    parentId: null,
    created: existing?.created || NOW(),
    updated: NOW(),
    ...systemFolderPatch(existing || {}),
  };

  // Extra hardening: this system folder must never stay in Trash.
  delete folder.trashed;
  delete folder.deletedAt;
  delete folder.deletedBy;
  delete folder.trashOriginalParentId;
  delete folder.trashOriginalParentPath;

  state.folders.set(folder.id, folder);
  await store.folders.put(folder);

  return folder;
}

function deriveTitleFromMessages(messages = []) {
  const firstUser = [...messages].find((m) => m.role === 'user');

  const text = String(firstUser?.content || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return 'AI Session';

  return text.length > 52
    ? `${text.slice(0, 52)}…`
    : `${text}`;
}

export function isAiSessionNote(note) {
  return !!note && (
    note.aiSession === true ||
    note.type === 'ai-session' ||
    note.folderId === AI_SESSION_IDS.rootFolder
  );
}

export async function createAiSession({
  title = '',
  messages = [],
  contextItems = [],
  model = '',
} = {}) {
  await ensureAiSessionsFolder();

  const id = `ai_session_${uid()}`;
  const now = NOW();

  const note = {
    id,
    title: title || deriveTitleFromMessages(messages),
    folderId: AI_SESSION_IDS.rootFolder,
    tags: ['ai-session'],
    pinned: false,
    created: now,
    updated: now,
    ...systemSessionNotePatch(),
  };

  state.notes.set(id, note);
  await store.notes.put(note);

  await saveAiSession(id, {
    messages,
    contextItems,
    model,
    updateTitle: false,
  });

  renderTree();

  return id;
}

function compactMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;

  const role = String(msg.role || '');

  if (!['user', 'assistant', 'tool'].includes(role)) return null;

  return {
    role,
    content: String(msg.content || ''),
    reasoning: msg.reasoning ? String(msg.reasoning || '') : undefined,
    toolName: msg.toolName || undefined,
    model: msg.model || undefined,
    ts: Number(msg.ts || Date.now()),
  };
}

export async function saveAiSession(sessionId, {
  messages = [],
  contextItems = [],
  model = '',
  updateTitle = true,
} = {}) {
  await ensureAiSessionsFolder();

  let note = state.notes.get(sessionId);

  if (!note) {
    sessionId = await createAiSession({
      title: deriveTitleFromMessages(messages),
      messages,
      contextItems,
      model,
    });

    return sessionId;
  }

  if (!isAiSessionNote(note)) {
    throw new Error('Refusing to save AI session outside AI Sessions.');
  }

  const entry = getNoteDoc(sessionId);
  await entry.ready;

  const map = entry.doc.getMap('aiSession');

  const cleanMessages = messages
    .map(compactMessage)
    .filter(Boolean)
    .slice(-160);

  const cleanContext = contextItems
    .map(compactContextItemForStorage)
    .filter(Boolean)
    .slice(0, 80);

  entry.doc.transact(() => {
    map.set('version', 1);
    map.set('messages', cleanMessages);
    map.set('contextItems', cleanContext);
    map.set('model', String(model || ''));
    map.set('updatedAt', NOW());
    map.set('totals', aiContextTotals(cleanContext));
  }, 'ai-session-save');

  note.updated = NOW();

  if (updateTitle && (!note.title || note.title === 'AI Session')) {
    note.title = deriveTitleFromMessages(cleanMessages);
  }

  state.notes.set(note.id, note);
  await store.notes.put(note);

  renderTree();

  window.dispatchEvent(new CustomEvent('yanta-ai-session-saved', {
    detail: {
      sessionId,
    },
  }));

  return sessionId;
}

export async function loadAiSession(sessionId) {
  const note = state.notes.get(String(sessionId || ''));

  if (!note || !isAiSessionNote(note)) {
    throw new Error('AI session not found.');
  }

  const entry = getNoteDoc(note.id);
  await entry.ready;

  const map = entry.doc.getMap('aiSession');

  return {
    id: note.id,
    title: note.title || 'AI Session',
    messages: map.get('messages') || [],
    contextItems: map.get('contextItems') || [],
    model: map.get('model') || '',
    updatedAt: map.get('updatedAt') || note.updated || 0,
    totals: map.get('totals') || aiContextTotals(map.get('contextItems') || []),
  };
}

export async function estimateAiSessionsStorageBytes() {
  let total = 0;
  let count = 0;

  for (const note of state.notes.values()) {
    if (!isAiSessionNote(note)) continue;

    try {
      const session = await loadAiSession(note.id);
      total += new TextEncoder().encode(JSON.stringify(session)).byteLength;
      count++;
    } catch {}
  }

  // Approximate Yjs/encrypted object overhead.
  return {
    bytes: Math.ceil(total * 1.35),
    count,
  };
}
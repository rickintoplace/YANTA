// ============================================================
// YANTA — Live sharing (Yjs over WebRTC, E2EE via room password).
//
// Share URL fragment shape:
//
//   New:
//     #share=<noteId>:<room>:<key>:<view>:<title-slug>
//
//   Example:
//     #share=abc:yanta-room:key:preview:Einkaufsliste
//
//   Old links remain supported:
//     #share=<noteId>:<room>:<key>:<title-slug>
//
// The room ID and AES password live ONLY in the URL fragment — they
// never go to a server. y-webrtc encrypts all traffic with the password
// using PBKDF2 + AES, so signaling/relay servers can't read content.
// ============================================================

import { $, state, store, toast } from './core.js';
import { createWebRTCProvider, generateShareCredentials } from './providers.js';
import { renderTree } from './tree.js';
import qrcode from 'qrcode-generator';

const SHARE_VIEWS = new Set(['preview', 'split', 'edit']);

function b64urlEncodeString(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeString(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function shareLinkFor({ noteId, room, key, title, view = 'preview' }) {
  const payload = {
    v: 2,
    noteId,
    room,
    key,
    view: SHARE_VIEWS.has(view) ? view : 'preview',
    title: title || '',
  };

  return location.origin + location.pathname + '#share2=' + b64urlEncodeString(JSON.stringify(payload));
}

export function parseShareFragment(hash) {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;

  // New robust format:
  // #share2=<base64url-json>
  if (h.startsWith('share2=')) {
    try {
      const obj = JSON.parse(b64urlDecodeString(h.slice('share2='.length)));

      if (!obj || !obj.noteId || !obj.room || !obj.key) return null;

      return {
        noteId: String(obj.noteId),
        room: String(obj.room),
        key: String(obj.key),
        view: SHARE_VIEWS.has(obj.view) ? obj.view : 'preview',
        title: String(obj.title || ''),
      };
    } catch {
      return null;
    }
  }

  // Old format remains supported:
  // #share=<noteId>:<room>:<key>:<view>:<title>
  if (!h.startsWith('share=')) return null;

  const raw = h.slice('share='.length);
  const parts = raw.split(':').map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });

  if (parts.length < 3) return null;

  const [noteId, room, key] = parts;

  let view = 'preview';
  let titleParts = parts.slice(3);

  if (titleParts[0] && SHARE_VIEWS.has(titleParts[0])) {
    view = titleParts[0];
    titleParts = titleParts.slice(1);
  }

  return {
    noteId,
    room,
    key,
    view,
    title: titleParts.join(':').replace(/-/g, ' '),
  };
}

// ---------------- start / stop sharing -------------------------
export async function startSharing(noteId) {
  if (state.liveShares.has(noteId)) return state.liveShares.get(noteId);

  const note = state.notes.get(noteId);
  if (!note) return null;

  const existing = await store.shares.get(noteId);
  const creds = existing || { ...(await generateShareCredentials()) };

  if (!existing) {
    await store.shares.put({ noteId, ...creds });
  }

  const session = await connectToShare(noteId, creds.room, creds.key);
  return session;
}

export async function stopSharing(noteId) {
  const id = noteId || state.currentNoteId;
  if (!id) return;

  const sess = state.liveShares.get(id);
  if (sess) {
    try {
      sess.provider.disconnect();
    } catch {}

    state.liveShares.delete(id);
  }

  await store.shares.del(id);

  renderTree();
  renderShareIndicator();
  toast('Stopped sharing');
}

export async function connectToShare(noteId, room, key) {
  if (state.liveShares.has(noteId)) return state.liveShares.get(noteId);

  // y-webrtc password encrypts the entire transport incl. signaling messages.
  const provider = createWebRTCProvider({
    noteId,
    room,
    password: key,
  });

  await provider.connect();

  // Awareness: announce a local user.
  try {
    const me = await store.settings.get('userName', 'Anonymous');
    const color = await store.settings.get('userColor', randomColor());
    provider.awareness.setLocalStateField('user', { name: me, color });
  } catch {}

  const session = {
    noteId,
    room,
    key,
    provider,
    peers: 0,
  };

  state.liveShares.set(noteId, session);

  provider.awareness.on('change', () => {
    session.peers = Math.max(0, provider.awareness.getStates().size - 1);

    const peerEl = $('sharePeers');
    if (peerEl && !$('shareModal')?.hidden && state.currentNoteId === noteId) {
      peerEl.textContent = String(session.peers);
    }

    renderShareIndicator();
    renderTree();
  });

  renderShareIndicator();
  renderTree();

  return session;
}

function randomColor() {
  const palette = [
    '#6ea8fe',
    '#8ab4f8',
    '#f78b6e',
    '#aed581',
    '#ffcc80',
    '#ce93d8',
    '#80deea',
  ];

  return palette[Math.floor(Math.random() * palette.length)];
}

// ---------------- Share modal ----------------------------------
export async function openShareModal() {
  const id = state.currentNoteId;

  if (!id) {
    toast('Open a note first', 'error');
    return;
  }

  const note = state.notes.get(id);
  if (!note) {
    toast('Note not found', 'error');
    return;
  }

  const session = await startSharing(id);
  if (!session) {
    toast('Could not start sharing', 'error');
    return;
  }

  const m = $('shareModal');
  const titleEl = $('shareNoteTitle');
  const linkEl = $('shareLink');
  const peerEl = $('sharePeers');
  const qrHost = $('shareQr');

  // Optional checkbox in index.html:
  //
  // <label class="switch" style="margin:10px 0 12px">
  //   <input type="checkbox" id="sharePreviewOnly" checked />
  //   <span>Empfänger in Preview öffnen, damit Markdown verborgen bleibt</span>
  // </label>
  //
  // Wenn das Element nicht existiert, ist Preview trotzdem Standard.
  const previewOnlyEl = $('sharePreviewOnly');

  if (titleEl) titleEl.textContent = note.title || 'Untitled';
  if (peerEl) peerEl.textContent = String(session.peers || 0);

  if (previewOnlyEl) {
    previewOnlyEl.checked = true;
  }

  const refreshLink = () => {
    const view = previewOnlyEl?.checked === false ? 'split' : 'preview';

    const link = shareLinkFor({
      noteId: id,
      room: session.room,
      key: session.key,
      title: note.title,
      view,
    });

    if (linkEl) linkEl.value = link;

    if (qrHost) {
      qrHost.replaceChildren();
      qrHost.append(renderQrSvg(link, 220));
    }
  };

  if (previewOnlyEl) {
    previewOnlyEl.onchange = refreshLink;
  }

  refreshLink();

  if (m) m.hidden = false;
}

export function closeShareModal() {
  const m = $('shareModal');
  if (m) m.hidden = true;
}

// ---------------- Indicator in head actions --------------------
export function renderShareIndicator() {
  const btn = $('btn-share');
  if (!btn) return;

  const id = state.currentNoteId;
  const sess = id ? state.liveShares.get(id) : null;

  btn.classList.toggle('active', !!sess);

  if (sess) {
    btn.title = `Sharing live · ${sess.peers} peer${sess.peers === 1 ? '' : 's'}`;
  } else {
    btn.title = 'Share this note live';
  }
}

// ---------------- Auto-restore previously shared notes ----------
export async function restoreSharedNotes() {
  try {
    const all = await store.shares.all();

    for (const s of all) {
      // Only connect if the note still exists locally.
      if (!state.notes.has(s.noteId)) {
        await store.shares.del(s.noteId);
        continue;
      }

      connectToShare(s.noteId, s.room, s.key).catch(() => {});
    }
  } catch {}
}

// ---------------- On-load: open a shared note from URL ---------
export async function handleShareUrl() {
  const parsed = parseShareFragment(location.hash);
  if (!parsed) return null;

  // Create local placeholder note if we don't have it.
  if (!state.notes.has(parsed.noteId)) {
    const note = {
      id: parsed.noteId,
      title: parsed.title || 'Shared note',
      type: 'markdown',
      folderId: null,
      tags: ['shared'],
      pinned: false,
      created: Date.now(),
      updated: Date.now(),
    };

    state.notes.set(parsed.noteId, note);
    await store.notes.put(note);

    await store.shares.put({
      noteId: parsed.noteId,
      room: parsed.room,
      key: parsed.key,
    });
  }

  await connectToShare(parsed.noteId, parsed.room, parsed.key);

  // Clear the fragment so it doesn't stick around once we're inside the note.
  history.replaceState(
    { noteId: parsed.noteId },
    '',
    '#' + encodeURIComponent(parsed.noteId)
  );

  return {
    noteId: parsed.noteId,
    view: parsed.view || 'preview',
    previewOnly: (parsed.view || 'preview') === 'preview',
  };
}

// Render a QR code as an inline SVG element.
function renderQrSvg(text, size = 220) {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();

  const n = qr.getModuleCount();
  const ns = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('shape-rendering', 'crispEdges');

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', n);
  bg.setAttribute('height', n);
  bg.setAttribute('fill', 'white');
  svg.append(bg);

  let path = '';

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }
  }

  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'black');
  svg.append(p);

  return svg;
}
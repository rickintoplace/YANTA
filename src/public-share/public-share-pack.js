import {
  state,
} from '../core.js';

import {
  noteMarkdown,
  listDrawingsForNote,
  listCitationsForNote,
} from '../yjs.js';

import {
  ensureAssetV2,
  unwrapAssetKeyForVault,
} from '../sync2/assets.js';

import {
  wrapAssetKeyForShare,
} from './public-share-crypto.js';

const YANTA_IMAGE_RE = /yanta-img:\/\/([a-z0-9_:-]+)/gi;

function collectMarkdownAssetIds(markdown = '') {
  const ids = new Set();
  let m;

  YANTA_IMAGE_RE.lastIndex = 0;

  while ((m = YANTA_IMAGE_RE.exec(String(markdown || ''))) !== null) {
    if (m[1]) ids.add(m[1]);
  }

  return ids;
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }

  return '{' + Object.keys(value).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
    .join(',') + '}';
}

async function sha256B64url(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const u8 = new Uint8Array(digest);

  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);

  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function packPublicNoteShare({
  noteId,
  shareKey,
  engine,
} = {}) {
  if (!noteId) throw new Error('noteId required');
  if (!shareKey) throw new Error('shareKey required');
  if (!engine) throw new Error('YANTA Cloud Sync engine is not running');

  const note = state.notes.get(noteId);

  if (!note) {
    throw new Error('Note not found');
  }

  const markdown = noteMarkdown(noteId);
  const assetIds = collectMarkdownAssetIds(markdown);

  const drawings = listDrawingsForNote(noteId);
  const citations = listCitationsForNote(noteId);

  const assets = [];
  const assetGrants = [];
  const missingAssets = [];

  for (const assetId of assetIds) {
    try {
      const meta = await ensureAssetV2(engine, assetId);
      const assetKeyBytes = await unwrapAssetKeyForVault(engine, meta);

      const encryptedAssetKeyForShare = await wrapAssetKeyForShare(
        shareKey,
        assetId,
        assetKeyBytes
      );

      assets.push({
        logicalId: assetId,
        objectId: meta.objectId,
        objectPath: meta.objectPath,
        mime: meta.type || 'application/octet-stream',
        size: Number(meta.size || 0),
        encryptedAssetKeyForShare,
        usedBy: ['markdown'],
      });

      assetGrants.push({
        assetObjectId: meta.objectId,
        objectPath: meta.objectPath,
        sizeBytes: Number(meta.size || 0),
        mime: meta.type || 'application/octet-stream',
      });
    } catch (err) {
      console.warn('[YANTA Public Share] missing asset', assetId, err);

      missingAssets.push({
        assetId,
        reason: err?.message || String(err),
      });
    }
  }

  const payload = {
    v: 1,
    kind: 'yanta-public-note-share',
    exportedAt: new Date().toISOString(),

    note: {
      id: note.id,
      title: note.title || 'Untitled',
      icon: note.icon || null,
      color: note.color || null,
      tags: note.tags || [],
      markdown,
      updated: note.updated || null,
    },

    drawings: drawings.map((d) => ({
      id: d.id,
      title: d.title || 'Drawing',
      canvas: d.canvas || null,
      elements: d.elements || [],
      appState: d.appState || {},
      files: d.files || {},
      updated: d.updated || null,
    })),

    citations,

    assets,

    warnings: {
      missingAssets,
    },
  };

  const payloadHash = await sha256B64url(stableStringify(payload));

  return {
    payload,
    payloadHash,
    assetGrants,
    missingAssets,
  };
}
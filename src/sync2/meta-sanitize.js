// ============================================================
// YANTA Sync2 — metadata sanitizers
//
// The single definition of which note/folder/image fields are vault
// metadata. The store bridge (local → VaultDoc), the sync engine
// (VaultDoc → state/cache) and startup hydration all use these.
//
// Why one module: three hand-kept copies drifted apart. The startup
// copy lacked `aiGenerated`, so every boot wrote notes without it back
// through the bridge and stripped AI provenance from the vault; the
// engine copy lacked `publicShare`.
// ============================================================

export function cleanUndefined(obj) {
  const out = {};

  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }

  return out;
}

export function finiteNumberOrUndefined(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function sanitizePublicShareMeta(share) {
  if (!share || typeof share !== 'object') return undefined;

  const shareId = String(share.shareId || share.id || '').trim();
  if (!shareId) return undefined;

  return cleanUndefined({
    enabled: share.enabled !== false,
    shareId,
    shareKey: share.shareKey ? String(share.shareKey) : undefined,
    url: share.url ? String(share.url) : undefined,

    status: share.status ? String(share.status) : undefined,
    expiresAt: share.expiresAt || share.expires_at || null,
    revokedAt: share.revokedAt || share.revoked_at || null,

    lastPublishedAt: share.lastPublishedAt || share.last_published_at || null,
    lastPayloadHash: share.lastPayloadHash || undefined,
  });
}

export function sanitizeNoteMeta(note) {
  if (!note || typeof note !== 'object') return null;

  return cleanUndefined({
    id: String(note.id || ''),
    title: String(note.title || 'Untitled'),
    type: String(note.type || 'markdown'),
    folderId: note.folderId || null,
    tags: Array.isArray(note.tags) ? [...note.tags].map(String) : [],
    pinned: !!note.pinned,
    icon: note.icon || undefined,
    color: note.color || undefined,
    publicShare: sanitizePublicShareMeta(note.publicShare),
    created: Number(note.created || Date.now()),
    updated: Number(note.updated || Date.now()),
    bodyMigrated: note.bodyMigrated === true ? true : undefined,

    // Dashboard layout/user preferences.
    dashboardOrder: finiteNumberOrUndefined(note.dashboardOrder),
    dashboardPinnedOrder: finiteNumberOrUndefined(note.dashboardPinnedOrder),
    dashboardHeightPx: finiteNumberOrUndefined(note.dashboardHeightPx),

    // Legacy compatibility. New code should prefer dashboardHeightPx.
    dashboardHeight: finiteNumberOrUndefined(note.dashboardHeight),

    hidden: note.hidden === true ? true : undefined,
    archived: note.archived === true ? true : undefined,
    system: note.system === true ? true : undefined,
    aiBrain: note.aiBrain === true ? true : undefined,

    // Provenance. Must travel: a note written by a background run has to
    // look AI-written on every device, not only the one that made it.
    aiGenerated: note.aiGenerated === true ? true : undefined,
    aiSource: note.aiGenerated === true && note.aiSource
      ? String(note.aiSource)
      : undefined,
    dashboardHidden: note.dashboardHidden === true ? true : undefined,
    hiddenFromDashboard: note.hiddenFromDashboard === true ? true : undefined,

    trashed: note.trashed === true ? true : undefined,
    deletedAt: finiteNumberOrUndefined(note.deletedAt),
    deletedBy: note.deletedBy ? String(note.deletedBy) : undefined,
    trashOriginalFolderId: note.trashOriginalFolderId || undefined,
    trashOriginalFolderPath: Array.isArray(note.trashOriginalFolderPath)
      ? note.trashOriginalFolderPath.map(String)
      : undefined,
  });
}

export function sanitizeFolderMeta(folder) {
  if (!folder || typeof folder !== 'object') return null;

  return cleanUndefined({
    id: String(folder.id || ''),
    name: String(folder.name || 'Folder'),
    parentId: folder.parentId || null,
    icon: folder.icon || undefined,
    color: folder.color || undefined,
    created: Number(folder.created || Date.now()),
    updated: Number(folder.updated || folder.created || Date.now()),

    // Dashboard layout/user preferences.
    dashboardOrder: finiteNumberOrUndefined(folder.dashboardOrder),
    dashboardHeightPx: finiteNumberOrUndefined(folder.dashboardHeightPx),

    // Legacy compatibility. New code should prefer dashboardHeightPx.
    dashboardHeight: finiteNumberOrUndefined(folder.dashboardHeight),

    hidden: folder.hidden === true ? true : undefined,
    archived: folder.archived === true ? true : undefined,
    system: folder.system === true ? true : undefined,
    aiBrain: folder.aiBrain === true ? true : undefined,
    dashboardHidden: folder.dashboardHidden === true ? true : undefined,
    hiddenFromDashboard: folder.hiddenFromDashboard === true ? true : undefined,

    trashed: folder.trashed === true ? true : undefined,
    deletedAt: finiteNumberOrUndefined(folder.deletedAt),
    deletedBy: folder.deletedBy ? String(folder.deletedBy) : undefined,
    trashOriginalParentId: folder.trashOriginalParentId || undefined,
    trashOriginalParentPath: Array.isArray(folder.trashOriginalParentPath)
      ? folder.trashOriginalParentPath.map(String)
      : undefined,
  });
}

export function sanitizeImageMeta(image) {
  if (!image || typeof image !== 'object') return null;

  const { blob, data, ...rest } = image;

  return cleanUndefined({
    id: String(rest.id || ''),
    name: rest.name ? String(rest.name) : undefined,
    size: Number(rest.size || 0),
    type: rest.type ? String(rest.type) : undefined,
    ts: Number(rest.ts || rest.updated || Date.now()),
    updated: Number(rest.updated || rest.ts || Date.now()),

    // Asset-key architecture v2.
    encryptionVersion: Number(rest.encryptionVersion || 1),
    objectId: rest.objectId ? String(rest.objectId) : undefined,
    objectPath: rest.objectPath ? String(rest.objectPath) : undefined,
    keyVersion: Number(rest.keyVersion || 1),
    keyAlg: rest.keyAlg ? String(rest.keyAlg) : undefined,
    encryptedAssetKeyForVault: rest.encryptedAssetKeyForVault
      ? String(rest.encryptedAssetKeyForVault)
      : undefined,
  });
}

export function stableJsonStringify(value) {
  if (value == null) return String(value);

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(stableJsonStringify).join(',') + ']';
  }

  const keys = Object.keys(value).sort();

  return '{' + keys
    .map((key) => JSON.stringify(key) + ':' + stableJsonStringify(value[key]))
    .join(',') + '}';
}

export function jsonEqual(a, b) {
  try {
    return stableJsonStringify(a) === stableJsonStringify(b);
  } catch {
    return false;
  }
}

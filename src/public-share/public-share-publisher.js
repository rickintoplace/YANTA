import {
  state,
  store,
  toast,
} from '../core.js';

import {
  cloudMe,
} from '../cloud/cloud-api.js';

import {
  packPublicNoteShare,
} from './public-share-pack.js';

import {
  encryptSharePayload,
  generateShareKeyString,
  makePublicShareUrl,
} from './public-share-crypto.js';

import {
  createPublicShare,
  publishPublicSharePayload,
  deletePublicShare,
  listOwnPublicShares,
} from './public-share-api.js';

const LOCAL_PUBLIC_SHARE_STATUS_KEY = 'yanta.publicShares.local.v1';

let timers = new Map();
let publishing = new Map();

function now() {
  return Date.now();
}

async function getConfiguredCloudVaultId() {
  return store.settings.get('sync2.yantaCloud.vaultId', '');
}

async function getSyncProvider() {
  return store.settings.get('sync2.provider', '');
}

function currentEngine() {
  return window.yantaSync2?.engine || null;
}

function readLocalState() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PUBLIC_SHARE_STATUS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeLocalState(next) {
  try {
    localStorage.setItem(LOCAL_PUBLIC_SHARE_STATUS_KEY, JSON.stringify(next));
  } catch {}
}

export function publicShareStateForNote(noteId) {
  const note = state.notes.get(noteId);
  const local = readLocalState()[noteId] || {};

  return {
    ...(note?.publicShare || {}),
    ...local,
  };
}

export function isPublicShareActive(share = {}) {
  if (!share) return false;

  const shareId = share.shareId || share.id;
  const status = String(share.status || '').toLowerCase();
  const revokedAt = share.revokedAt || share.revoked_at;
  const expiresAt = share.expiresAt || share.expires_at;

  if (!shareId) return false;
  if (share.enabled === false) return false;
  if (status === 'revoked') return false;
  if (status === 'deleted') return false;
  if (revokedAt) return false;

  if (expiresAt && Number(expiresAt) <= now()) {
    return false;
  }

  return true;
}

function noteIdForShareId(shareId) {
  const id = String(shareId || '');
  if (!id) return '';

  const local = readLocalState();

  for (const [noteId, share] of Object.entries(local)) {
    if (String(share?.shareId || '') === id) {
      return noteId;
    }
  }

  for (const note of state.notes.values()) {
    if (String(note?.publicShare?.shareId || '') === id) {
      return note.id;
    }
  }

  return '';
}

export function listLocalPublicSharedNotes() {
  const out = [];

  for (const note of state.notes.values()) {
    const share = publicShareStateForNote(note.id);

    if (!isPublicShareActive(share)) continue;

    out.push({
      noteId: note.id,
      note,
      share,
      shareId: share.shareId || share.id,
      source: 'local',
    });
  }

  return out.sort((a, b) =>
    String(a.note?.title || '').localeCompare(String(b.note?.title || ''))
  );
}

export async function refreshOwnPublicShareStatusFromCloud() {
  let res = null;

  try {
    res = await listOwnPublicShares();
  } catch (err) {
    // Not signed in / offline / not configured: harmless for local indicators.
    console.info('[YANTA Public Share] cloud status refresh skipped', err?.message || err);
    return {
      refreshed: false,
      reason: err?.message || String(err),
    };
  }

  const shares = Array.isArray(res?.shares) ? res.shares : [];
  const all = readLocalState();

  let changed = 0;

  for (const raw of shares) {
    const sourceType = raw.sourceType || raw.source_type || 'note';
    if (sourceType !== 'note') continue;

    const noteId = String(raw.sourceId || raw.source_id || '').trim();
    const shareId = String(raw.shareId || raw.id || '').trim();

    if (!noteId || !shareId) continue;

    const active = isPublicShareActive({
      shareId,
      status: raw.status,
      expiresAt: raw.expiresAt || raw.expires_at,
      revokedAt: raw.revokedAt || raw.revoked_at,
    });

    const prev = all[noteId] || {};

    if (active) {
      all[noteId] = {
        ...prev,

        enabled: true,
        shareId,

        /*
          Wenn der private shareKey auf diesem Gerät nicht vorhanden ist,
          kann YANTA den Link nicht neu zusammensetzen, aber der Indikator
          und "Stop sharing" sollen trotzdem funktionieren.
        */
        cloudOnly: !prev.shareKey,

        status: prev.shareKey
          ? (prev.status && prev.status !== 'active' ? prev.status : 'up-to-date')
          : 'active',

        expiresAt: raw.expiresAt || raw.expires_at || prev.expiresAt || null,
        lastPublishedAt:
          raw.lastPublishedAt ||
          raw.last_published_at ||
          prev.lastPublishedAt ||
          null,

        updatedAt: now(),
      };

      changed++;
      emitPublicShareChanged(noteId, all[noteId].status);
      continue;
    }

    if (String(prev.shareId || '') === shareId && prev.status !== 'revoked') {
      all[noteId] = {
        ...prev,
        enabled: false,
        status: 'revoked',
        revokedAt: raw.revokedAt || raw.revoked_at || now(),
        updatedAt: now(),
      };

      changed++;
      emitPublicShareChanged(noteId, 'revoked');
    }
  }

  if (changed > 0) {
    writeLocalState(all);
  }

  return {
    refreshed: true,
    changed,
  };
}

export async function stopPublicShareById(shareId, {
  noteId = '',
  showToast = true,
} = {}) {
  const cleanShareId = String(shareId || '').trim();
  if (!cleanShareId) return false;

  const resolvedNoteId =
    String(noteId || '').trim() ||
    noteIdForShareId(cleanShareId);

  try {
    await deletePublicShare(cleanShareId);
  } catch (err) {
    // Idempotent UX: if the server already removed it, local state should still stop showing it.
    if (err?.status !== 404) {
      throw err;
    }
  }

  const revokedAt = now();

  if (resolvedNoteId) {
    await saveLocalPublicShareState(resolvedNoteId, {
      enabled: false,
      status: 'revoked',
      revokedAt,
    });

    const note = state.notes.get(resolvedNoteId);

    if (note) {
      note.publicShare = {
        ...(note.publicShare || {}),
        shareId: cleanShareId,
        enabled: false,
        revokedAt,
      };

      await store.notes.put(note);
    }

    emitPublicShareChanged(resolvedNoteId, 'revoked');

    window.dispatchEvent(new CustomEvent('yanta-public-share-status', {
      detail: {
        noteId: resolvedNoteId,
        status: 'revoked',
      },
    }));
  } else {
    window.dispatchEvent(new CustomEvent('yanta-public-share-changed', {
      detail: {
        shareId: cleanShareId,
        status: 'revoked',
        source: 'public-share',
      },
    }));

    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
      detail: {
        reason: 'public-share-status',
        source: 'public-share',
      },
    }));
  }

  if (showToast) {
    toast('Public sharing stopped', 'success');
  }

  return true;
}

export async function stopAllPublicShares({
  showToast = true,
} = {}) {
  const targets = new Map();

  for (const row of listLocalPublicSharedNotes()) {
    if (row.shareId) {
      targets.set(row.shareId, row.noteId);
    }
  }

  try {
    const res = await listOwnPublicShares();

    for (const raw of res?.shares || []) {
      const sourceType = raw.sourceType || raw.source_type || 'note';
      if (sourceType !== 'note') continue;

      const shareId = String(raw.shareId || raw.id || '').trim();
      const noteId = String(raw.sourceId || raw.source_id || '').trim();

      if (!shareId) continue;

      if (isPublicShareActive({
        shareId,
        status: raw.status,
        expiresAt: raw.expiresAt || raw.expires_at,
        revokedAt: raw.revokedAt || raw.revoked_at,
      })) {
        targets.set(shareId, noteId || targets.get(shareId) || '');
      }
    }
  } catch (err) {
    console.info('[YANTA Public Share] could not include cloud-only shares in stop-all', err?.message || err);
  }

  let stopped = 0;
  let failed = 0;

  for (const [shareId, noteId] of targets.entries()) {
    try {
      await stopPublicShareById(shareId, {
        noteId,
        showToast: false,
      });

      stopped++;
    } catch (err) {
      failed++;
      console.warn('[YANTA Public Share] stop failed', shareId, err);
    }
  }

  if (showToast) {
    if (failed) {
      toast(`Stopped ${stopped}; ${failed} failed`, 'error');
    } else {
      toast(`Stopped sharing for ${stopped} note${stopped === 1 ? '' : 's'}`, 'success');
    }
  }

  return {
    stopped,
    failed,
    total: targets.size,
  };
}

async function saveLocalPublicShareState(noteId, patch) {
  const all = readLocalState();

  all[noteId] = {
    ...(all[noteId] || {}),
    ...patch,
    updatedAt: now(),
  };

  writeLocalState(all);
}

async function saveNotePublicShareCache(noteId, patch) {
  const note = state.notes.get(noteId);
  if (!note) return;

  note.publicShare = {
    ...(note.publicShare || {}),
    ...patch,
  };

  // Kein note.updated hier.
  // Public-share cache/status ist keine Note-Änderung.
  await store.notes.put(note);
}

function emitPublicShareChanged(noteId, status = '') {
  window.dispatchEvent(new CustomEvent('yanta-public-share-status', {
    detail: {
      noteId,
      status,
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-public-share-changed', {
    detail: {
      noteId,
      status,
      source: 'public-share',
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
    detail: {
      noteId,
      reason: 'public-share-status',
      source: 'public-share',
    },
  }));
}

async function assertPublicSharePrereqs() {
  const me = await cloudMe();

  if (!me.authenticated) {
    throw new Error('Sign in to YANTA Cloud to create public links.');
  }

  const provider = await getSyncProvider();

  if (provider !== 'yanta-cloud') {
    throw new Error('Public sharing uses YANTA Cloud Sync storage. Set up YANTA Cloud first.');
  }

  const vaultId = await getConfiguredCloudVaultId();

  if (!vaultId) {
    throw new Error('YANTA Cloud vault is not configured.');
  }

  const engine = currentEngine();

  if (!engine) {
    throw new Error('YANTA Cloud Sync engine is not running yet.');
  }

  return {
    me,
    provider,
    vaultId,
    engine,
  };
}

export async function createOrGetPublicShare(noteId, {
  expiresAt = null,
} = {}) {
  const existing = publicShareStateForNote(noteId);

  /*
    A revoked share must never be reused.
    Old local state intentionally keeps shareId/shareKey for status/history,
    but re-sharing must create a fresh cloud share + fresh key.
  */
  if (
    existing.shareId &&
    existing.shareKey &&
    existing.status !== 'revoked' &&
    existing.enabled !== false
  ) {
    return existing;
  }

  const { vaultId } = await assertPublicSharePrereqs();

  const shareKey = generateShareKeyString();

  const created = await createPublicShare({
    vaultId,
    sourceType: 'note',
    sourceId: noteId,
    expiresAt,
  });

  const shareId = created.share?.shareId || created.share?.id;

  if (!shareId) {
    throw new Error('Cloud did not return shareId');
  }

  const url = makePublicShareUrl(shareId, shareKey);

  const patch = {
    enabled: true,
    shareId,
    shareKey,
    url,
    status: 'pending',
    expiresAt,
    lastPublishedAt: null,
    lastPayloadHash: '',
  };

  await saveLocalPublicShareState(noteId, patch);
  await saveNotePublicShareCache(noteId, {
    enabled: true,
    shareId,
    expiresAt,
    lastPublishedAt: null,
  });

  emitPublicShareChanged(noteId, 'pending');

  return patch;
}

export async function publishPublicShareNow(noteId, {
  force = false,
  expiresAt = null,
} = {}) {
  if (!noteId) throw new Error('noteId required');
  if (publishing.get(noteId)) return publishing.get(noteId);

  const promise = (async () => {
    const { engine } = await assertPublicSharePrereqs();

    const share = await createOrGetPublicShare(noteId, {
      expiresAt,
    });

    await saveLocalPublicShareState(noteId, {
      status: 'publishing',
      lastError: '',
    });

    window.dispatchEvent(new CustomEvent('yanta-public-share-status', {
      detail: {
        noteId,
        status: 'publishing',
      },
    }));

    const packed = await packPublicNoteShare({
      noteId,
      shareKey: share.shareKey,
      engine,
    });

    if (!force && share.lastPayloadHash === packed.payloadHash) {
      await saveLocalPublicShareState(noteId, {
        status: 'up-to-date',
      });

      return {
        unchanged: true,
        share,
      };
    }

    const encryptedPayload = await encryptSharePayload(
      share.shareKey,
      packed.payload
    );

    await publishPublicSharePayload(share.shareId, {
      encryptedPayload,
      etag: packed.payloadHash,
      assetGrants: packed.assetGrants,
    });

    const lastPublishedAt = now();

    const next = {
      ...share,
      status: 'up-to-date',
      lastPublishedAt,
      lastPayloadHash: packed.payloadHash,
      missingAssets: packed.missingAssets || [],
      lastError: '',
    };

    await saveLocalPublicShareState(noteId, next);
    await saveNotePublicShareCache(noteId, {
      enabled: true,
      shareId: share.shareId,
      expiresAt: share.expiresAt || expiresAt || null,
      lastPublishedAt,
    });

    emitPublicShareChanged(noteId, 'up-to-date');

    window.dispatchEvent(new CustomEvent('yanta-public-share-status', {
      detail: {
        noteId,
        status: 'up-to-date',
      },
    }));

    return {
      share: next,
      missingAssets: packed.missingAssets,
    };
  })()
    .catch(async (err) => {
      await saveLocalPublicShareState(noteId, {
        status: 'failed',
        lastError: err?.message || String(err),
      });

      window.dispatchEvent(new CustomEvent('yanta-public-share-status', {
        detail: {
          noteId,
          status: 'failed',
          error: err?.message || String(err),
        },
      }));

      throw err;
    })
    .finally(() => {
      publishing.delete(noteId);
    });

  publishing.set(noteId, promise);

  return promise;
}

export function schedulePublicSharePublish(noteId, {
  delay = 12000,
} = {}) {
  const share = publicShareStateForNote(noteId);

  if (!share?.shareId || !share?.shareKey) return;

  clearTimeout(timers.get(noteId));

  saveLocalPublicShareState(noteId, {
    status: 'pending',
  }).catch(() => {});

  timers.set(
    noteId,
    window.setTimeout(() => {
      publishPublicShareNow(noteId).catch((err) => {
        console.warn('[YANTA Public Share] auto publish failed', err);
      });
    }, delay)
  );
}

export async function stopPublicShare(noteId) {
  const share = publicShareStateForNote(noteId);

  if (!share?.shareId) {
    return;
  }

  await stopPublicShareById(share.shareId, {
    noteId,
    showToast: true,
  });
}

export function setupPublicShareAutoPublisher() {
window.addEventListener('yanta-note-updated', (e) => {
  const detail = e.detail || {};
  const source = String(detail.source || '');
  const reason = String(detail.reason || '');

  // Eigene Public-Share-Statusupdates nie wieder als Note-Änderung behandeln.
  if (source === 'public-share') return;
  if (reason === 'public-share-status') return;

  const noteId = detail.noteId || state.currentNoteId;
    if (!noteId) return;

    const share = publicShareStateForNote(noteId);
    if (!share?.shareId || !share?.shareKey || share.status === 'revoked') return;

    if (navigator.onLine === false) {
      saveLocalPublicShareState(noteId, {
        status: 'pending',
      }).catch(() => {});
      return;
    }

    schedulePublicSharePublish(noteId);
  });

  window.addEventListener('online', () => {
    for (const [noteId, share] of Object.entries(readLocalState())) {
      if (share?.shareId && share?.shareKey && share.status !== 'revoked') {
        schedulePublicSharePublish(noteId, {
          delay: 1500,
        });
      }
    }
  });
  refreshOwnPublicShareStatusFromCloud().catch(() => {});

  window.addEventListener('focus', () => {
    refreshOwnPublicShareStatusFromCloud().catch(() => {});
  });
}
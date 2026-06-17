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

  note.updated = now();

  await store.notes.put(note);
}

function emitPublicShareChanged(noteId, status = '') {
  window.dispatchEvent(new CustomEvent('yanta-public-share-status', {
    detail: {
      noteId,
      status,
    },
  }));

  window.dispatchEvent(new CustomEvent('yanta-note-updated', {
    detail: {
      noteId,
      reason: 'public-share-status',
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

  if (existing.shareId && existing.shareKey) {
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

  await deletePublicShare(share.shareId);

  await saveLocalPublicShareState(noteId, {
    enabled: false,
    status: 'revoked',
    revokedAt: now(),
  });

  const note = state.notes.get(noteId);

  if (note?.publicShare) {
    note.publicShare = {
      ...note.publicShare,
      enabled: false,
      revokedAt: now(),
    };

    note.updated = now();
    await store.notes.put(note);
    emitPublicShareChanged(noteId, 'revoked');
  }

  toast('Public sharing stopped', 'success');

  window.dispatchEvent(new CustomEvent('yanta-public-share-status', {
    detail: {
      noteId,
      status: 'revoked',
    },
  }));
}

export function setupPublicShareAutoPublisher() {
  window.addEventListener('yanta-note-updated', (e) => {
    const noteId = e.detail?.noteId || state.currentNoteId;
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
}
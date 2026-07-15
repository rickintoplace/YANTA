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

export const PUBLIC_SHARE_BRANDING_SETTING = 'publicShare.showBranding';

/*
  "Made with YANTA" badge on public pages.
  Default: shown. Hiding is a YANTA Plus perk, enforced at publish time —
  the payload is end-to-end encrypted, so the server cannot enforce it.
*/
export async function shouldHidePublicShareBranding(me) {
  const isPlus = String(me?.user?.plan || 'free') === 'premium';
  if (!isPlus) return false;

  const showBranding = await store.settings.get(PUBLIC_SHARE_BRANDING_SETTING, true);

  return showBranding === false;
}

let timers = new Map();
let publishing = new Map();
let lastOwnPublicShareCloudRefreshAt = 0;

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
  const noteShare = note?.publicShare || {};
  const local = readLocalState()[noteId] || {};

  const merged = {
    ...noteShare,
    ...local,
  };

  return {
    ...merged,
    cloudOnly: !!(merged.shareId || merged.id) && !merged.shareKey,
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
      changed: 0,
      reason: err?.message || String(err),
    };
  }

  const shares = Array.isArray(res?.shares) ? res.shares : [];
  const all = readLocalState();

  let changed = 0;

  const comparableState = (share = {}) => ({
    enabled: share.enabled !== false,
    shareId: String(share.shareId || share.id || ''),
    status: String(share.status || ''),
    expiresAt: share.expiresAt || share.expires_at || null,
    revokedAt: share.revokedAt || share.revoked_at || null,
    deletedAt: share.deletedAt || share.deleted_at || null,
    lastPublishedAt: share.lastPublishedAt || share.last_published_at || null,
    cloudOnly: !!share.cloudOnly,
  });

  const sameComparableState = (a, b) => {
    const aa = comparableState(a);
    const bb = comparableState(b);

    return (
      aa.enabled === bb.enabled &&
      aa.shareId === bb.shareId &&
      aa.status === bb.status &&
      aa.expiresAt === bb.expiresAt &&
      aa.revokedAt === bb.revokedAt &&
      aa.deletedAt === bb.deletedAt &&
      aa.lastPublishedAt === bb.lastPublishedAt &&
      aa.cloudOnly === bb.cloudOnly
    );
  };

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

    const prev = {
      ...(state.notes.get(noteId)?.publicShare || {}),
      ...(all[noteId] || {}),
    };

    if (active) {
      const next = {
        ...prev,

        enabled: true,
        shareId,

        /*
          Wenn der private shareKey auf diesem Gerät nicht vorhanden ist,
          kann YANTA den Link nicht neu zusammensetzen, aber der Indikator
          und "Stop sharing" sollen trotzdem funktionieren.
        */
        cloudOnly: !prev.shareKey,

        /*
          Lokale Publish-Zustände nicht unnötig überschreiben.
          Wichtig: Dadurch wird aus "pending"/"failed" nicht bei jedem
          Cloud-Refresh wieder "up-to-date".
        */
        status: prev.shareKey
          ? (
              prev.status &&
              !['active', 'revoked', 'deleted'].includes(String(prev.status))
                ? prev.status
                : 'up-to-date'
            )
          : 'active',

        expiresAt: raw.expiresAt || raw.expires_at || prev.expiresAt || null,
        lastPublishedAt:
          raw.lastPublishedAt ||
          raw.last_published_at ||
          prev.lastPublishedAt ||
          null,

        /*
          Cloud sagt: aktiv.
          Also dürfen alte lokale terminal flags aus einem früheren Share-Lifecycle
          den aktuellen Share nicht mehr als inaktiv markieren.
        */
        revokedAt: null,
        revoked_at: null,
        deletedAt: null,
        deleted_at: null,
      };

      if (!sameComparableState(prev, next)) {
        all[noteId] = {
          ...next,
          updatedAt: now(),
        };

        changed++;
        emitPublicShareChanged(noteId, all[noteId].status);
      }

      continue;
    }

    /*
      Cloud sagt: diese Share ist nicht mehr aktiv.
      Nur dann lokalen Zustand ändern/emittieren, wenn sie lokal noch
      als aktiv bekannt war.
    */
    if (
      String(prev.shareId || '') === shareId &&
      isPublicShareActive(prev)
    ) {
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
        status: 'revoked',
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

async function saveLocalPublicShareState(noteId, patch, {
  replace = false,
} = {}) {
  const all = readLocalState();

  all[noteId] = {
    ...(replace ? {} : (all[noteId] || {})),
    ...patch,
    updatedAt: now(),
  };

  writeLocalState(all);
}

async function saveNotePublicShareCache(noteId, patch, {
  replace = false,
} = {}) {
  const note = state.notes.get(noteId);
  if (!note) return;

  note.publicShare = {
    ...(replace ? {} : (note.publicShare || {})),
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
    Nur wirklich aktive Shares mit lokal verfügbarem private shareKey wiederverwenden.

    Wichtig:
    Ein Share mit altem revokedAt/deletedAt darf nie wiederverwendet werden.
    Sonst erstellt die Cloud zwar ggf. etwas, aber die lokale UI hält den Share
    wegen revokedAt weiterhin für inaktiv.
  */
  if (
    existing.shareId &&
    existing.shareKey &&
    isPublicShareActive(existing)
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

    /*
      Zero-knowledge:
      Der Server kennt den alten private shareKey nicht. Deshalb darf Create
      nicht still einen bestehenden Cloud-Share wiederverwenden.
    */
    reuseActive: false,
  });

  /*
    Defensive guard for older/unpatched backends:
    Alte Worker-Versionen konnten trotz neuem shareKey einen bestehenden
    shareId zurückgeben. Würden wir damit publishen, würden alte Links mit
    altem #k= brechen. Also lieber hart abbrechen statt Zero-Knowledge-Link
    zu beschädigen.
  */
  if (created.share?.existing === true) {
    throw new Error(
      'Cloud returned an existing public link without the original private key. Please update YANTA Cloud and try again.'
    );
  }

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
    lastError: '',
    missingAssets: [],
    cloudOnly: false,

    /*
      Wichtig:
      Re-sharing ist ein neuer Lifecycle. Alte revoked/deleted Flags müssen
      vollständig verschwinden, sonst bleibt isPublicShareActive() false.
    */
    revokedAt: null,
    revoked_at: null,
    deletedAt: null,
    deleted_at: null,
  };

  await saveLocalPublicShareState(noteId, patch, {
    replace: true,
  });

  await saveNotePublicShareCache(noteId, patch, {
    replace: true,
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
    const { engine, me } = await assertPublicSharePrereqs();

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
      hideBranding: await shouldHidePublicShareBranding(me),
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

      enabled: true,
      cloudOnly: false,

      revokedAt: null,
      revoked_at: null,
      deletedAt: null,
      deleted_at: null,

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
      shareKey: share.shareKey,
      url: share.url || makePublicShareUrl(share.shareId, share.shareKey),
      status: 'up-to-date',
      expiresAt: share.expiresAt || expiresAt || null,
      lastPublishedAt,
      lastPayloadHash: packed.payloadHash,

      cloudOnly: false,
      revokedAt: null,
      revoked_at: null,
      deletedAt: null,
      deleted_at: null,
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
  const refreshOwnPublicSharesThrottled = ({
    force = false,
  } = {}) => {
    const t = now();

    if (!force && t - lastOwnPublicShareCloudRefreshAt < 60_000) {
      return;
    }

    lastOwnPublicShareCloudRefreshAt = t;

    refreshOwnPublicShareStatusFromCloud().catch(() => {});
  };

  refreshOwnPublicSharesThrottled({
    force: true,
  });

  window.addEventListener('focus', () => {
    refreshOwnPublicSharesThrottled();
  });
}
// ============================================================
// YANTA — sign out and remove everything from this device
//
// For a borrowed or shared computer: after this, nothing of the
// workspace is left in the browser — notes, drawings, calendar, chats,
// feeds, keys, settings, offline copies. With sync on, the workspace is
// still in the cloud (encrypted) and comes back on any device with the
// Recovery Kit. Without sync, what was only here is gone: the dialog
// says so before anything happens.
// ============================================================

import { t } from '../i18n/index.js';

/** Last push of local changes before the data goes, if sync is set up. */
async function finalSync() {
  try {
    if (typeof window.yantaSync2Now !== 'function') return false;
    await Promise.race([
      window.yantaSync2Now({ interactive: false, catchUp: false }),
      new Promise((resolve) => setTimeout(resolve, 20_000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function deleteDatabase(name) {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/**
 * Removes every trace of the workspace from this browser and reloads.
 * `syncFirst` tries to upload pending changes before deleting.
 */
export async function wipeThisDevice({ syncFirst = true } = {}) {
  if (syncFirst) await finalSync();

  // Other open tabs hold the databases open (blocking the delete) and could
  // write again: they reload into an empty app instead.
  try { new BroadcastChannel('yanta-lock').postMessage({ type: 'wiped' }); } catch {}

  // The cloud session ends on the server too, not just in this browser.
  try {
    const { cloudLogout } = await import('../cloud/cloud-api.js');
    await cloudLogout();
  } catch {}

  // Every database this origin created (notes, Y.Docs, sync state, feeds, chat, embeddings …).
  try {
    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    await Promise.all(dbs.map((db) => db.name && deleteDatabase(db.name)));
  } catch {}

  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}

  try {
    for (const key of await caches.keys()) await caches.delete(key);
  } catch {}

  try {
    for (const reg of await navigator.serviceWorker?.getRegistrations?.() || []) await reg.unregister();
  } catch {}

  location.replace('/');
}

/** Settings path: confirm (with the honest warning), then wipe. */
export async function confirmAndWipeThisDevice() {
  const { yantaConfirm } = await import('../dialogs.js');
  const synced = typeof window.yantaSync2Now === 'function' && !!window.yantaSync2?.engine;

  const ok = await yantaConfirm({
    title: t('lock.wipeTitle'),
    message: synced ? t('lock.wipeMessageSynced') : t('lock.wipeMessageLocal'),
    confirmLabel: t('lock.wipeConfirm'),
    danger: true,
  });

  if (!ok) return false;

  await wipeThisDevice();
  return true;
}

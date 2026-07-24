// ============================================================
// YANTA — Web Share Target inbox (app side)
//
// Reads (and clears) the payload the service worker stashed when the OS
// share sheet posted to /share-target. Mirrors the DB name/store/key
// constants in public/sw.js — keep the two in sync (the SW is a classic
// worker and can't import this module).
// ============================================================

const SHARE_DB = 'yanta-share';
const SHARE_STORE = 'inbox';
const SHARE_KEY = 'pending';

function openShareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_STORE)) {
        req.result.createObjectStore(SHARE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns the pending shared payload and deletes it (consume-once), or null.
 * @returns {Promise<null | {title:string,text:string,url:string,files:File[],ts:number}>}
 */
export async function readAndClearPendingShare() {
  let db;
  try {
    db = await openShareDb();
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let payload = null;
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    const store = tx.objectStore(SHARE_STORE);

    const getReq = store.get(SHARE_KEY);
    getReq.onsuccess = () => {
      payload = getReq.result || null;
      store.delete(SHARE_KEY);
    };

    tx.oncomplete = () => resolve(payload);
    tx.onerror = () => resolve(payload);
  });
}

// ============================================================
// YANTA Sync2 — RemoteObjectStore interface + path helpers
//
// This is the provider-independent storage abstraction used by the
// new sync engine. Implementations can be:
// - MemoryObjectStore          debug/tests
// - IndexedDBObjectStore       fake persistent cloud
// - BrokerObjectStore          Google/Dropbox/OneDrive via YANTA broker
// - WebDAVObjectStore          advanced
// - FolderObjectStore          advanced
// ============================================================

export class RemoteObjectStore {
  async init() {}

  /**
   * List all remote objects below prefix.
   *
   * @param {string} prefix
   * @returns {Promise<Array<{ path:string, size:number, updated:number, etag?:string }>>}
   */
  async list(prefix = '') {
    throw new Error('RemoteObjectStore.list() not implemented');
  }

  /**
   * Get object bytes.
   *
   * @param {string} path
   * @returns {Promise<Uint8Array>}
   */
  async get(path) {
    throw new Error('RemoteObjectStore.get() not implemented');
  }

  /**
   * Put object bytes.
   *
   * @param {string} path
   * @param {Uint8Array|ArrayBuffer|Blob|string} data
   * @param {object} options
   */
  async put(path, data, options = {}) {
    throw new Error('RemoteObjectStore.put() not implemented');
  }

  /**
   * Delete object if present.
   *
   * @param {string} path
   */
  async delete(path) {
    throw new Error('RemoteObjectStore.delete() not implemented');
  }

  /**
   * Return metadata or null.
   *
   * @param {string} path
   * @returns {Promise<{ path:string, size:number, updated:number, etag?:string } | null>}
   */
  async stat(path) {
    throw new Error('RemoteObjectStore.stat() not implemented');
  }
}

export function normalizeRemotePath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\.\.(\/|$)/g, '')
    .trim();
}

export function joinRemotePath(...parts) {
  return normalizeRemotePath(
    parts
      .filter((p) => p != null && String(p).trim() !== '')
      .map((p) => String(p))
      .join('/')
  );
}

export function assertSafeRemotePath(path) {
  const p = normalizeRemotePath(path);

  if (!p) {
    throw new Error('Remote path must not be empty');
  }

  if (p.includes('\0')) {
    throw new Error('Remote path contains NUL byte');
  }

  if (p.startsWith('../') || p.includes('/../')) {
    throw new Error('Remote path must not contain .. segments');
  }

  return p;
}

export async function bytesFromData(data) {
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }

  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }

  throw new Error('Unsupported object data type');
}

export function remoteEntrySort(a, b) {
  return String(a.path).localeCompare(String(b.path));
}
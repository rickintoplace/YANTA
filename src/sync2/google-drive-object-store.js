// ============================================================
// YANTA Sync2 — GoogleDriveObjectStore
//
// Direct browser Google Drive backend using appDataFolder.
// Google only sees encrypted object blobs.
//
// Scope:
//   https://www.googleapis.com/auth/drive.appdata
// ============================================================

import {
    RemoteObjectStore,
    assertSafeRemotePath,
    normalizeRemotePath,
    bytesFromData,
    remoteEntrySort,
  } from './object-store.js';
  
  import {
    base64UrlEncode,
    base64UrlDecode,
    utf8Encode,
    utf8Decode,
  } from './crypto.js';
  
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  
  const FILE_PREFIX = 'yantaobj_';
  
  let gisLoadPromise = null;
  
  function loadScript(src) {
    if (gisLoadPromise) return gisLoadPromise;
  
    gisLoadPromise = new Promise((resolve, reject) => {
      if ([...document.scripts].some((s) => s.src === src)) {
        resolve();
        return;
      }
  
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load script: ${src}`));
      document.head.append(s);
    });
  
    return gisLoadPromise;
  }
  
  function driveFileNameForPath(path) {
    return FILE_PREFIX + base64UrlEncode(utf8Encode(path));
  }
  
  function pathFromDriveFileName(name) {
    if (!String(name || '').startsWith(FILE_PREFIX)) return null;
  
    try {
      return utf8Decode(base64UrlDecode(String(name).slice(FILE_PREFIX.length)));
    } catch {
      return null;
    }
  }
  
  function escapeDriveQueryString(s) {
    return String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  }
  
  function makeEtag(file) {
    return file.md5Checksum || `${file.size || 0}-${file.modifiedTime || ''}`;
  }
  
  async function responseError(res, fallback) {
    let msg = fallback;
  
    try {
      const json = await res.json();
      msg = json?.error?.message || json?.message || msg;
    } catch {
      try {
        msg = await res.text();
      } catch {}
    }
  
    const err = new Error(`${fallback}: ${res.status} ${msg}`);
    err.status = res.status;
  
    return err;
  }
  
  function timeout(ms, message) {
    return new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }
  
  export class GoogleDriveObjectStore extends RemoteObjectStore {
    constructor({
      clientId,
      initialPrompt = '',
      tokenClient = null,
    } = {}) {
      super();
  
      if (!clientId) {
        throw new Error('Google clientId required');
      }
  
      this.clientId = clientId;
      this.initialPrompt = initialPrompt;
      this.tokenClient = tokenClient;
      this.accessToken = '';
      this.ready = false;
    }
  
    async init() {
      if (this.ready) return;
  
      await loadScript(GIS_SRC);
  
      if (!globalThis.google?.accounts?.oauth2) {
        throw new Error('Google Identity Services not available');
      }
  
      if (!this.tokenClient) {
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: SCOPE,
          callback: () => {},
        });
      }
  
      await this.ensureToken({
        prompt: this.initialPrompt,
      });
  
      this.ready = true;
    }
  
    async connectInteractive() {
      this.accessToken = '';
      await this.ensureToken({
        prompt: 'consent',
      });
      this.ready = true;
    }
  
    async ensureToken({ prompt = '' } = {}) {
      if (this.accessToken) return this.accessToken;
  
      await loadScript(GIS_SRC);
  
      if (!globalThis.google?.accounts?.oauth2) {
        throw new Error('Google Identity Services not available');
      }
  
      if (!this.tokenClient) {
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: SCOPE,
          callback: () => {},
        });
      }
  
      const tokenPromise = new Promise((resolve, reject) => {
        this.tokenClient.callback = (res) => {
          if (res?.error) {
            reject(new Error(res.error_description || res.error));
            return;
          }
  
          if (!res?.access_token) {
            reject(new Error('Google access token missing'));
            return;
          }
  
          this.accessToken = res.access_token;
          resolve(this.accessToken);
        };
  
        this.tokenClient.requestAccessToken({
          prompt,
        });
      });
  
      return Promise.race([
        tokenPromise,
        timeout(90_000, 'Google login timed out or was blocked by the browser.'),
      ]);
    }
  
    async api(url, options = {}, retry = true) {
      await this.ensureToken();
  
      const res = await fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          authorization: `Bearer ${this.accessToken}`,
        },
      });
  
      if (res.status === 401 && retry) {
        this.accessToken = '';
        await this.ensureToken({ prompt: '' });
        return this.api(url, options, false);
      }
  
      return res;
    }
  
    fileQueryForPath(path) {
      const p = assertSafeRemotePath(path);
      const name = driveFileNameForPath(p);
  
      return [
        `name = '${escapeDriveQueryString(name)}'`,
        `trashed = false`,
        `appProperties has { key='yantaSync' and value='1' }`,
      ].join(' and ');
    }
  
    async findFilesByPath(path) {
      const q = this.fileQueryForPath(path);
  
      const url = new URL(DRIVE_API + '/files');
      url.searchParams.set('spaces', 'appDataFolder');
      url.searchParams.set('q', q);
      url.searchParams.set('fields', 'files(id,name,size,modifiedTime,md5Checksum)');
      url.searchParams.set('pageSize', '10');
  
      const res = await this.api(url.href);
  
      if (!res.ok) {
        throw await responseError(res, 'Google Drive query failed');
      }
  
      const json = await res.json();
  
      return json.files || [];
    }
  
    async findFile(path) {
      const files = await this.findFilesByPath(path);
  
      if (!files.length) return null;
  
      files.sort((a, b) =>
        String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || ''))
      );
  
      return files[0];
    }
  
    async list(prefix = '') {
      await this.init();
  
      const cleanPrefix = normalizeRemotePath(prefix);
  
      const out = [];
      let pageToken = '';
  
      do {
        const url = new URL(DRIVE_API + '/files');
  
        url.searchParams.set('spaces', 'appDataFolder');
        url.searchParams.set(
          'q',
          `trashed = false and appProperties has { key='yantaSync' and value='1' }`
        );
        url.searchParams.set(
          'fields',
          'nextPageToken,files(id,name,size,modifiedTime,md5Checksum)'
        );
        url.searchParams.set('pageSize', '1000');
  
        if (pageToken) {
          url.searchParams.set('pageToken', pageToken);
        }
  
        const res = await this.api(url.href);
  
        if (!res.ok) {
          throw await responseError(res, 'Google Drive list failed');
        }
  
        const json = await res.json();
  
        for (const f of json.files || []) {
          const path = pathFromDriveFileName(f.name);
  
          if (!path) continue;
          if (cleanPrefix && !path.startsWith(cleanPrefix)) continue;
  
          out.push({
            path,
            size: Number(f.size || 0),
            updated: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
            etag: makeEtag(f),
          });
        }
  
        pageToken = json.nextPageToken || '';
      } while (pageToken);
  
      return out.sort(remoteEntrySort);
    }
  
    /**
     * Robust admin helper:
     * lists all YANTA-created Drive files by appProperties, regardless of path decode.
     */
    async listAllYantaFiles() {
      await this.init();
  
      const out = [];
      let pageToken = '';
  
      do {
        const url = new URL(DRIVE_API + '/files');
  
        url.searchParams.set('spaces', 'appDataFolder');
        url.searchParams.set(
          'q',
          `trashed = false and appProperties has { key='yantaSync' and value='1' }`
        );
        url.searchParams.set(
          'fields',
          'nextPageToken,files(id,name,size,modifiedTime,md5Checksum,appProperties)'
        );
        url.searchParams.set('pageSize', '1000');
  
        if (pageToken) {
          url.searchParams.set('pageToken', pageToken);
        }
  
        const res = await this.api(url.href);
  
        if (!res.ok) {
          throw await responseError(res, 'Google Drive list-all failed');
        }
  
        const json = await res.json();
  
        for (const f of json.files || []) {
          out.push({
            id: f.id,
            name: f.name,
            path: pathFromDriveFileName(f.name),
            size: Number(f.size || 0),
            updated: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
            etag: makeEtag(f),
            appProperties: f.appProperties || {},
          });
        }
  
        pageToken = json.nextPageToken || '';
      } while (pageToken);
  
      out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  
      return out;
    }
  
    async deleteFileId(fileId) {
      await this.init();
  
      if (!fileId) return;
  
      const res = await this.api(
        DRIVE_API + `/files/${encodeURIComponent(fileId)}`,
        {
          method: 'DELETE',
        }
      );
  
      if (!res.ok && res.status !== 404) {
        throw await responseError(res, 'Google Drive delete-by-id failed');
      }
    }
  
    async deleteAllYantaFiles({ onProgress = null } = {}) {
      const files = await this.listAllYantaFiles();
  
      let deleted = 0;
  
      for (const file of files) {
        await this.deleteFileId(file.id);
        deleted++;
  
        onProgress?.({
          deleted,
          total: files.length,
          file,
        });
      }
  
      return {
        total: files.length,
        deleted,
        files,
      };
    }
  
    async get(path) {
      await this.init();
  
      const p = assertSafeRemotePath(path);
      const file = await this.findFile(p);
  
      if (!file) {
        const err = new Error(`Remote object not found: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
  
      const res = await this.api(
        DRIVE_API + `/files/${encodeURIComponent(file.id)}?alt=media`
      );
  
      if (!res.ok) {
        throw await responseError(res, 'Google Drive get failed');
      }
  
      return new Uint8Array(await res.arrayBuffer());
    }
  
    async put(path, data, options = {}) {
      await this.init();
  
      const p = assertSafeRemotePath(path);
      const bytes = await bytesFromData(data);
  
      const existing = await this.findFile(p);
  
      if (options.ifAbsent && existing) {
        const err = new Error(`Remote object already exists: ${p}`);
        err.code = 'EEXIST';
        throw err;
      }
  
      if (existing && !options.ifAbsent) {
        const res = await this.api(
          DRIVE_UPLOAD + `/files/${encodeURIComponent(existing.id)}?uploadType=media`,
          {
            method: 'PATCH',
            headers: {
              'content-type': 'application/octet-stream',
            },
            body: bytes,
          }
        );
  
        if (!res.ok) {
          throw await responseError(res, 'Google Drive update failed');
        }
  
        return;
      }
  
      const metadata = {
        name: driveFileNameForPath(p),
        parents: ['appDataFolder'],
        appProperties: {
          yantaSync: '1',
          yantaSyncVersion: '1',
        },
      };
  
      const boundary = 'yanta_' + crypto.randomUUID().replace(/-/g, '');
  
      const body = new Blob([
        `--${boundary}\r\n`,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\n`,
        'Content-Type: application/octet-stream\r\n\r\n',
        bytes,
        `\r\n--${boundary}--`,
      ]);
  
      const res = await this.api(
        DRIVE_UPLOAD + '/files?uploadType=multipart&fields=id,name,size,modifiedTime,md5Checksum',
        {
          method: 'POST',
          headers: {
            'content-type': `multipart/related; boundary=${boundary}`,
          },
          body,
        }
      );
  
      if (!res.ok) {
        throw await responseError(res, 'Google Drive create failed');
      }
    }
  
    async delete(path) {
      await this.init();
  
      const p = assertSafeRemotePath(path);
      const files = await this.findFilesByPath(p);
  
      for (const file of files) {
        await this.deleteFileId(file.id);
      }
    }
  
    async stat(path) {
      await this.init();
  
      const p = assertSafeRemotePath(path);
      const file = await this.findFile(p);
  
      if (!file) return null;
  
      return {
        path: p,
        size: Number(file.size || 0),
        updated: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
        etag: makeEtag(file),
      };
    }
  }
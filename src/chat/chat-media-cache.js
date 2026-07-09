// ============================================================
// YANTA Chat — Persistent media Blob cache + storage policy
//
// Warum:
// Matrix E2EE media cannot be server-filtered or server-thumbnailed reliably.
// A local Blob cache keeps Gallery UX instant while preserving zero-knowledge.
// ============================================================

import {
    fmtBytes,
    toast,
  } from '../core.js';
  
  import {
    chatStore,
  } from './chat-store.js';
  
  export const CHAT_MEDIA_CACHE_LIMIT_SETTING = 'chat.mediaCache.limitBytes';
  
  export const CHAT_MEDIA_CACHE_LIMITS = [
    {
      label: '200 MB',
      bytes: 200 * 1024 * 1024,
    },
    {
      label: '500 MB',
      bytes: 500 * 1024 * 1024,
    },
    {
      label: '1 GB',
      bytes: 1024 * 1024 * 1024,
    },
  ];
  
  const DEFAULT_MEDIA_CACHE_LIMIT_BYTES = 500 * 1024 * 1024;
  
  function reportCacheError(message, err) {
    console.warn('[YANTA Chat Media Cache]', err);
    toast(message || 'Media cache error.', 'error');
  }
  
  function encryptedFileFingerprint(encryptedFile = null) {
    if (!encryptedFile) return '';
  
    return [
      encryptedFile.v || '',
      encryptedFile.iv || '',
      encryptedFile.hashes?.sha256 || '',
      encryptedFile.key?.alg || '',
      encryptedFile.key?.kid || '',
      encryptedFile.key?.k || '',
    ].join(':');
  }
  
  /**
   * Builds the stable persistent cache key for Matrix media.
   */
  export function chatMediaCacheKey(mxcUrl, {
    thumbnail = true,
    w = 96,
    h = 96,
    encryptedFile = null,
  } = {}) {
    return [
      String(mxcUrl || ''),
      thumbnail ? 'thumb' : 'download',
      Math.round(Number(w || 0)),
      Math.round(Number(h || 0)),
      encryptedFileFingerprint(encryptedFile),
    ].join('|');
  }
  
  /**
   * Returns the configured media-cache limit in bytes.
   */
  export async function getChatMediaCacheLimitBytes() {
    try {
      const value = await chatStore.settings.get(
        CHAT_MEDIA_CACHE_LIMIT_SETTING,
        DEFAULT_MEDIA_CACHE_LIMIT_BYTES
      );
  
      const n = Number(value || 0);
  
      return n > 0 ? n : DEFAULT_MEDIA_CACHE_LIMIT_BYTES;
    } catch (err) {
      reportCacheError('Could not read media cache policy.', err);
      return DEFAULT_MEDIA_CACHE_LIMIT_BYTES;
    }
  }
  
  /**
   * Stores the configured media-cache limit in bytes and enforces LRU.
   */
  export async function setChatMediaCacheLimitBytes(bytes) {
    try {
      const clean = Number(bytes || DEFAULT_MEDIA_CACHE_LIMIT_BYTES);
  
      await chatStore.settings.set(CHAT_MEDIA_CACHE_LIMIT_SETTING, clean);
      await enforceChatMediaCacheLimit();
  
      return clean;
    } catch (err) {
      reportCacheError('Could not update media cache policy.', err);
      throw err;
    }
  }
  
  /**
   * Reads a Blob from persistent media cache.
   */
  export async function getCachedChatMediaBlob(id) {
    try {
      const row = await chatStore.mediaCache.get(id, null);
  
      if (!row?.blob) return null;
  
      row.lastAccessedAt = Date.now();
      await chatStore.mediaCache.put(row);
  
      return row.blob;
    } catch (err) {
      reportCacheError('Could not read media cache.', err);
      return null;
    }
  }
  
  /**
   * Writes a Blob into persistent media cache.
   */
  export async function putCachedChatMediaBlob(id, blob, {
    roomId = '',
    mxcUrl = '',
    mime = '',
  } = {}) {
    if (!id || !blob) return null;
  
    try {
      const now = Date.now();
  
      const row = {
        id,
        roomId: String(roomId || ''),
        mxcUrl: String(mxcUrl || ''),
        mime: mime || blob.type || 'application/octet-stream',
        size: Number(blob.size || 0),
        blob,
        createdAt: now,
        lastAccessedAt: now,
      };
  
      await chatStore.mediaCache.put(row);
  
      /*
        Warum:
        IndexedDB quota errors can happen later and differ by browser.
        We enforce LRU after every write to keep usage predictable.
      */
      await enforceChatMediaCacheLimit();
  
      return row;
    } catch (err) {
      reportCacheError('Could not write media cache.', err);
  
      try {
        await enforceChatMediaCacheLimit({
          aggressive: true,
        });
      } catch (innerErr) {
        reportCacheError('Could not free media cache space.', innerErr);
      }
  
      return null;
    }
  }
  
  /**
   * Returns total and per-room media-cache usage.
   */
  export async function getChatMediaCacheUsage() {
    try {
      const rows = await chatStore.mediaCache.all();
      const byRoom = new Map();
      let totalBytes = 0;
      let count = 0;
  
      for (const row of rows) {
        const size = Number(row?.size || row?.blob?.size || 0);
        const roomId = String(row?.roomId || '');
  
        totalBytes += size;
        count += 1;
  
        if (!byRoom.has(roomId)) {
          byRoom.set(roomId, {
            roomId,
            bytes: 0,
            count: 0,
          });
        }
  
        const bucket = byRoom.get(roomId);
  
        bucket.bytes += size;
        bucket.count += 1;
      }
  
      return {
        totalBytes,
        count,
        byRoom: [...byRoom.values()].sort((a, b) => b.bytes - a.bytes),
      };
    } catch (err) {
      reportCacheError('Could not calculate media cache usage.', err);
  
      return {
        totalBytes: 0,
        count: 0,
        byRoom: [],
      };
    }
  }
  
  /**
   * Purges all media cache entries for one room.
   */
  export async function purgeChatMediaCacheForRoom(roomId) {
    try {
      const id = String(roomId || '');
      const rows = await chatStore.mediaCache.all();
      const targets = rows.filter((row) => String(row.roomId || '') === id);
  
      await Promise.all(targets.map((row) => chatStore.mediaCache.del(row.id)));
  
      return {
        deleted: targets.length,
        bytes: targets.reduce((sum, row) => sum + Number(row.size || 0), 0),
      };
    } catch (err) {
      reportCacheError('Could not clear this chat media cache.', err);
      throw err;
    }
  }
  
  /**
   * Purges the complete media Blob cache.
   */
  export async function purgeAllChatMediaCache() {
    try {
      const usage = await getChatMediaCacheUsage();
  
      await chatStore.mediaCache.clear();
  
      return {
        deleted: usage.count,
        bytes: usage.totalBytes,
      };
    } catch (err) {
      reportCacheError('Could not clear media cache.', err);
      throw err;
    }
  }
  
  /**
   * Purges cache entries belonging to one Gallery item.
   */
  export async function purgeChatMediaCacheForItem(item = {}) {
    try {
      const mxcUrls = new Set([
        item.mxcUrl,
        item.thumbnailMxcUrl,
      ].filter(Boolean).map(String));
  
      if (!mxcUrls.size) return {
        deleted: 0,
        bytes: 0,
      };
  
      const rows = await chatStore.mediaCache.all();
      const targets = rows.filter((row) => mxcUrls.has(String(row.mxcUrl || '')));
  
      await Promise.all(targets.map((row) => chatStore.mediaCache.del(row.id)));
  
      return {
        deleted: targets.length,
        bytes: targets.reduce((sum, row) => sum + Number(row.size || 0), 0),
      };
    } catch (err) {
      reportCacheError('Could not purge media item cache.', err);
      throw err;
    }
  }
  
  /**
   * Enforces the current media-cache limit with LRU eviction.
   */
  export async function enforceChatMediaCacheLimit({
    aggressive = false,
  } = {}) {
    try {
      const limit = await getChatMediaCacheLimitBytes();
      const rows = await chatStore.mediaCache.all();
  
      let total = rows.reduce((sum, row) => sum + Number(row.size || row.blob?.size || 0), 0);
  
      if (total <= limit && !aggressive) {
        return {
          evicted: 0,
          bytes: 0,
          totalBytes: total,
          limitBytes: limit,
        };
      }
  
      const target = aggressive
        ? Math.floor(limit * 0.75)
        : limit;
  
      const sorted = rows
        .slice()
        .sort((a, b) => Number(a.lastAccessedAt || 0) - Number(b.lastAccessedAt || 0));
  
      let evicted = 0;
      let bytes = 0;
  
      for (const row of sorted) {
        if (total <= target) break;
  
        const size = Number(row.size || row.blob?.size || 0);
  
        await chatStore.mediaCache.del(row.id);
  
        total -= size;
        bytes += size;
        evicted += 1;
      }
  
      if (evicted > 0) {
        console.info('[YANTA Chat] Media cache LRU eviction', {
          evicted,
          bytes: fmtBytes(bytes),
          limit: fmtBytes(limit),
        });
      }
  
      return {
        evicted,
        bytes,
        totalBytes: total,
        limitBytes: limit,
      };
    } catch (err) {
      reportCacheError('Could not enforce media cache limit.', err);
      throw err;
    }
  }
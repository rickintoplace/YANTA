// ============================================================
// YANTA — people avatars
//
// One way to draw a person across the app: an overlapping avatar stack
// (dashboard cards) and the single circles it is built from.
//
// Pictures come from Matrix, which serves media only to an authenticated
// client — and that client boots late, if at all. So every avatar is
// cached as a small data URL in the settings store: the second launch
// paints real faces immediately, and until then a tinted monogram (the
// same treatment Google and Apple fall back to) stands in.
// ============================================================

import { el, store } from '../core.js';
import { peekMatrixClient } from './space-identity.js';

const CACHE_KEY = 'people.avatars.v1';

// Thumbnails are requested at 96px; anything much bigger than this is
// not a face but a mistake, and has no business in the settings store.
const MAX_CACHED_BYTES = 24 * 1024;
const MAX_CACHED_AVATARS = 24;

const memory = new Map(); // mxc -> data URL
const inFlight = new Map(); // mxc -> Promise<string>

let cacheLoad = null;
let persistTimer = null;

// ---------------- persistent picture cache ------------------------

async function loadCache() {
  if (cacheLoad) return cacheLoad;

  cacheLoad = (async () => {
    const raw = await store.settings.get(CACHE_KEY, null).catch(() => null);
    if (!raw || typeof raw !== 'object') return;

    for (const [mxc, entry] of Object.entries(raw)) {
      if (typeof entry?.url === 'string') memory.set(mxc, entry.url);
    }
  })();

  return cacheLoad;
}

function persistCacheSoon() {
  clearTimeout(persistTimer);

  persistTimer = setTimeout(() => {
    const now = Date.now();
    const payload = {};

    // Newest wins when the cache overflows — an avatar nobody has seen
    // in a while is the cheapest one to fetch again.
    for (const [mxc, url] of [...memory.entries()].slice(-MAX_CACHED_AVATARS)) {
      payload[mxc] = { url, at: now };
    }

    store.settings.set(CACHE_KEY, payload).catch(() => {});
  }, 1_500);
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('avatar read failed'));
    reader.readAsDataURL(blob);
  });
}

function isMxc(url) {
  return String(url || '').startsWith('mxc://');
}

/** Cached picture for an mxc URL, or '' — synchronous, render-safe. */
export function cachedAvatarUrl(mxc) {
  return isMxc(mxc) ? memory.get(mxc) || '' : '';
}

/**
 * Resolve (and cache) the picture behind an mxc URL. Resolves to '' when
 * chat is not running — the monogram stays, and the next render after
 * `yanta-chat-ready` picks the picture up.
 */
export async function resolveAvatarUrl(mxc) {
  if (!isMxc(mxc)) return '';

  await loadCache();

  const cached = memory.get(mxc);
  if (cached) return cached;

  const running = inFlight.get(mxc);
  if (running) return running;

  const client = peekMatrixClient();
  if (!client) return '';

  const task = (async () => {
    try {
      const { mxcToBlob } = await import('../chat/chat-media.js');

      const blob = await mxcToBlob(client, mxc, {
        thumbnail: true,
        w: 96,
        h: 96,
        silent: true,
      });

      if (!blob || blob.size > MAX_CACHED_BYTES) return '';

      const dataUrl = await blobToDataUrl(blob);

      memory.set(mxc, dataUrl);
      persistCacheSoon();

      return dataUrl;
    } catch (err) {
      console.warn('[YANTA People] avatar fetch failed', mxc, err);
      return '';
    } finally {
      inFlight.delete(mxc);
    }
  })();

  inFlight.set(mxc, task);
  return task;
}

// ---------------- presentation ------------------------------------

export function personInitials(person) {
  const name = String(person?.name || '').trim();

  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0]?.toUpperCase() || '')
    .join('');

  return initials || '?';
}

/**
 * Stable tint per identity: the same person keeps the same colour on
 * every device and in every list, which is what makes a monogram
 * recognisable at a glance.
 */
export function personHue(person) {
  const id = String(person?.id || person?.name || '');
  let hash = 0;

  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }

  return hash;
}

function paintAvatar(node, url, alt) {
  const img = el('img', { alt, loading: 'lazy', decoding: 'async' });
  img.src = url;

  node.replaceChildren(img);
  node.classList.add('has-image');
}

export function renderPersonAvatar(person, { title = '' } = {}) {
  const node = el('span', {
    class: 'yanta-person-avatar',
    title: title || person.name,
    style: { '--person-hue': String(personHue(person)) },
  }, personInitials(person));

  const cached = cachedAvatarUrl(person.avatar);

  if (cached) {
    paintAvatar(node, cached, person.name);
    return node;
  }

  if (isMxc(person.avatar)) {
    // Warum kein isConnected-Guard: Karten werden in detached Fragmenten
    // gebaut: der Node ist zum Auflösungszeitpunkt oft noch nicht im
    // Dokument, und das Bild wäre für immer verloren.
    resolveAvatarUrl(person.avatar).then((url) => {
      if (url) paintAvatar(node, url, person.name);
    });
  }

  return node;
}

/**
 * Overlapping avatars, most relevant first, with a "+N" chip for the
 * rest — the compact "shared with" signal used on dashboard cards.
 */
export function renderPeopleStack(people, { max = 3, label = '' } = {}) {
  const stack = el('div', {
    class: 'yanta-people-stack',
    title: label,
  });

  const shown = people.slice(0, max);

  for (const person of shown) {
    stack.append(renderPersonAvatar(person));
  }

  const rest = people.length - shown.length;

  if (rest > 0) {
    stack.append(el('span', {
      class: 'yanta-person-avatar is-more',
    }, `+${rest}`));
  }

  return stack;
}

// One settings read, started as soon as anything wants to draw people —
// early enough that the first dashboard paint already has faces.
loadCache().catch(() => {});

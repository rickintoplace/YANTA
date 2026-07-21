// ============================================================
// YANTA Chat — Custom stickers
//
// Storage: MSC2545 user image pack (account data `im.ponies.user_emotes`),
// the same format Element/FluffyChat use. Stickers therefore sync across
// devices and stay usable from other Matrix clients.
//
// Personal Library integration: drawings added to the Personal Library
// ("Add to Library" in the drawing editor) become sendable stickers. On
// first send the drawing is exported as a transparent PNG, uploaded once
// and registered in the user image pack; later sends reuse that upload.
//
// Media note: image-pack stickers reference plain (unencrypted) mxc URLs by
// design — packs are reused across many rooms, so per-room attachment
// encryption cannot apply. The m.sticker event content itself is still E2E
// encrypted in encrypted rooms.
// ============================================================

import {
  listDrawLibraryItemsAsync,
  listDrawLibraryGroups,
  drawLibraryItemPngBlob,
} from '../draw.js';

import {
  mxcToBlob,
  uploadMatrixContent,
} from './chat-media.js';

const USER_EMOTES_TYPE = 'im.ponies.user_emotes';
const YANTA_LIBRARY_KEY = 'page.yanta.library_item_id';

// Original mxc of a saved received sticker — dedupes repeated "Add to
// library" even when the encrypted source had to be re-uploaded as plain.
const YANTA_SOURCE_MXC_KEY = 'page.yanta.source_mxc';

function userEmotesContent(client) {
  try {
    return client?.getAccountData?.(USER_EMOTES_TYPE)?.getContent?.() || {};
  } catch (err) {
    console.warn('[YANTA Chat Stickers] Could not read user image pack', err);
    return {};
  }
}

function imageUsableAsSticker(image = {}, packUsage = []) {
  const usage = Array.isArray(image.usage) && image.usage.length
    ? image.usage
    : packUsage;

  // MSC2545: missing usage means the image works as emoticon AND sticker.
  return !Array.isArray(usage) || !usage.length || usage.includes('sticker');
}

/**
 * Lists all sticker-capable images of the user's MSC2545 image pack.
 */
export function listUserPackStickers(client) {
  const content = userEmotesContent(client);
  const packUsage = Array.isArray(content.pack?.usage) ? content.pack.usage : [];

  return Object.entries(content.images || {})
    .filter(([, image]) => image?.url && imageUsableAsSticker(image, packUsage))
    .map(([shortcode, image]) => ({
      shortcode,
      url: image.url,
      body: image.body || shortcode,
      info: image.info || {},
      libraryItemId: image[YANTA_LIBRARY_KEY] || '',
    }));
}

/**
 * Lists Personal Library drawings as sticker candidates.
 */
export function listLibraryStickerItems() {
  return listDrawLibraryItemsAsync();
}

/**
 * Like listLibraryStickerItems(), but grouped by source library (own drawings
 * first, then one group per imported Excalidraw library). Loads the library
 * first so callers get populated groups.
 */
export async function listLibraryStickerGroups() {
  await listDrawLibraryItemsAsync();
  return listDrawLibraryGroups();
}

async function saveUserEmotesImages(client, images) {
  if (typeof client?.setAccountData !== 'function') {
    throw new Error('Matrix setAccountData is not available.');
  }

  const current = userEmotesContent(client);

  await client.setAccountData(USER_EMOTES_TYPE, {
    ...current,
    pack: {
      display_name: 'YANTA',
      ...(current.pack || {}),
    },
    images,
  });
}

function stickerShortcode(name, existing) {
  const base = String(name || 'sticker')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'sticker';

  let candidate = base;
  let i = 2;

  while (Object.prototype.hasOwnProperty.call(existing, candidate)) {
    candidate = `${base}-${i++}`;
  }

  return candidate;
}

async function imageDimensions(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    return {
      w: bitmap.width || 0,
      h: bitmap.height || 0,
    };
  } catch {
    return {
      w: 0,
      h: 0,
    };
  }
}

/**
 * Returns the pack sticker for a Personal Library item, uploading and
 * registering it on first use.
 */
export async function stickerForLibraryItem(client, item) {
  if (!client || !item?.id) {
    throw new Error('Chat is not connected.');
  }

  const content = userEmotesContent(client);
  const images = { ...(content.images || {}) };

  for (const [shortcode, image] of Object.entries(images)) {
    if (image?.url && image[YANTA_LIBRARY_KEY] === String(item.id)) {
      return {
        shortcode,
        url: image.url,
        body: image.body || shortcode,
        info: image.info || {},
        libraryItemId: String(item.id),
      };
    }
  }

  const blob = await drawLibraryItemPngBlob(item.id, {
    maxSize: 512,
  });

  if (!blob || !blob.size) {
    throw new Error('Could not export the library drawing.');
  }

  const shortcode = stickerShortcode(item.name, images);
  const mxc = await uploadMatrixContent(client, blob, {
    name: `${shortcode}.png`,
    type: 'image/png',
  });

  const dim = await imageDimensions(blob);

  const image = {
    url: mxc,
    body: item.name || 'Sticker',
    usage: ['sticker'],
    info: {
      w: dim.w,
      h: dim.h,
      mimetype: 'image/png',
      size: blob.size,
    },
    [YANTA_LIBRARY_KEY]: String(item.id),
  };

  images[shortcode] = image;

  await saveUserEmotesImages(client, images);

  return {
    shortcode,
    url: image.url,
    body: image.body,
    info: image.info,
    libraryItemId: String(item.id),
  };
}

/**
 * Saves a received sticker (m.sticker event content) into the user's
 * MSC2545 image pack, making it sendable from the sticker tab.
 *
 * Pack images require plain mxc URLs (packs are reused across rooms), so
 * encrypted attachments are downloaded, decrypted and re-uploaded once.
 *
 * Returns { shortcode, existed } — existed=true when it was already saved.
 */
export async function addStickerToUserPack(client, content = {}) {
  if (!client) {
    throw new Error('Chat is not connected.');
  }

  const info = content.info || {};
  const body = String(content.body || '').trim() || 'Sticker';
  const sourceMxc = String(content.url || content.file?.url || '');

  if (!sourceMxc) {
    throw new Error('Sticker is missing its media URL.');
  }

  const current = userEmotesContent(client);
  const images = { ...(current.images || {}) };

  for (const [shortcode, image] of Object.entries(images)) {
    if (!image?.url) continue;

    if (image.url === sourceMxc || image[YANTA_SOURCE_MXC_KEY] === sourceMxc) {
      return {
        shortcode,
        existed: true,
      };
    }
  }

  let url = String(content.url || '');
  let imageInfo = {
    w: Number(info.w || 0),
    h: Number(info.h || 0),
    mimetype: info.mimetype || 'image/png',
    size: Number(info.size || 0),
  };

  if (!url) {
    const blob = await mxcToBlob(client, content.file.url, {
      thumbnail: false,
      encryptedFile: content.file,
      mimeType: info.mimetype || '',
    });

    if (!blob?.size) {
      throw new Error('Could not load the sticker media.');
    }

    url = await uploadMatrixContent(client, blob, {
      name: 'sticker.png',
      type: blob.type || info.mimetype || 'image/png',
    });

    const dim = await imageDimensions(blob);

    imageInfo = {
      w: dim.w || imageInfo.w,
      h: dim.h || imageInfo.h,
      mimetype: blob.type || imageInfo.mimetype,
      size: blob.size,
    };
  }

  const shortcode = stickerShortcode(body, images);

  images[shortcode] = {
    url,
    body,
    usage: ['sticker'],
    info: imageInfo,
    [YANTA_SOURCE_MXC_KEY]: sourceMxc,
  };

  await saveUserEmotesImages(client, images);

  return {
    shortcode,
    existed: false,
  };
}

/**
 * Sends an m.sticker event.
 */
export async function sendStickerMessage(client, roomId, {
  url,
  body = 'Sticker',
  info = {},
} = {}) {
  if (!client || !roomId) {
    throw new Error('Chat is not connected.');
  }

  if (!url) {
    throw new Error('Sticker is missing its media URL.');
  }

  if (typeof client.sendEvent !== 'function') {
    throw new Error('Matrix sendEvent is not available.');
  }

  return client.sendEvent(roomId, 'm.sticker', {
    body: body || 'Sticker',
    url,
    info,
  });
}

// ============================================================
// YANTA — Shared image compression
// Used by image insertion, Chat media and profile avatars.
// ============================================================

/**
 * Converts a Blob to a Data URL.
 */
export async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(blob);
  });
}

function normalizedMime(mime = 'image/webp') {
  const clean = String(mime || '').trim();

  if (
    clean === 'image/webp' ||
    clean === 'image/png' ||
    clean === 'image/jpeg' ||
    clean === 'image/avif'
  ) {
    return clean;
  }

  return 'image/webp';
}

/**
 * Compresses an image file into a canvas-rendered Blob.
 *
 * Warum:
 * Avatars and chat images should be small, predictable and privacy-safe.
 * SVG is kept as-is because canvas-rasterizing untrusted SVG can produce
 * inconsistent browser behavior and may lose fidelity.
 */
export async function compressImageFile(file, {
  maxWidth = 1600,
  maxHeight = 1600,
  maxPixels = 16_000_000,
  quality = 0.85,
  mime = 'image/webp',
  includeDataUrl = true,
} = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('Not an image file.');
  }

  if (file.type === 'image/svg+xml') {
    return {
      blob: file,
      mime: file.type,
      width: 0,
      height: 0,
      originalSize: file.size || 0,
      compressedSize: file.size || 0,
      converted: false,
      dataUrl: includeDataUrl ? await blobToDataURL(file) : '',
    };
  }

  let bitmap = null;

  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
  } catch {
    // Safari/Fallback.
    bitmap = await createImageBitmap(file);
  }

  const sourceWidth = Math.max(1, bitmap.width || 1);
  const sourceHeight = Math.max(1, bitmap.height || 1);

  const widthRatio = Number(maxWidth || 1600) / sourceWidth;
  const heightRatio = Number(maxHeight || maxWidth || 1600) / sourceHeight;
  const pixelRatio = Math.sqrt(Number(maxPixels || 16_000_000) / (sourceWidth * sourceHeight));

  const ratio = Math.min(1, widthRatio, heightRatio, pixelRatio);

  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));

  const outputMime = normalizedMime(mime);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', {
    alpha: outputMime === 'image/png',
    desynchronized: true,
  });

  if (!ctx) {
    try {
      bitmap.close?.();
    } catch {}

    throw new Error('Canvas is not available.');
  }

  // White matte for JPEG because JPEG has no alpha channel.
  if (outputMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(bitmap, 0, 0, width, height);

  try {
    bitmap.close?.();
  } catch {}

  const blob = await new Promise((resolve) => {
    canvas.toBlob(
      resolve,
      outputMime,
      outputMime === 'image/png' ? undefined : Number(quality || 0.85)
    );
  });

  if (!blob) {
    throw new Error('Could not compress image.');
  }

  return {
    blob,
    mime: blob.type || outputMime,
    width,
    height,
    originalSize: file.size || 0,
    compressedSize: blob.size || 0,
    converted: blob.type !== file.type || blob.size !== file.size,
    dataUrl: includeDataUrl ? await blobToDataURL(blob) : '',
  };
}
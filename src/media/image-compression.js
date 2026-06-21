// ============================================================
// YANTA — Shared image compression
// Used by image insertion + AI context uploads.
// ============================================================

export async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(blob);
  });
}

export async function compressImageFile(file, {
  maxWidth = 1600,
  quality = 0.85,
  mime = 'image/webp',
} = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('Not an image file.');
  }

  // Keep SVG as-is. Rendering SVG to canvas can lose fidelity and can
  // execute unexpectedly in some pipelines if not sanitized elsewhere.
  if (file.type === 'image/svg+xml') {
    return {
      blob: file,
      mime: file.type,
      width: 0,
      height: 0,
      originalSize: file.size || 0,
      compressedSize: file.size || 0,
      converted: false,
      dataUrl: await blobToDataURL(file),
    };
  }

  const bitmap = await createImageBitmap(file);

  const ratio = Math.min(1, Number(maxWidth || 1600) / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', {
    alpha: mime === 'image/png',
  });

  ctx.drawImage(bitmap, 0, 0, width, height);

  const outputMime = mime || 'image/webp';

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
    dataUrl: await blobToDataURL(blob),
  };
}
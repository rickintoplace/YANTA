// ============================================================
// YANTA — Media timestamp interactions
//
// A .yanta-video-timestamp jumps to the nearest compatible media element.
// Search order:
// 1. closest compatible media above the timestamp
// 2. first compatible media below the timestamp
//
// Rendering is controlled in markdown.js: timestamps are only rendered when
// the note contains at least one compatible audio/video embed.
// ============================================================

const MEDIA_SELECTOR = [
  '.pv-embed-video iframe',
  '.pv-embed-video video',
  '.pv-embed-audio audio',
  'iframe[src*="youtube"]',
  'iframe[src*="vimeo"]',
  'video',
  'audio',
].join(',');

const bindings = new WeakMap();

function timestampScope(timestampEl, fallbackRoot) {
  return (
    timestampEl.closest?.('.preview, .yps-content, article') ||
    fallbackRoot ||
    document
  );
}

function nearestPlayableMediaForTimestamp(timestampEl, root) {
  if (!timestampEl) return null;

  const scope = timestampScope(timestampEl, root);
  const mediaNodes = [...scope.querySelectorAll(MEDIA_SELECTOR)];

  let closestAbove = null;
  let firstBelow = null;

  for (const node of mediaNodes) {
    const pos = node.compareDocumentPosition(timestampEl);

    // timestampEl is after node in document order.
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
      closestAbove = node;
      continue;
    }

    // timestampEl is before node in document order.
    if (!firstBelow && (pos & Node.DOCUMENT_POSITION_PRECEDING)) {
      firstBelow = node;
    }
  }

  return closestAbove || firstBelow || null;
}

function jumpIframeToTimestamp(iframe, seconds) {
  if (!iframe?.src) return false;

  try {
    const url = new URL(iframe.src, location.href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const cleanSeconds = Math.max(0, Math.floor(Number(seconds || 0)));

    if (
      host.includes('youtube.com') ||
      host.includes('youtube-nocookie.com')
    ) {
      url.searchParams.set('start', String(cleanSeconds));
      url.searchParams.set('autoplay', '1');

      // Force reload even if only the time changed.
      iframe.src = url.href;

      return true;
    }

    if (host.includes('vimeo.com')) {
      url.searchParams.set('autoplay', '1');
      url.hash = `t=${cleanSeconds}s`;

      iframe.src = url.href;

      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function jumpHtmlMediaToTimestamp(media, seconds) {
  if (!(media instanceof HTMLMediaElement)) return false;

  try {
    media.currentTime = Math.max(0, Number(seconds || 0));
    media.play?.().catch?.(() => {});
    return true;
  } catch {
    return false;
  }
}

export function bindMediaTimestampClicks(root = document, {
  onError = null,
} = {}) {
  if (!root) return () => {};

  bindings.get(root)?.abort?.();

  const controller = new AbortController();

  root.addEventListener('click', (e) => {
    const timestamp = e.target.closest?.('.yanta-video-timestamp');

    if (!timestamp || !root.contains(timestamp)) return;

    const seconds = Number(timestamp.dataset.timestampSeconds);

    if (!Number.isFinite(seconds)) return;

    e.preventDefault();
    e.stopPropagation();

    const media = nearestPlayableMediaForTimestamp(timestamp, root);

    if (!media) {
      onError?.('No compatible video or audio found in this note');
      return;
    }

    if (media instanceof HTMLIFrameElement) {
      if (!jumpIframeToTimestamp(media, seconds)) {
        onError?.('Could not jump this embedded player');
      }

      return;
    }

    if (media instanceof HTMLMediaElement) {
      if (!jumpHtmlMediaToTimestamp(media, seconds)) {
        onError?.('Could not jump this media player');
      }
    }
  }, {
    signal: controller.signal,
  });

  bindings.set(root, controller);

  return () => controller.abort();
}
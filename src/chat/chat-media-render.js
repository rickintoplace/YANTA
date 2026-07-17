// ============================================================
// YANTA Chat — Message media rendering
// ============================================================

import {
  downloadBlob,
  el,
  escapeHtml,
  fmtBytes,
  lucide,
  toast,
} from '../core.js';

import {
  fileSubtitle,
  mxcToBlob,
  mxcToBlobUrl,
  peekChatMediaObjectUrl,
} from './chat-media.js';

import {
  registerOverlayRoute,
  pushOverlayState,
  closeTopOverlay,
  overlayIdFromState,
} from '../overlay-history.js';

const lazyImageObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;

    const node = entry.target;
    lazyImageObserver.unobserve(node);

    const hydrate = node._yantaHydrateImage;
    if (typeof hydrate === 'function') {
      hydrate();
    }
  }
}, {
  rootMargin: '360px',
  threshold: 0.01,
});

const voicePlayersByRoom = new Map();

const activeVoicePlayback = {
  audio: null,
  eventId: '',
};

function sourceFromContent(content = {}) {
  const info = content.info || {};

  if (content.file?.url) {
    return {
      mxcUrl: content.file.url,
      encryptedFile: content.file,
      mimeType: info.mimetype || content.file?.mimetype || '',
    };
  }

  if (content.url) {
    return {
      mxcUrl: content.url,
      encryptedFile: null,
      mimeType: info.mimetype || '',
    };
  }

  return null;
}

function imageSourceFromContent(content = {}) {
  const info = content.info || {};

  if (info.thumbnail_file?.url) {
    return {
      preview: {
        mxcUrl: info.thumbnail_file.url,
        encryptedFile: info.thumbnail_file,
        mimeType: info.thumbnail_info?.mimetype || info.mimetype || 'image/webp',
        w: info.thumbnail_info?.w || 320,
        h: info.thumbnail_info?.h || 320,
      },
      full: {
        mxcUrl: content.file?.url || info.thumbnail_file.url,
        encryptedFile: content.file || info.thumbnail_file,
        mimeType: info.mimetype || 'image/webp',
        w: info.w || 1600,
        h: info.h || 1600,
      },
    };
  }

  if (info.thumbnail_url) {
    return {
      preview: {
        mxcUrl: info.thumbnail_url,
        encryptedFile: null,
        mimeType: info.thumbnail_info?.mimetype || info.mimetype || 'image/webp',
        w: info.thumbnail_info?.w || 320,
        h: info.thumbnail_info?.h || 320,
      },
      full: {
        mxcUrl: content.url || info.thumbnail_url,
        encryptedFile: null,
        mimeType: info.mimetype || 'image/webp',
        w: info.w || 1600,
        h: info.h || 1600,
      },
    };
  }

  const direct = sourceFromContent(content);

  if (!direct) return null;

  return {
    preview: {
      ...direct,
      w: info.w || 900,
      h: info.h || 900,
    },
    full: {
      ...direct,
      w: info.w || 1600,
      h: info.h || 1600,
    },
  };
}

function mimeIcon(mimetype = '', name = '') {
  const value = `${mimetype} ${name}`.toLowerCase();

  if (value.includes('pdf')) return 'file-type-2';
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('audio/')) return 'file-audio';
  if (value.startsWith('video/')) return 'file-video';
  if (value.includes('zip') || value.includes('tar') || value.includes('rar')) return 'archive';
  if (value.includes('word') || value.endsWith('.doc') || value.endsWith('.docx')) return 'file-text';
  if (value.includes('excel') || value.endsWith('.xls') || value.endsWith('.xlsx')) return 'sheet';

  return 'paperclip';
}

function durationLabel(ms = 0) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;

  return `${m}:${String(s).padStart(2, '0')}`;
}

function waveformFromContent(content = {}) {
  const wf = content?.['org.matrix.msc1767.audio']?.waveform;

  if (Array.isArray(wf) && wf.length) {
    return wf
      .slice(0, 100)
      .map((n) => Math.max(0, Math.min(1024, Number(n || 0))));
  }

  return Array.from({ length: 48 }, () => 180);
}

/*
  Warum overlay-history: Der Bildviewer liegt fullscreen über dem Chat.
  Ohne eigenen History-Eintrag würde Geräte-Back den Chat-Eintrag poppen
  und damit den ganzen Chat schließen statt nur den Viewer.
*/
const CHAT_IMAGE_VIEWER_OVERLAY_ID = 'chat-image-viewer';

let imageViewerRouteRegistered = false;
let activeImageViewer = null; // { destroy }
let lastImageViewerArgs = null; // { client, full, title } for forward-restore

function registerImageViewerRoute() {
  if (imageViewerRouteRegistered) return;

  imageViewerRouteRegistered = true;

  registerOverlayRoute(CHAT_IMAGE_VIEWER_OVERLAY_ID, {
    open: async () => {
      if (lastImageViewerArgs) {
        openChatImageViewer(
          lastImageViewerArgs.client,
          lastImageViewerArgs.full,
          lastImageViewerArgs.title,
          {
            fromHistory: true,
            stickerContent: lastImageViewerArgs.stickerContent,
          }
        );
      }
    },

    close: () => {
      activeImageViewer?.destroy();
    },

    isOpen: () => !!activeImageViewer,
  });
}

export function openChatImageViewer(client, full, title = 'Photo', {
  fromHistory = false,
  stickerContent = null,
} = {}) {
  registerImageViewerRoute();

  // Only one viewer at a time; replace instead of stacking.
  activeImageViewer?.destroy();

  lastImageViewerArgs = { client, full, title, stickerContent };

  const overlay = el('div', {
    class: 'yanta-chat-image-viewer',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
    tabindex: '-1',
  });

  overlay.innerHTML = `
    <header>
      <strong>${escapeHtml(title || 'Photo')}</strong>
      <span class="grow"></span>
      ${
        stickerContent
          ? `<button class="icon-btn" data-add-library title="Add to library" aria-label="Add sticker to library">
              ${lucide('shapes', 18)}
            </button>`
          : ''
      }
      <button class="icon-btn" data-download title="Download" aria-label="Download">
        ${lucide('download', 18)}
      </button>
      <button class="icon-btn" data-close title="Close" aria-label="Close">
        ${lucide('x', 18)}
      </button>
    </header>
    <main data-viewer-backdrop>
      <span class="yanta-chat-spinner"></span>
    </main>
  `;

  const destroy = () => {
    if (activeImageViewer?.destroy === destroy) activeImageViewer = null;

    window.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
  };

  // User-initiated close: pop the viewer's history entry so Back stays in sync.
  const close = () => {
    if (overlayIdFromState() === CHAT_IMAGE_VIEWER_OVERLAY_ID) {
      closeTopOverlay(destroy);
      return;
    }

    destroy();
  };

  activeImageViewer = { destroy };

  function onKeyDown(e) {
    if (e.key !== 'Escape') return;

    /*
      Warum:
      Chat itself also listens for Escape/back navigation. The fullscreen media
      viewer is the top-most overlay and must consume Escape first.
    */
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    close();
  }

  overlay.addEventListener('click', async (e) => {
    const closeHit =
      e.target === overlay ||
      e.target === overlay.querySelector('[data-viewer-backdrop]') ||
      e.target.closest?.('[data-close]');

    if (closeHit) {
      close();
      return;
    }

    if (stickerContent && e.target.closest?.('[data-add-library]')) {
      e.preventDefault();
      e.stopPropagation();

      try {
        const { addStickerToUserPack } = await import('./chat-stickers.js');
        const result = await addStickerToUserPack(client, stickerContent);

        toast(
          result.existed
            ? 'Sticker is already in your library'
            : 'Sticker added to your library',
          'success'
        );
      } catch (err) {
        console.warn('[YANTA Chat] Could not add sticker to library', err);
        toast('Could not add sticker to library.', 'error');
      }

      return;
    }

    if (e.target.closest?.('[data-download]')) {
      e.preventDefault();
      e.stopPropagation();

      try {
        const blob = await mxcToBlob(client, full.mxcUrl, {
          thumbnail: false,
          encryptedFile: full.encryptedFile,
          mimeType: full.mimeType,
        });

        downloadBlob(blob, title || 'photo.webp');
      } catch (err) {
        console.warn('[YANTA Chat] Could not download image', err);
        toast('Could not download image.', 'error');
      }
    }
  });

  window.addEventListener('keydown', onKeyDown, true);
  document.body.append(overlay);
  overlay.focus();

  if (!fromHistory && overlayIdFromState() !== CHAT_IMAGE_VIEWER_OVERLAY_ID) {
    pushOverlayState(CHAT_IMAGE_VIEWER_OVERLAY_ID, {});
  }

  mxcToBlobUrl(client, full.mxcUrl, {
    thumbnail: false,
    encryptedFile: full.encryptedFile,
    mimeType: full.mimeType,
    w: full.w || 1600,
    h: full.h || 1600,
  })
    .then((url) => {
      if (!overlay.isConnected) return;

      const img = el('img', {
        src: url,
        alt: title || 'Photo',
      });

      img.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      overlay.querySelector('main')?.replaceChildren(img);
    })
    .catch((err) => {
      console.warn('[YANTA Chat] Could not open image viewer', err);
      toast('Could not open image.', 'error');

      if (overlay.isConnected) {
        overlay.querySelector('main')?.replaceChildren(
          el('div', {
            class: 'yanta-chat-media-error',
          }, 'Could not load image.')
        );
      }
    });
}

function imageCaptionFromContent(content = {}) {
  const body = String(content.body || '').trim();

  if (!body) return '';

  /*
    Why:
    Matrix m.image uses body both for captions and file names. YANTA sends the
    file name when there is no caption, so filename-like bodies are suppressed
    below the image.
  */
  if (/^photo(?:[-_\s]?\d+)?\.(webp|png|jpe?g|gif|avif|heic|svg)$/i.test(body)) {
    return '';
  }

  if (/\.(webp|png|jpe?g|gif|avif|heic|svg)$/i.test(body) && !/\s/.test(body)) {
    return '';
  }

  return body;
}

function renderImageMessage(client, content = {}) {
  const source = imageSourceFromContent(content);
  const title = content.body || 'Photo';
  const caption = imageCaptionFromContent(content);

  const outer = el('div', {
    class: 'yanta-chat-image-message-wrap',
  });
  const wrap = el('button', {
    type: 'button',
    class: 'yanta-chat-image-message',
    title: 'Open photo',
  });
  outer.append(wrap);

  if (caption) {
    outer.append(el('div', {
      class: 'yanta-chat-image-caption',
    }, caption));
  }

  if (!source?.preview?.mxcUrl) {
    wrap.append(el('div', {
      class: 'yanta-chat-media-error',
    }, 'Image is missing media data.'));
    return outer;
  }

  const previewOpts = {
    thumbnail: false,
    encryptedFile: source.preview.encryptedFile,
    mimeType: source.preview.mimeType,
    w: source.preview.w,
    h: source.preview.h,
  };

  /*
    Warum kein isConnected-Guard:
    Beim Timeline-Re-Render läuft der Cache-Treffer synchron, während der
    Node noch im detached DocumentFragment hängt. Ein isConnected-Check
    ließe jedes bereits geladene Bild nach dem nächsten Re-Render leer
    zurück (Bild "verschwindet"). Ein Render in einen bereits verworfenen
    Node ist dagegen harmlos — er wird ohnehin garbage-collected.
  */
  const showImage = (url) => {
    const img = el('img', {
      src: url,
      alt: title,
      loading: 'lazy',
      decoding: 'async',
    });
    wrap.classList.add('is-resolved');
    wrap.replaceChildren(img);
  };

  /*
    Warum kein eigener URL-Cache mehr:
    Object-URL-Lebenszyklus gehört ausschließlich chat-media.js. Ein lokaler
    Cache lieferte nach closeChat() revoked URLs (ERR_FILE_NOT_FOUND).
  */
  const cachedUrl = peekChatMediaObjectUrl(source.preview.mxcUrl, previewOpts);

  if (cachedUrl) {
    wrap.dataset.hydrated = '1';
    showImage(cachedUrl);
  } else {
    wrap.append(el('div', {
      class: 'yanta-chat-image-skeleton',
    }, 'Loading image…'));
  }

  wrap._yantaHydrateImage = async () => {
    if (wrap.dataset.hydrated === '1') return;
    wrap.dataset.hydrated = '1';
    try {
      const url = await mxcToBlobUrl(client, source.preview.mxcUrl, previewOpts);
      showImage(url);
    } catch (err) {
      console.warn('[YANTA Chat] Could not hydrate image message', err);
      wrap.dataset.hydrated = '';
      if (wrap.isConnected) {
        wrap.replaceChildren(el('div', {
          class: 'yanta-chat-media-error',
        }, 'Could not load image.'));
      }
    }
  };

  wrap.addEventListener('click', () => {
    openChatImageViewer(client, source.full, title);
  });

  if (!cachedUrl) {
    lazyImageObserver.observe(wrap);
  }

  return outer;
}

/**
 * Renders an m.sticker event body: image-like, but without caption and
 * with transparent presentation (bubble chrome is removed via CSS).
 */
export function renderStickerContent(client, content = {}) {
  const source = imageSourceFromContent(content);
  const title = content.body || 'Sticker';

  const wrap = el('button', {
    type: 'button',
    class: 'yanta-chat-image-message yanta-chat-sticker',
    title,
  });

  if (!source?.preview?.mxcUrl) {
    wrap.append(el('div', {
      class: 'yanta-chat-media-error',
    }, 'Sticker is missing media data.'));
    return wrap;
  }

  const previewOpts = {
    thumbnail: false,
    encryptedFile: source.preview.encryptedFile,
    mimeType: source.preview.mimeType,
    w: source.preview.w,
    h: source.preview.h,
  };

  const showImage = (url) => {
    const img = el('img', {
      src: url,
      alt: title,
      loading: 'lazy',
      decoding: 'async',
    });
    wrap.classList.add('is-resolved');
    wrap.replaceChildren(img);
  };

  const cachedUrl = peekChatMediaObjectUrl(source.preview.mxcUrl, previewOpts);

  if (cachedUrl) {
    wrap.dataset.hydrated = '1';
    showImage(cachedUrl);
  } else {
    wrap.append(el('div', {
      class: 'yanta-chat-image-skeleton',
    }, ''));
  }

  wrap._yantaHydrateImage = async () => {
    if (wrap.dataset.hydrated === '1') return;
    wrap.dataset.hydrated = '1';
    try {
      const url = await mxcToBlobUrl(client, source.preview.mxcUrl, previewOpts);
      showImage(url);
    } catch (err) {
      console.warn('[YANTA Chat] Could not hydrate sticker', err);
      wrap.dataset.hydrated = '';
      if (wrap.isConnected) {
        wrap.replaceChildren(el('div', {
          class: 'yanta-chat-media-error',
        }, 'Could not load sticker.'));
      }
    }
  };

  wrap.addEventListener('click', () => {
    openChatImageViewer(client, source.full, title, {
      stickerContent: content,
    });
  });

  if (!cachedUrl) {
    lazyImageObserver.observe(wrap);
  }

  return wrap;
}

function renderFileMessage(client, content = {}) {
  const source = sourceFromContent(content);
  const info = content.info || {};
  const name = content.body || 'File';

  const card = el('div', {
    class: 'yanta-chat-file-card',
  });

  card.innerHTML = `
    <span class="yanta-chat-file-icon">${lucide(mimeIcon(info.mimetype, name), 22)}</span>
    <span class="yanta-chat-file-main">
      <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
      <small>${escapeHtml(fileSubtitle(info))}</small>
    </span>
    <button class="icon-btn" data-download title="Download" aria-label="Download">
      ${lucide('download', 17)}
    </button>
  `;

  card.querySelector('[data-download]')?.addEventListener('click', async () => {
    if (!source?.mxcUrl) {
      toast('File is missing media data.', 'error');
      console.warn('[YANTA Chat] Missing file MXC', content);
      return;
    }

    try {
      const blob = await mxcToBlob(client, source.mxcUrl, {
        thumbnail: false,
        encryptedFile: source.encryptedFile,
        mimeType: source.mimeType,
      });

      downloadBlob(blob, name);
    } catch (err) {
      console.warn('[YANTA Chat] Could not download file', err);
      toast('Could not download file.', 'error');
    }
  });

  return card;
}

function registerVoicePlayer(roomId, eventId, playFn) {
  if (!roomId || !eventId || typeof playFn !== 'function') return;

  const list = voicePlayersByRoom.get(roomId) || [];
  const existing = list.find((item) => item.eventId === eventId);

  if (existing) {
    existing.play = playFn;
  } else {
    list.push({
      eventId,
      play: playFn,
    });
  }

  voicePlayersByRoom.set(roomId, list);
}

function playNextVoice(roomId, eventId) {
  const list = voicePlayersByRoom.get(roomId) || [];
  const idx = list.findIndex((item) => item.eventId === eventId);

  if (idx < 0 || idx + 1 >= list.length) return;

  list[idx + 1]?.play?.();
}

function downsampleForDisplay(values = [], bins = 48) {
  if (!Array.isArray(values) || values.length <= bins) return values;

  const out = [];
  const step = values.length / bins;

  for (let i = 0; i < bins; i++) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    const slice = values.slice(start, end);
    const avg = slice.reduce((sum, n) => sum + Number(n || 0), 0) / slice.length;

    out.push(Math.max(0, Math.min(1024, Math.round(avg))));
  }

  return out;
}

function isAbortLikeAudioError(err) {
  return (
    err?.name === 'AbortError' ||
    /play\(\) request was interrupted|media was removed/i.test(err?.message || '')
  );
}

function renderAudioMessage(client, content = {}, context = {}) {
  const source = sourceFromContent(content);
  const durationMs =
    content?.['org.matrix.msc1767.audio']?.duration ||
    content.info?.duration ||
    0;

  const waveform = downsampleForDisplay(waveformFromContent(content), 48);
  const bars = waveform.map((n) => {
    const h = Math.max(3, Math.round((n / 1024) * 28));
    return `<span style="height:${h}px"></span>`;
  }).join('');

  const eventId = context.eventId || '';
  const roomId = context.roomId || '';

  const wrap = el('div', {
    class: 'yanta-chat-voice',
  });

  wrap.innerHTML = `
    <button class="yanta-chat-voice-play" type="button" title="Play" aria-label="Play">
      ${lucide('play', 18)}
    </button>

    <button class="yanta-chat-waveform" type="button" title="Seek">
      <span class="yanta-chat-waveform-progress" data-progress></span>
      <span class="yanta-chat-waveform-bars" style="--wf-bars:${waveform.length || 1}">${bars}</span>
    </button>

    <span class="yanta-chat-voice-duration" data-duration>${durationLabel(durationMs)}</span>

    <button class="yanta-chat-voice-speed" type="button" data-speed>1×</button>
  `;

  const playBtn = wrap.querySelector('.yanta-chat-voice-play');
  const waveformBtn = wrap.querySelector('.yanta-chat-waveform');
  const progress = wrap.querySelector('[data-progress]');
  const duration = wrap.querySelector('[data-duration]');
  const speedBtn = wrap.querySelector('[data-speed]');

  const audio = new Audio();

  audio.preload = 'metadata';

  let hydrated = false;
  let hydratePromise = null;
  let playPromise = null;
  let wantsPlayback = false;
  let speedIndex = 0;

  const speeds = [1, 1.5, 2];

  async function hydrate() {
    if (hydrated) return;
    if (hydratePromise) return hydratePromise;

    hydratePromise = (async () => {
      if (!source?.mxcUrl) {
        throw new Error('Audio message is missing media data.');
      }

      const url = await mxcToBlobUrl(client, source.mxcUrl, {
        thumbnail: false,
        encryptedFile: source.encryptedFile,
        mimeType: source.mimeType || content.info?.mimetype || 'audio/webm',
      });

      audio.src = url;
      hydrated = true;
    })();

    try {
      await hydratePromise;
    } finally {
      hydratePromise = null;
    }
  }

  function totalSeconds() {
    if (audio.duration && Number.isFinite(audio.duration)) {
      return audio.duration;
    }

    return Number(durationMs || 0) / 1000;
  }

  function syncUi() {
    const total = totalSeconds();
    const ratio = total ? audio.currentTime / total : 0;

    if (progress) {
      progress.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    }

    if (duration) {
      duration.textContent = audio.paused
        ? durationLabel(durationMs || total * 1000)
        : durationLabel(Math.max(0, (total - audio.currentTime) * 1000));
    }

    if (playBtn) {
      const loading = !!playPromise || !!hydratePromise;

      wrap.classList.toggle('is-loading', loading);
      playBtn.innerHTML = lucide(audio.paused ? 'play' : 'pause', 18);
      playBtn.title = audio.paused ? 'Play' : 'Pause';
      playBtn.setAttribute('aria-label', playBtn.title);
    }
  }

  function pauseThisAudio() {
    wantsPlayback = false;

    try {
      audio.pause();
    } catch (err) {
      console.warn('[YANTA Chat] Could not pause voice message', err);
      toast('Could not pause voice message.', 'error');
    }

    syncUi();
  }

  async function play() {
    wantsPlayback = true;

    if (playPromise) {
      return playPromise;
    }

    playPromise = (async () => {
      try {
        /*
          Only one voice message may play at a time. This also prevents old
          audio instances from previous timeline renders from overlapping.
        */
        if (activeVoicePlayback.audio && activeVoicePlayback.audio !== audio) {
          try {
            activeVoicePlayback.audio.pause();
          } catch (err) {
            console.warn('[YANTA Chat] Could not pause previous voice message', err);
          }
        }

        activeVoicePlayback.audio = audio;
        activeVoicePlayback.eventId = eventId;

        await hydrate();

        if (!wantsPlayback) return;

        audio.playbackRate = speeds[speedIndex];

        const playResult = audio.play();

        if (playResult?.then) {
          await playResult;
        }

        if (!wantsPlayback) {
          audio.pause();
        }

        syncUi();
      } catch (err) {
        if (isAbortLikeAudioError(err) && !wantsPlayback) {
          console.warn('[YANTA Chat] Voice playback was interrupted by user action', err);
          return;
        }

        console.warn('[YANTA Chat] Could not play voice message', err);
        toast('Could not play voice message.', 'error');
      } finally {
        playPromise = null;
        syncUi();
      }
    })();

    return playPromise;
  }

  playBtn.addEventListener('click', async () => {
    if (!audio.paused || playPromise) {
      pauseThisAudio();
      return;
    }

    await play();
  });

  waveformBtn.addEventListener('click', async (e) => {
    try {
      await hydrate();

      const rect = waveformBtn.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const total = totalSeconds();

      audio.currentTime = total * ratio;
      syncUi();
    } catch (err) {
      console.warn('[YANTA Chat] Could not seek voice message', err);
      toast('Could not seek voice message.', 'error');
    }
  });

  speedBtn.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % speeds.length;
    audio.playbackRate = speeds[speedIndex];
    speedBtn.textContent = `${String(speeds[speedIndex]).replace('.', ',')}×`;
  });

  audio.addEventListener('timeupdate', syncUi);
  audio.addEventListener('loadedmetadata', syncUi);
  audio.addEventListener('pause', syncUi);
  audio.addEventListener('play', syncUi);
  audio.addEventListener('ended', () => {
    wantsPlayback = false;
    syncUi();

    if (activeVoicePlayback.audio === audio) {
      activeVoicePlayback.audio = null;
      activeVoicePlayback.eventId = '';
    }

    playNextVoice(roomId, eventId);
  });

  registerVoicePlayer(roomId, eventId, play);

  syncUi();

  return wrap;
}

/**
 * Render Matrix media message content.
 */
export function renderChatMediaContent(client, content = {}, context = {}) {
  const msgtype = content.msgtype || '';

  if (msgtype === 'm.image') {
    return renderImageMessage(client, content);
  }

  if (msgtype === 'm.file') {
    return renderFileMessage(client, content);
  }

  if (msgtype === 'm.audio') {
    return renderAudioMessage(client, content, context);
  }

  const wrap = el('div', {
    class: 'yanta-chat-media-unsupported',
  });

  wrap.innerHTML = `
    <span>${lucide('paperclip', 15)}</span>
    <span>${escapeHtml(content.body || 'Attachment')}</span>
    <small>${escapeHtml(content.info?.size ? fmtBytes(content.info.size) : '')}</small>
  `;

  return wrap;
}
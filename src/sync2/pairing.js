// ============================================================
// YANTA Sync2 — Device pairing / QR payload
//
// Best-practice pairing model:
// - QR contains a normal https URL:
//     https://yanta.page/#sync2=<encoded-payload>
// - The sync key is in the fragment (#...), so it is not sent to server logs.
// - YANTA clears the fragment after import.
// - Raw yanta-sync2:... payload is still supported for copy/paste.
//
// v2 payload supports YANTA Cloud:
//   provider: "yanta-cloud"
//   cloud: { baseUrl, vaultId }
// ============================================================

import { renderBrandedQrSvg } from '../qr.js';
import { BRAND_LOGO_SVG } from '../brand-logo.js';
import { openBoundOverlay } from '../overlay-history.js';


import {
  store,
} from '../core.js';

import {
  getSync2SyncKey,
  setSync2SyncKey,
} from './app-engine.js';

import {
  base64UrlEncode,
  base64UrlDecode,
  utf8Encode,
  utf8Decode,
  syncKeyToBytes,
} from './crypto.js';

import {
  YANTA_CLOUD_BASE_URL,
} from '../cloud/cloud-api.js';

const PAIRING_PREFIX = 'yanta-sync2:';
const URL_HASH_PREFIX = 'sync2=';

export async function createSync2PairingPayload({
  provider = 'google-drive',
  cloud = null,
} = {}) {
  const syncKey = await getSync2SyncKey();

  let payloadProvider = provider || await store.settings.get('sync2.provider', 'google-drive');

  const payload = {
    v: 2,
    app: 'YANTA',
    kind: 'sync2-pairing',
    provider: payloadProvider,
    syncKey,
    created: new Date().toISOString(),
  };

  if (payloadProvider === 'yanta-cloud') {
    const vaultId =
      cloud?.vaultId ||
      await store.settings.get('sync2.yantaCloud.vaultId', '');

    const baseUrl =
      cloud?.baseUrl ||
      await store.settings.get('sync2.yantaCloud.baseUrl', YANTA_CLOUD_BASE_URL);

    payload.cloud = {
      baseUrl,
      vaultId,
    };
  }

  return PAIRING_PREFIX + base64UrlEncode(
    utf8Encode(JSON.stringify(payload))
  );
}

export async function createSync2PairingUrl({
  provider = 'google-drive',
  cloud = null,
} = {}) {
  const payload = await createSync2PairingPayload({
    provider,
    cloud,
  });

  return (
    location.origin +
    location.pathname +
    location.search +
    '#sync2=' +
    encodeURIComponent(payload)
  );
}

function extractPairingPayload(text) {
  const raw = String(text || '').trim();

  if (raw.startsWith(PAIRING_PREFIX)) {
    return raw;
  }

  // Full URL:
  // https://yanta.page/#sync2=yanta-sync2%3A...
  try {
    const url = new URL(raw);
    const hash = String(url.hash || '').replace(/^#/, '');

    if (hash.startsWith(URL_HASH_PREFIX)) {
      return decodeURIComponent(hash.slice(URL_HASH_PREFIX.length));
    }
  } catch {}

  // Current-page hash or copied hash:
  // #sync2=...
  // sync2=...
  const noHash = raw.replace(/^#/, '');

  if (noHash.startsWith(URL_HASH_PREFIX)) {
    return decodeURIComponent(noHash.slice(URL_HASH_PREFIX.length));
  }

  return raw;
}

export function parseSync2PairingPayload(text) {
  const raw = extractPairingPayload(text);

  if (!raw.startsWith(PAIRING_PREFIX)) {
    throw new Error('Not a YANTA Sync QR or pairing link');
  }

  const json = JSON.parse(
    utf8Decode(base64UrlDecode(raw.slice(PAIRING_PREFIX.length)))
  );

  if (json?.kind !== 'sync2-pairing') {
    throw new Error('Unsupported YANTA Sync QR');
  }

  if (!json.syncKey) {
    throw new Error('Sync key missing');
  }

  syncKeyToBytes(json.syncKey);

  if (json.provider === 'yanta-cloud') {
    if (!json.cloud?.vaultId) {
      throw new Error('YANTA Cloud vault id missing in pairing payload');
    }
  }

  return json;
}

export async function importSync2PairingPayload(text) {
  const payload = parseSync2PairingPayload(text);

  await setSync2SyncKey(payload.syncKey);
  await store.settings.set('sync2.provider', payload.provider || 'google-drive');

  if (payload.provider === 'yanta-cloud') {
    await store.settings.set('sync2.yantaCloud.vaultId', payload.cloud.vaultId);

    await store.settings.set(
      'sync2.yantaCloud.baseUrl',
      payload.cloud.baseUrl || YANTA_CLOUD_BASE_URL
    );
  }

  return payload;
}

export function renderSync2QrSvg(text, size = 220) {
  return renderBrandedQrSvg(text, {
    size,
    logo: BRAND_LOGO_SVG
  });
}

export async function scanQrWithCamera() {
  if (!('BarcodeDetector' in window)) {
    throw new Error('QR scanning is not supported in this browser. Paste the pairing link manually.');
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access is not available in this browser.');
  }

  const detector = new BarcodeDetector({
    formats: ['qr_code'],
  });

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
    },
  });

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.zIndex = '400';
  modal.innerHTML = `
    <div class="modal-card" style="width:min(420px,94vw)">
      <header class="modal-head">
        <h3>Scan YANTA Sync QR</h3>
        <button class="icon-btn" data-close>&times;</button>
      </header>
      <div class="modal-body">
        <video autoplay playsinline muted style="width:100%;border-radius:12px;background:#000"></video>
        <p style="font-size:12px;color:var(--text-dim);margin-top:10px">
          Point the camera at the Sync QR code from your first device.
        </p>
      </div>
    </div>
  `;

  document.body.append(modal);

  const video = modal.querySelector('video');
  video.srcObject = stream;

  await video.play();

  return new Promise((resolve, reject) => {
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;

      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {}

      modal.remove();
      release?.();
    };

    // Device-back aborts the scan instead of closing the app.
    const release = openBoundOverlay('sync-qr-scan', {
      close: () => {
        stop();
        reject(new Error('QR scan cancelled'));
      },
      isOpen: () => modal.isConnected,
    });

    modal.querySelector('[data-close]')?.addEventListener('click', () => {
      stop();
      reject(new Error('QR scan cancelled'));
    });

    const tick = async () => {
      if (stopped) return;

      try {
        const codes = await detector.detect(video);

        if (codes?.length) {
          const value = codes[0].rawValue;
          stop();
          resolve(value);
          return;
        }
      } catch (err) {
        stop();
        reject(err);
        return;
      }

      requestAnimationFrame(tick);
    };

    tick();
  });
}
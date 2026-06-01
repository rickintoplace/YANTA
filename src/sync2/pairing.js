// ============================================================
// YANTA Sync2 — Device pairing / QR payload
// ============================================================

import qrcode from 'qrcode-generator';

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

const PAIRING_PREFIX = 'yanta-sync2:';

export async function createSync2PairingPayload({
  provider = 'google-drive',
} = {}) {
  const syncKey = await getSync2SyncKey();

  const payload = {
    v: 1,
    app: 'YANTA',
    kind: 'sync2-pairing',
    provider,
    syncKey,
    created: new Date().toISOString(),
  };

  return PAIRING_PREFIX + base64UrlEncode(
    utf8Encode(JSON.stringify(payload))
  );
}

export function parseSync2PairingPayload(text) {
  const raw = String(text || '').trim();

  if (!raw.startsWith(PAIRING_PREFIX)) {
    throw new Error('Not a YANTA Sync QR');
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

  return json;
}

export async function importSync2PairingPayload(text) {
  const payload = parseSync2PairingPayload(text);

  await setSync2SyncKey(payload.syncKey);
  await store.settings.set('sync2.provider', payload.provider || 'google-drive');

  return payload;
}

export function renderSync2QrSvg(text, size = 220) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const n = qr.getModuleCount();
  const ns = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('shape-rendering', 'crispEdges');

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', n);
  bg.setAttribute('height', n);
  bg.setAttribute('fill', 'white');
  svg.append(bg);

  let path = '';

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) {
        path += `M${x} ${y}h1v1h-1z`;
      }
    }
  }

  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'black');
  svg.append(p);

  return svg;
}

export async function scanQrWithCamera() {
  if (!('BarcodeDetector' in window)) {
    throw new Error('QR scanning is not supported in this browser. Paste the sync key manually.');
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
    };

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
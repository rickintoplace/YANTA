// ============================================================
// YANTA Present — "Connect devices" on the presenting device
//
// One panel for both directions:
//   - a phone (or anything) joins this presentation: scan the QR, or type
//     the code on yanta.page/present;
//   - this presentation goes to a screen that waits on yanta.page/present:
//     scan its QR or type its code here.
// Below that, every connected device with its role, a dot for "reachable"
// and a way to remove it.
// ============================================================

import { escapeHtml, lucide, toast } from '../core.js';
import { t } from '../i18n/index.js';
import { renderBrandedQrSvg } from '../qr.js';
import { BRAND_LOGO_SVG } from '../brand-logo.js';
import { openBoundOverlay } from '../overlay-history.js';
import { formatCode } from './present-crypto.js';
import { presentHostFor } from './present-host.js';
import { injectPresentCss } from './present-styles.js';

let panel = null;
let releaseOverlay = null;
let stopWatching = null;

const askers = new WeakMap(); // host -> stop function for its approval prompt

export function isConnectPanelOpen() {
  return !!panel?.isConnected;
}

export function closeConnectPanel({ fromHistory = false } = {}) {
  if (!panel) return;

  stopWatching?.();
  stopWatching = null;
  panel.remove();
  panel = null;

  const release = releaseOverlay;
  releaseOverlay = null;
  if (!fromHistory) release?.();
}

/**
 * Opens the panel for one drawing. Starts the session if there is none —
 * that is the moment the QR code and the code become valid.
 */
export async function openConnectPanel({ noteId, drawingId }) {
  injectPresentCss();

  const host = presentHostFor(noteId, drawingId);
  watchPresentHost(host);

  if (panel) {
    render(host);
    return host;
  }

  panel = document.createElement('div');
  panel.className = 'yanta-pc-backdrop';
  panel.innerHTML = `<div class="yanta-pc" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('present.connect.title'))}"></div>`;

  panel.addEventListener('click', (e) => {
    if (e.target === panel) closeConnectPanel();
  });

  document.body.append(panel);

  releaseOverlay = openBoundOverlay('present-connect', {
    close: ({ fromHistory } = {}) => closeConnectPanel({ fromHistory }),
    isOpen: () => isConnectPanelOpen(),
  });

  stopWatching = host.onChange(() => render(host));
  render(host);

  host.openPairing().catch((err) => {
    console.warn('[YANTA Present] pairing could not start', err);
    toast(t('present.connect.offline'), 'error');
  });

  return host;
}

/*
  The footer line says something only the presenter cannot see otherwise:
  whether this device reaches the relay, and how many devices are with it.
*/
function statusState(host) {
  if (!navigator.onLine) return 'offline';
  return host.status === 'online' ? 'online' : 'reconnecting';
}

function statusText(host) {
  const state = statusState(host);
  if (state === 'offline') return t('present.connect.statusOffline');
  if (state === 'reconnecting') return t('present.status.reconnecting');

  const live = host.peers.filter((p) => !p.offline).length;
  return live ? t('present.connect.statusDevices', { count: live }) : t('present.connect.statusWaiting');
}

function roleLabel(role) {
  return role === 'screen' ? t('present.role.screen') : t('present.role.remote');
}

function render(host) {
  const card = panel?.querySelector('.yanta-pc');
  if (!card) return;

  if (host.ended) {
    closeConnectPanel();
    return;
  }

  // Keep what the presenter is typing across re-renders.
  const typed = card.querySelector('[data-screen-input]')?.value || '';
  const hadFocus = document.activeElement?.matches?.('[data-screen-input]');

  const peers = host.peers;
  const pending = host.pending;

  card.innerHTML = `
    <div class="yanta-pc-head">
      ${lucide('cast', 18)}
      <h3>${escapeHtml(t('present.connect.title'))}</h3>
      <button type="button" class="icon-btn" data-close aria-label="${escapeHtml(t('common.close'))}">${lucide('x', 18)}</button>
    </div>

    <div class="yanta-pc-body">
      <div class="yanta-pc-join">
        <div class="yanta-pc-qr" data-qr></div>
        <div>
          <p>${escapeHtml(t('present.connect.scan'))}</p>
          <p>${escapeHtml(t('present.connect.orCode', { site: `${location.host}/present` }))}</p>
          <div class="yanta-pc-code-row">
            <div class="yanta-pc-code">${escapeHtml(host.code ? formatCode(host.code) : '··· ···')}</div>
            <button type="button" class="icon-btn" data-rotate title="${escapeHtml(t('present.connect.newCode'))}" aria-label="${escapeHtml(t('present.connect.newCode'))}">${lucide('refresh-cw', 16)}</button>
          </div>
        </div>
      </div>

      <div>
        <div class="yanta-pc-section-title">${escapeHtml(t('present.connect.devices'))}</div>
        <div class="yanta-pc-devices">
          ${pending.map((p) => `
            <div class="yanta-pc-device is-pending" data-pending="${escapeHtml(p.id)}">
              ${lucide(p.role === 'screen' ? 'monitor' : 'smartphone', 18)}
              <div class="yanta-pc-device-name">
                ${escapeHtml(t('present.connect.wantsToJoin', { name: p.name, role: roleLabel(p.role) }))}
                <small>${escapeHtml(t('present.connect.checkDigits'))} <span class="yanta-pc-check">${escapeHtml(p.check)}</span></small>
              </div>
              <button type="button" class="btn" data-deny>${escapeHtml(t('present.connect.deny'))}</button>
              <button type="button" class="btn primary" data-allow>${escapeHtml(t('present.connect.allow'))}</button>
            </div>
          `).join('')}
          ${peers.map((p) => `
            <div class="yanta-pc-device ${p.offline ? 'is-offline' : ''}" data-peer="${escapeHtml(p.id)}">
              ${lucide(p.role === 'screen' ? 'monitor' : 'smartphone', 18)}
              <div class="yanta-pc-device-name">
                ${escapeHtml(p.name || roleLabel(p.role))}
                <small>${escapeHtml(roleLabel(p.role))} · ${escapeHtml(p.offline ? t('present.connect.away') : t('present.connect.connected'))}</small>
              </div>
              <button type="button" class="icon-btn" data-remove title="${escapeHtml(t('present.connect.remove'))}" aria-label="${escapeHtml(t('present.connect.remove'))}">${lucide('x', 16)}</button>
            </div>
          `).join('')}
          ${!peers.length && !pending.length ? `<div class="yanta-pc-empty">${escapeHtml(t('present.connect.none'))}</div>` : ''}
        </div>
      </div>

      <div>
        <div class="yanta-pc-section-title">${escapeHtml(t('present.connect.toScreen'))}</div>
        <form class="yanta-pc-screen" data-screen-form autocomplete="off">
          <input class="text-input" data-screen-input maxlength="9" placeholder="ABC 123" spellcheck="false" autocapitalize="characters" aria-label="${escapeHtml(t('present.connect.screenCode'))}">
          <button type="submit" class="btn primary" data-screen-go>${escapeHtml(t('present.connect.show'))}</button>
          ${'BarcodeDetector' in window ? `<button type="button" class="btn" data-scan title="${escapeHtml(t('present.connect.scanScreen'))}" aria-label="${escapeHtml(t('present.connect.scanScreen'))}">${lucide('scan-line', 16)}</button>` : ''}
        </form>
        <p class="yanta-pc-url" style="margin:6px 0 0">${escapeHtml(t('present.connect.screenHint', { site: `${location.host}/present` }))}</p>
      </div>

      <div>
        <div class="yanta-pc-section-title">${escapeHtml(t('present.watch.title'))}</div>
        ${host.audienceUrl ? `
          <div class="yanta-pc-screen">
            <input class="text-input" readonly value="${escapeHtml(host.audienceUrl)}" data-watch-url aria-label="${escapeHtml(t('present.watch.title'))}" style="text-transform:none;letter-spacing:0;font-weight:500">
            <button type="button" class="btn primary" data-watch-copy>${escapeHtml(navigator.share ? t('present.watch.share') : t('present.watch.copy'))}</button>
            <button type="button" class="btn" data-watch-stop>${escapeHtml(t('present.watch.stop'))}</button>
          </div>
          <p class="yanta-pc-url" style="margin:6px 0 0">${escapeHtml(t('present.watch.viewers', { count: host.viewerCount }))}</p>
        ` : `
          <div class="yanta-pc-foot">
            <p class="yanta-pc-url" style="margin:0">${escapeHtml(t('present.watch.text'))}</p>
            <button type="button" class="btn" data-watch-create>${lucide('link', 15)} ${escapeHtml(t('present.watch.create'))}</button>
          </div>
        `}
      </div>

      <div class="yanta-pc-foot">
        <span class="yanta-pc-status"><span class="yanta-present-dot" data-state="${statusState(host)}"></span>${escapeHtml(statusText(host))}</span>
        ${peers.length ? `<button type="button" class="btn danger" data-end>${escapeHtml(t('present.connect.end'))}</button>` : ''}
      </div>
    </div>
  `;

  const qr = card.querySelector('[data-qr]');
  if (host.ticketUrl) qr.append(renderBrandedQrSvg(host.ticketUrl, { size: 168, logo: BRAND_LOGO_SVG }));

  card.querySelector('[data-close]').addEventListener('click', () => closeConnectPanel());

  card.querySelector('[data-watch-create]')?.addEventListener('click', () => {
    host.openAudience().catch(() => toast(t('present.connect.offline'), 'error'));
  });

  card.querySelector('[data-watch-stop]')?.addEventListener('click', () => host.closeAudience());

  card.querySelector('[data-watch-copy]')?.addEventListener('click', async () => {
    const url = host.audienceUrl;
    if (!url) return;

    try {
      if (navigator.share) {
        await navigator.share({ title: t('present.watch.title'), url });
        return;
      }

      await navigator.clipboard.writeText(url);
      toast(t('present.watch.copied'), 'success');
    } catch (err) {
      if (err?.name !== 'AbortError') card.querySelector('[data-watch-url]')?.select();
    }
  });

  // A code that was read out loud or seen by the wrong people: replace it.
  card.querySelector('[data-rotate]')?.addEventListener('click', () => {
    host.rotateCode().catch(() => {});
  });

  card.querySelectorAll('[data-pending]').forEach((row) => {
    const id = row.dataset.pending;
    row.querySelector('[data-allow]').addEventListener('click', () => host.approve(id));
    row.querySelector('[data-deny]').addEventListener('click', () => host.deny(id));
  });

  card.querySelectorAll('[data-peer]').forEach((row) => {
    row.querySelector('[data-remove]').addEventListener('click', () => host.removePeer(row.dataset.peer));
  });

  card.querySelector('[data-end]')?.addEventListener('click', () => {
    host.end();
    closeConnectPanel();
  });

  const input = card.querySelector('[data-screen-input]');
  input.value = typed;
  if (hadFocus) input.focus({ preventScroll: true });

  const connect = async (value) => {
    const go = card.querySelector('[data-screen-go]');
    if (go) go.disabled = true;

    try {
      const screen = await host.connectScreen(value);
      toast(t('present.connect.screenConnected', { name: screen.name }), 'success');
      const field = panel?.querySelector('[data-screen-input]');
      if (field) field.value = '';
    } catch (err) {
      toast(err?.code === 'invalid' ? t('present.connect.badCode') : t('present.connect.noScreen'), 'error');
    } finally {
      const again = panel?.querySelector('[data-screen-go]');
      if (again) again.disabled = false;
    }
  };

  card.querySelector('[data-screen-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim()) connect(input.value);
  });

  card.querySelector('[data-scan]')?.addEventListener('click', async () => {
    try {
      const { scanQrWithCamera } = await import('../sync2/pairing.js');
      const text = await scanQrWithCamera({
        title: t('present.connect.scanScreen'),
        hint: t('present.connect.scanScreenHint'),
        zIndex: 1800, // above this panel (1600)
      });

      await connect(text);
    } catch (err) {
      if (!/cancel/i.test(String(err?.message || ''))) toast(String(err?.message || err), 'error');
    }
  });
}

/*
  Watches one session from anywhere in the app:
  - a device that typed the code waits for an OK: a small card at the top,
    even mid-presentation, that never blocks the slides;
  - a device that got in (QR, approval, screen) is announced with a toast,
    and the connect panel closes — the presenter wants to start, not
    admire the device list.
*/
export function watchPresentHost(host) {
  if (askers.has(host)) return;

  let box = null;
  const known = new Set(host.peers.map((p) => p.id));

  const sync = () => {
    if (host.ended) {
      stop();
      return;
    }

    const joined = host.peers.filter((p) => !known.has(p.id) && !p.offline);
    for (const peer of host.peers) known.add(peer.id);
    for (const id of [...known]) {
      if (!host.peers.some((p) => p.id === id)) known.delete(id);
    }

    if (joined.length) {
      const peer = joined[0];
      toast(t('present.connect.joined', { name: peer.name || roleLabel(peer.role), role: roleLabel(peer.role) }), 'success');
      if (isConnectPanelOpen()) closeConnectPanel();
    }

    const request = isConnectPanelOpen() ? null : host.pending[0];

    if (!request) {
      box?.remove();
      box = null;
      return;
    }

    if (box?.dataset.id === request.id) return;

    box?.remove();
    box = document.createElement('div');
    box.className = 'yanta-pc-ask';
    box.dataset.id = request.id;
    box.setAttribute('role', 'alert');
    box.innerHTML = `
      ${lucide(request.role === 'screen' ? 'monitor' : 'smartphone', 18)}
      <div class="yanta-pc-ask-text">
        ${escapeHtml(t('present.connect.wantsToJoin', { name: request.name, role: roleLabel(request.role) }))}
        <small>${escapeHtml(t('present.connect.checkDigits'))} <span class="yanta-pc-check">${escapeHtml(request.check)}</span></small>
      </div>
      <button type="button" class="btn" data-deny>${escapeHtml(t('present.connect.deny'))}</button>
      <button type="button" class="btn primary" data-allow>${escapeHtml(t('present.connect.allow'))}</button>
    `;

    box.querySelector('[data-allow]').addEventListener('click', () => host.approve(request.id));
    box.querySelector('[data-deny]').addEventListener('click', () => host.deny(request.id));

    injectPresentCss();
    document.body.append(box);
    navigator.vibrate?.([10, 60, 10]);
  };

  const off = host.onChange(sync);

  function stop() {
    off();
    box?.remove();
    box = null;
    askers.delete(host);
  }

  askers.set(host, stop);
}

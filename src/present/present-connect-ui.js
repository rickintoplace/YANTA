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
import { openSurface } from '../ui/surface.js';
import { formatCode } from './present-crypto.js';
import { presentHostFor } from './present-host.js';
import { injectPresentCss } from './present-styles.js';

let panel = null;
let currentHost = null; // the session the panel's buttons act on
let stopWatching = null;

const askers = new WeakMap(); // host -> stop function for its approval prompt

export function isConnectPanelOpen() {
  return !!panel && !panel.closed;
}

export function closeConnectPanel({ fromHistory = false } = {}) {
  panel?.close({ fromHistory });
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
    currentHost = host;
    render(host);
    return host;
  }

  panel = openSurface({
    kind: 'dialog',
    title: t('present.connect.title'),
    width: 560,
    className: 'ypc',
    historyId: 'present-connect',
    footer: true,
    onClose: () => {
      stopWatching?.();
      stopWatching = null;
      panel = null;
    },
  });

  wire(host);
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
  if (!panel) return;
  const { body, foot } = panel;

  if (host.ended) {
    closeConnectPanel();
    return;
  }

  // Keep what the presenter is typing across re-renders.
  const typed = body.querySelector('[data-screen-input]')?.value || '';
  const hadFocus = document.activeElement?.matches?.('[data-screen-input]');

  const peers = host.peers;
  const pending = host.pending;
  const site = `${location.host}/present`;

  body.innerHTML = `
    <section class="ys-section ypc-join">
      <div class="ypc-qr" data-qr></div>
      <div>
        <p class="ys-dim">${escapeHtml(t('present.connect.scan'))}</p>
        <p class="ys-dim">${escapeHtml(t('present.connect.orCode', { site }))}</p>
        <div class="ypc-code-row">
          <div class="ypc-code">${escapeHtml(host.code ? formatCode(host.code) : '··· ···')}</div>
          <button type="button" class="icon-btn" data-rotate title="${escapeHtml(t('present.connect.newCode'))}" aria-label="${escapeHtml(t('present.connect.newCode'))}">${lucide('refresh-cw', 16)}</button>
        </div>
      </div>
    </section>

    <section class="ys-section">
      <h3 class="ys-section-title">${escapeHtml(t('present.connect.devices'))}</h3>
      <div class="ypc-list">
        ${pending.map((p) => `
          <div class="ypc-row is-pending" data-pending="${escapeHtml(p.id)}">
            ${lucide(p.role === 'screen' ? 'monitor' : 'smartphone', 18)}
            <div class="ypc-name">
              ${escapeHtml(t('present.connect.wantsToJoin', { name: p.name, role: roleLabel(p.role) }))}
              <small>${escapeHtml(t('present.connect.checkDigits'))} <span class="ypc-check">${escapeHtml(p.check)}</span></small>
            </div>
            <button type="button" class="btn" data-deny>${escapeHtml(t('present.connect.deny'))}</button>
            <button type="button" class="btn primary" data-allow>${escapeHtml(t('present.connect.allow'))}</button>
          </div>
        `).join('')}
        ${peers.map((p) => `
          <div class="ypc-row ${p.offline ? 'is-offline' : ''}" data-peer="${escapeHtml(p.id)}">
            ${lucide(p.role === 'screen' ? 'monitor' : 'smartphone', 18)}
            <div class="ypc-name">
              ${escapeHtml(p.name || roleLabel(p.role))}
              <small>${escapeHtml(roleLabel(p.role))} · ${escapeHtml(p.offline ? t('present.connect.away') : t('present.connect.connected'))}</small>
            </div>
            <button type="button" class="icon-btn" data-remove title="${escapeHtml(t('present.connect.remove'))}" aria-label="${escapeHtml(t('present.connect.remove'))}">${lucide('x', 16)}</button>
          </div>
        `).join('')}
        ${!peers.length && !pending.length ? `<p class="ys-dim">${escapeHtml(t('present.connect.none'))}</p>` : ''}
      </div>
    </section>

    <section class="ys-section">
      <h3 class="ys-section-title">${escapeHtml(t('present.connect.toScreen'))}</h3>
      <form class="ypc-field" data-screen-form autocomplete="off">
        <input class="text-input ypc-screen-code" data-screen-input maxlength="9" placeholder="ABC 123" spellcheck="false" autocapitalize="characters" aria-label="${escapeHtml(t('present.connect.screenCode'))}">
        <button type="submit" class="btn primary" data-screen-go>${escapeHtml(t('present.connect.show'))}</button>
        ${'BarcodeDetector' in window ? `<button type="button" class="btn" data-scan title="${escapeHtml(t('present.connect.scanScreen'))}" aria-label="${escapeHtml(t('present.connect.scanScreen'))}">${lucide('scan-line', 16)}</button>` : ''}
      </form>
      <p class="ys-dim">${escapeHtml(t('present.connect.screenHint', { site }))}</p>
    </section>

    <section class="ys-section">
      <h3 class="ys-section-title">${escapeHtml(t('present.watch.title'))}</h3>
      ${host.audienceUrl ? `
        <div class="ypc-field">
          <input class="text-input" readonly value="${escapeHtml(host.audienceUrl)}" data-watch-url aria-label="${escapeHtml(t('present.watch.title'))}">
          <button type="button" class="btn primary" data-watch-copy>${escapeHtml(navigator.share ? t('present.watch.share') : t('present.watch.copy'))}</button>
          <button type="button" class="btn" data-watch-stop>${escapeHtml(t('present.watch.stop'))}</button>
        </div>
        <p class="ys-dim">${escapeHtml(t('present.watch.viewers', { count: host.viewerCount }))}</p>
      ` : `
        <p class="ys-dim">${escapeHtml(t('present.watch.text'))}</p>
        <button type="button" class="ys-link ypc-watch-create" data-watch-create>${lucide('link', 14)}<span>${escapeHtml(t('present.watch.create'))}</span></button>
      `}
    </section>
  `;

  foot.innerHTML = `
    <span class="ypc-status"><span class="yanta-present-dot" data-state="${statusState(host)}"></span>${escapeHtml(statusText(host))}</span>
    <span class="ys-grow"></span>
    ${peers.length ? `<button type="button" class="btn danger" data-end>${escapeHtml(t('present.connect.end'))}</button>` : ''}
  `;

  const qr = body.querySelector('[data-qr]');
  if (host.ticketUrl) qr.append(renderBrandedQrSvg(host.ticketUrl, { size: 168, logo: BRAND_LOGO_SVG }));

  const input = body.querySelector('[data-screen-input]');
  input.value = typed;
  if (hadFocus) input.focus({ preventScroll: true });
}

// One set of listeners on the surface; render() only replaces markup.
function wire(host) {
  currentHost = host;
  const { root } = panel;

  const connect = async (value) => {
    const go = panel?.body.querySelector('[data-screen-go]');
    if (go) go.disabled = true;

    try {
      const screen = await currentHost.connectScreen(value);
      toast(t('present.connect.screenConnected', { name: screen.name }), 'success');
      const field = panel?.body.querySelector('[data-screen-input]');
      if (field) field.value = '';
    } catch (err) {
      toast(err?.code === 'invalid' ? t('present.connect.badCode') : t('present.connect.noScreen'), 'error');
    } finally {
      const again = panel?.body.querySelector('[data-screen-go]');
      if (again) again.disabled = false;
    }
  };

  root.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-screen-form]')) return;
    e.preventDefault();
    const value = e.target.querySelector('[data-screen-input]').value;
    if (value.trim()) connect(value);
  });

  root.addEventListener('click', async (e) => {
    const h = currentHost;
    const on = (sel) => e.target.closest(sel);

    if (on('[data-watch-create]')) {
      h.openAudience().catch(() => toast(t('present.connect.offline'), 'error'));
    } else if (on('[data-watch-stop]')) {
      h.closeAudience();
    } else if (on('[data-watch-copy]')) {
      const url = h.audienceUrl;
      if (!url) return;

      try {
        if (navigator.share) {
          await navigator.share({ title: t('present.watch.title'), url });
          return;
        }

        await navigator.clipboard.writeText(url);
        toast(t('present.watch.copied'), 'success');
      } catch (err) {
        if (err?.name !== 'AbortError') panel?.body.querySelector('[data-watch-url]')?.select();
      }
    } else if (on('[data-rotate]')) {
      // A code that was read out loud or seen by the wrong people: replace it.
      h.rotateCode().catch(() => {});
    } else if (on('[data-allow]')) {
      h.approve(on('[data-pending]').dataset.pending);
    } else if (on('[data-deny]')) {
      h.deny(on('[data-pending]').dataset.pending);
    } else if (on('[data-remove]')) {
      h.removePeer(on('[data-peer]').dataset.peer);
    } else if (on('[data-end]')) {
      h.end();
      closeConnectPanel();
    } else if (on('[data-scan]')) {
      try {
        const { scanQrWithCamera } = await import('../sync2/pairing.js');
        const text = await scanQrWithCamera({
          title: t('present.connect.scanScreen'),
          hint: t('present.connect.scanScreenHint'),
          zIndex: 1800, // above every surface (1300)
        });

        await connect(text);
      } catch (err) {
        if (!/cancel/i.test(String(err?.message || ''))) toast(String(err?.message || err), 'error');
      }
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

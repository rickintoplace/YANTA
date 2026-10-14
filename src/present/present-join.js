// ============================================================
// YANTA Present — yanta.page/present
//
// The page any other device opens, no account, no YANTA data:
//
// - on its own it offers both directions at once: "show a presentation
//   here" (a QR code and a short code for the presenter) and "join a
//   presentation" (type the code the presenter's device shows);
// - …/present#join=<ticket> is what the presenter's QR code opens: the
//   device joins straight away, as a remote on a phone and as a screen
//   anywhere else (switchable later);
// - after a reload it carries on with the session it was in.
// ============================================================

import { escapeHtml, lucide } from '../core.js';
import { t } from '../i18n/index.js';
import { renderBrandedQrSvg } from '../qr.js';
import { BRAND_LOGO_SVG } from '../brand-logo.js';
import { formatCode, normalizeCode } from './present-crypto.js';
import { holdScreenAwake, isHandheld } from './present-device.js';
import { mountRemote } from './present-remote.js';
import {
  forgetJoinedSession,
  knockOnPresenter,
  readJoinedSession,
  runJoinedSession,
  waitForPresenter,
} from './present-session.js';
import { injectPresentCss } from './present-styles.js';

let root = null;
let teardown = [];

function cleanup() {
  for (const fn of teardown.splice(0)) {
    try {
      fn();
    } catch {}
  }
}

function view(html) {
  cleanup();
  root.innerHTML = html;
  return root;
}

function ticketFromHash() {
  const match = /(?:^|[#&])join=([A-Za-z0-9_-]{40,})/.exec(location.hash || '');
  return match ? match[1] : '';
}

export function mountPresentJoinPage() {
  document.documentElement.classList.add('yanta-present-page');
  document.body.classList.add('yanta-present-page');
  document.title = t('present.page.title');

  injectPresentCss();

  root = document.createElement('div');
  document.body.replaceChildren(root);

  const ticket = ticketFromHash();

  if (ticket) {
    // The ticket is single-use: a reload must not try it again.
    history.replaceState(null, '', location.pathname + location.search);
    joinWith({ ticketKey: ticket, role: isHandheld() ? 'remote' : 'screen' });
    return;
  }

  const saved = readJoinedSession();
  if (saved) {
    runSession(saved);
    return;
  }

  showStart();
}

// ---------- Start: show here or join

function showStart({ message = '', error = false } = {}) {
  const handheld = isHandheld();
  let role = handheld ? 'remote' : 'screen';

  view(`
    <div class="yanta-pj">
      <div class="yanta-pj-wrap">
        <div class="yanta-pj-brand">${BRAND_LOGO_SVG}<span>YANTA ${escapeHtml(t('present.page.brand'))}</span></div>

        <div class="yanta-pj-cards">
          <section class="yanta-pj-card">
            <h1>${escapeHtml(t('present.page.showTitle'))}</h1>
            <div class="yanta-pj-show">
              <div class="yanta-pj-qr is-loading" data-qr></div>
              <div>
                <div class="yanta-pj-code-label">${escapeHtml(t('present.page.codeLabel'))}</div>
                <div class="yanta-pj-code" data-code>··· ···</div>
                <ol class="yanta-pj-steps">
                  <li>${escapeHtml(t('present.page.showStep1'))}</li>
                  <li>${escapeHtml(t('present.page.showStep2'))}</li>
                  <li>${escapeHtml(t('present.page.showStep3'))}</li>
                </ol>
              </div>
            </div>
            <div class="yanta-pj-note" data-wait-note></div>
          </section>

          <section class="yanta-pj-card is-join">
            <h2>${escapeHtml(t('present.page.joinTitle'))}</h2>
            <p>${escapeHtml(t('present.page.joinText'))}</p>
            <form class="yanta-pj-form" data-join-form autocomplete="off">
              <input class="yanta-pj-input" data-code-input inputmode="text" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="ABC 123" aria-label="${escapeHtml(t('present.page.codeLabel'))}">
              <div class="yanta-pj-roles" role="group" aria-label="${escapeHtml(t('present.page.roleLabel'))}">
                <button type="button" class="yanta-pj-role" data-role="remote">${lucide('smartphone', 16)} ${escapeHtml(t('present.role.remote'))}</button>
                <button type="button" class="yanta-pj-role" data-role="screen">${lucide('monitor', 16)} ${escapeHtml(t('present.role.screen'))}</button>
              </div>
              <button type="submit" class="yanta-pj-btn" data-join disabled>${escapeHtml(t('present.page.join'))}</button>
              <div class="yanta-pj-note ${error ? 'is-error' : ''}" data-join-note>${escapeHtml(message)}</div>
            </form>
          </section>
        </div>
      </div>
    </div>
  `);

  const input = root.querySelector('[data-code-input]');
  const joinBtn = root.querySelector('[data-join]');

  const syncRoles = () => {
    root.querySelectorAll('[data-role]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.role === role ? 'true' : 'false');
    });
  };

  root.querySelectorAll('[data-role]').forEach((btn) => {
    btn.addEventListener('click', () => {
      role = btn.dataset.role;
      syncRoles();
    });
  });

  syncRoles();

  input.addEventListener('input', () => {
    joinBtn.disabled = !normalizeCode(input.value);
  });

  root.querySelector('[data-join-form]').addEventListener('submit', (e) => {
    e.preventDefault();

    const code = normalizeCode(input.value);
    if (!code) return;

    joinWith({ code, role });
  });

  if (handheld) input.focus({ preventScroll: true });

  // Meanwhile this device waits to be picked as a screen.
  const waiting = waitForPresenter({
    onReady: ({ screenKey, code }) => {
      const qr = root.querySelector('[data-qr]');
      const url = `${location.origin}/?app#present-screen=${screenKey}`;

      qr?.classList.remove('is-loading');
      if (qr) qr.dataset.url = url;
      qr?.replaceChildren(renderBrandedQrSvg(url, { size: 220, logo: BRAND_LOGO_SVG }));

      const codeEl = root.querySelector('[data-code]');
      if (codeEl) codeEl.textContent = formatCode(code);
    },
    onInvited: ({ name }) => {
      const note = root.querySelector('[data-wait-note]');
      if (note) note.innerHTML = `<span class="yanta-pj-spinner"></span> ${escapeHtml(t('present.page.connecting', { name: name || '' }))}`;
    },
  });

  teardown.push(() => waiting.stop());

  waiting.result
    .then((joined) => runSession(joined))
    .catch((err) => {
      if (err?.code !== 'cancelled') console.warn('[YANTA Present] waiting failed', err);
    });
}

// ---------- Joining

function joinWith({ ticketKey = '', code = '', role }) {
  const controller = new AbortController();

  view(`
    <div class="yanta-pj">
      <div class="yanta-pj-center" data-joining>
        <div class="yanta-pj-spinner"></div>
        <h1>${escapeHtml(t('present.page.joining'))}</h1>
        <p data-joining-text>${escapeHtml(t('present.page.joiningText'))}</p>
        <button type="button" class="yanta-pj-btn is-quiet" data-cancel>${escapeHtml(t('common.cancel'))}</button>
      </div>
    </div>
  `);

  root.querySelector('[data-cancel]').addEventListener('click', () => {
    controller.abort();
    showStart();
  });

  // Nobody answers a stale ticket: say so instead of spinning forever.
  const giveUp = setTimeout(() => {
    controller.abort();
    showStart({ message: t('present.page.noAnswer'), error: true });
  }, code ? 120_000 : 15_000);

  teardown.push(() => clearTimeout(giveUp));

  knockOnPresenter({
    ticketKey,
    code,
    role,
    signal: controller.signal,
    onWaiting: (check) => {
      clearTimeout(giveUp);

      const box = root.querySelector('[data-joining]');
      if (!box) return;

      box.innerHTML = `
        <h1>${escapeHtml(t('present.page.confirmTitle'))}</h1>
        <p>${escapeHtml(t('present.page.confirmText'))}</p>
        <div class="yanta-pj-check">${escapeHtml(check)}</div>
        <button type="button" class="yanta-pj-btn is-quiet" data-cancel>${escapeHtml(t('common.cancel'))}</button>
      `;

      box.querySelector('[data-cancel]').addEventListener('click', () => {
        controller.abort();
        showStart();
      });
    },
  })
    .then((joined) => runSession(joined))
    .catch((err) => {
      if (err?.code === 'cancelled') return;

      showStart({
        message: err?.code === 'denied' ? t('present.page.denied') : t('present.page.joinFailed'),
        error: true,
      });
    });
}

// ---------- In a session

function runSession(joined) {
  let role = joined.role === 'screen' ? 'screen' : 'remote';
  let state = null;
  let deck = null;
  let status = 'online';
  let ui = null; // { kind, update?, stage?, destroy }

  view('<div data-session></div>');

  const host = root.querySelector('[data-session]');
  const releaseWake = holdScreenAwake();

  const session = runJoinedSession(joined, {
    onState: (next) => {
      state = next;
      render();
    },
    onDeck: (next) => {
      const first = !deck;
      deck = next;

      if (ui?.kind === 'screen' && ui.stage && !first) ui.stage.setDeck(deck);
      render();
    },
    onLaser: (point) => {
      if (ui?.kind === 'screen') ui.stage?.laser(point);
      if (ui?.kind === 'remote') ui.laser?.(point);
    },
    onStatus: (next) => {
      status = next;
      render();
    },
    onEnd: (reason) => {
      ui?.destroy();
      ui = null;
      releaseWake();
      showEnded(reason);
    },
  });

  teardown.push(() => {
    ui?.destroy();
    releaseWake();
  });

  const switchRole = (next) => {
    role = next;
    joined.role = next;

    try {
      sessionStorage.setItem('yanta.present.joined.v1', JSON.stringify(joined));
    } catch {}

    ui?.destroy();
    ui = null;
    render();
  };

  function render() {
    if (role === 'remote') {
      if (ui?.kind !== 'remote') {
        ui?.destroy();

        const box = document.createElement('div');
        host.replaceChildren(box);

        const remote = mountRemote(box, {
          command: (op, extra) => session.send(op, extra),
          laser: (point) => session.laser(point),
          editNotes: (slideId, text) => session.editNotes(slideId, text),
          notesPending: (slideId) => session.notesPending(slideId),
          switchToScreen: () => switchRole('screen'),
          leave: () => {
            session.leave();
            ui?.destroy();
            ui = null;
            releaseWake();
            showStart();
          },
        });

        ui = { kind: 'remote', update: remote.update, laser: remote.laser, destroy: remote.destroy };
      }

      ui.update({ state, deck, status });
      return;
    }

    renderScreen();
  }

  function renderScreen() {
    if (ui?.kind !== 'screen') {
      ui?.destroy();

      host.innerHTML = `
        <div class="yanta-present-screen" data-screen>
          <div class="yanta-present-stage-host" data-stage-host style="position:absolute;inset:0"></div>
          <div class="yanta-present-overlay" data-overlay></div>
          <div class="yanta-present-pill" data-pill>
            <span class="yanta-present-dot" data-dot></span>
            <span data-pill-text></span>
            <button type="button" data-fullscreen title="${escapeHtml(t('present.remote.fullscreen'))}">${lucide('maximize', 15)}</button>
            <button type="button" data-as-remote title="${escapeHtml(t('present.screen.useAsRemote'))}">${lucide('smartphone', 15)}</button>
            <button type="button" data-leave title="${escapeHtml(t('present.remote.disconnect'))}">${lucide('log-out', 15)}</button>
          </div>
        </div>
      `;

      const screenEl = host.querySelector('[data-screen]');
      let cursorTimer = 0;

      // The pill and cursor show while the mouse moves, then get out of the way.
      const wake = () => {
        screenEl.classList.add('show-cursor');
        clearTimeout(cursorTimer);
        cursorTimer = setTimeout(() => screenEl.classList.remove('show-cursor'), 2500);
      };

      screenEl.addEventListener('pointermove', wake);
      screenEl.addEventListener('pointerdown', wake);

      host.querySelector('[data-fullscreen]').addEventListener('click', () => {
        document.documentElement.requestFullscreen?.().catch(() => {});
      });

      host.querySelector('[data-as-remote]').addEventListener('click', () => switchRole('remote'));

      host.querySelector('[data-leave]').addEventListener('click', () => {
        session.leave();
        ui?.destroy();
        ui = null;
        releaseWake();
        showStart();
      });

      // Clicker / keyboard on the screen device itself.
      const onKey = (e) => {
        if (['ArrowRight', 'PageDown', ' '].includes(e.key)) session.send('next');
        else if (['ArrowLeft', 'PageUp'].includes(e.key)) session.send('prev');
        else if (e.key === 'f' || e.key === 'F') document.documentElement.requestFullscreen?.().catch(() => {});
      };

      document.addEventListener('keydown', onKey);

      ui = {
        kind: 'screen',
        stage: null,
        mounting: false,
        destroy: () => {
          clearTimeout(cursorTimer);
          document.removeEventListener('keydown', onKey);
          ui?.stage?.destroy?.();
          host.replaceChildren();
        },
      };
    }

    const overlay = host.querySelector('[data-overlay]');
    const pill = host.querySelector('[data-pill]');
    const dot = host.querySelector('[data-dot]');

    dot.dataset.state = status;
    host.querySelector('[data-pill-text]').textContent = status === 'online'
      ? (state?.title || deck?.title || t('present.page.brand'))
      : t(`present.status.${status}`);

    // Problems stay visible; a healthy connection fades the pill.
    pill.classList.toggle('is-visible', status !== 'online');

    let overlayText = '';
    if (!deck || !state) overlayText = t('present.screen.loading');
    else if (!state.presenting) overlayText = t('present.screen.paused');

    overlay.hidden = !overlayText;
    overlay.textContent = overlayText;

    if (!deck || !state) return;

    if (!ui.stage && !ui.mounting) {
      ui.mounting = true;

      import('./present-stage.js')
        .then(({ mountPresentStage }) => mountPresentStage(host.querySelector('[data-stage-host]'), {
          deck,
          theme: deck.appState?.theme || 'light',
        }))
        .then((stage) => {
          if (ui?.kind !== 'screen') {
            stage.destroy();
            return;
          }

          ui.stage = stage;
          ui.mounting = false;
          stage.show({ index: state.index, step: state.step }, { animate: false });
          stage.setBlank(state.blank);
        })
        .catch((err) => {
          console.error('[YANTA Present] could not show the slides', err);
          if (ui) ui.mounting = false;
        });

      return;
    }

    if (ui.stage) {
      ui.stage.show({ index: state.index, step: state.step });
      ui.stage.setBlank(state.blank);
    }
  }
}

function showEnded(reason) {
  forgetJoinedSession();

  view(`
    <div class="yanta-pj">
      <div class="yanta-pj-center">
        ${lucide(reason === 'removed' ? 'log-out' : 'check-circle', 34)}
        <h1>${escapeHtml(reason === 'removed' ? t('present.page.removedTitle') : t('present.page.endedTitle'))}</h1>
        <p>${escapeHtml(reason === 'removed' ? t('present.page.removedText') : t('present.page.endedText'))}</p>
        <button type="button" class="yanta-pj-btn" data-again>${escapeHtml(t('present.page.again'))}</button>
      </div>
    </div>
  `);

  root.querySelector('[data-again]').addEventListener('click', () => showStart());
}

// ============================================================
// YANTA Chat — Onboarding UI
// ============================================================

import {
  el,
  lucide,
  toast,
  escapeHtml,
  escapeAttr,
} from '../core.js';

import {
  chatAccount,
  chatUsernameAvailable,
  chatProvision,
} from './chat-api.js';

import {
  requireChatCloudAuth,
  isChatAuthRequiredError,
  openYantaCloudLoginForChat,
} from './chat-cloud-auth.js';

let modal = null;
let statusEl = null;
let currentOptions = {};
let availabilityTimer = null;
let availabilitySeq = 0;

const CHAT_DOMAIN = 'yanta.me';
const HANDLE_MIN = 3;
const HANDLE_MAX = 32;
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/;

const state = {
  handle: '',
  availability: 'idle',
  available: false,
  message: '',
};

function reportError(message, err) {
  console.warn('[YANTA Chat]', err);
  toast(message || 'Chat error', 'error');
}

function normalizeHandle(raw = '') {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .split(':')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

function validateHandle(name) {
  if (!name) {
    return 'Choose your handle.';
  }

  if (name.length < HANDLE_MIN) {
    return `Use at least ${HANDLE_MIN} characters.`;
  }

  if (name.length > HANDLE_MAX) {
    return `Use at most ${HANDLE_MAX} characters.`;
  }

  if (!HANDLE_RE.test(name)) {
    return 'Use lowercase letters, numbers, dots, hyphens or underscores. Start and end with a letter or number.';
  }

  if (name.includes('..')) {
    return 'Avoid repeated dots.';
  }

  return '';
}

function setStatus(message = '', type = '') {
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = 'yanta-chat-status' + (type ? ` ${type}` : '');
}

function ensureCss() {
  if (document.getElementById('yanta-chat-onboarding-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-chat-onboarding-css';
  style.textContent = `
.yanta-chat-card {
  width: min(560px, 94vw);
}

.yanta-chat-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.yanta-chat-hero {
  display: flex;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 16%, transparent), transparent 44%),
    var(--bg-elev-2);
}

.yanta-chat-hero-icon {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  border-radius: 16px;
}

.yanta-chat-hero strong {
  display: block;
  color: var(--text);
  font-size: 15px;
  line-height: 1.3;
}

.yanta-chat-hero p {
  margin: 4px 0 0;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-chat-section {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev);
}

.yanta-chat-section h4 {
  margin: 0 0 8px;
  color: var(--text);
  font-size: 14px;
}

.yanta-chat-section p {
  margin: 0 0 10px;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-chat-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-chat-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.yanta-chat-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}

.yanta-chat-input-wrap input {
  width: 100%;
  padding-right: 42px;
  margin-bottom: 0;
}

.yanta-chat-availability {
  position: absolute;
  right: 10px;
  top: 50%;
  width: 22px;
  height: 22px;

  display: flex;
  align-items: center;
  justify-content: center;

  transform: translateY(-50%);
  color: var(--text-faint);
}

.yanta-chat-availability.available {
  color: var(--green);
}

.yanta-chat-availability.taken,
.yanta-chat-availability.invalid,
.yanta-chat-availability.error {
  color: var(--red);
}

.yanta-chat-availability.checking svg {
  animation: yanta-chat-spin 900ms linear infinite;
}

.yanta-chat-preview {
  display: flex;
  align-items: center;
  gap: 8px;

  min-height: 36px;
  padding: 8px 10px;

  color: var(--text);
  background: var(--bg-elev-2);

  border: 1px solid var(--border);
  border-radius: 10px;

  font-family: var(--font-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.yanta-chat-preview svg {
  color: var(--accent);
  flex: 0 0 auto;
}

.yanta-chat-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;

  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--yellow) 38%, var(--border));
  border-radius: 12px;

  background: color-mix(in srgb, var(--yellow) 9%, transparent);
  color: var(--text-dim);

  font-size: 12px;
  line-height: 1.45;
}

.yanta-chat-hint svg {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--yellow);
}

.yanta-chat-status {
  min-height: 18px;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
}

.yanta-chat-status.error {
  color: var(--red);
}

.yanta-chat-status.success {
  color: var(--green);
}

.yanta-chat-handle-help {
  min-height: 18px;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.4;
}

.yanta-chat-handle-help.available {
  color: var(--green);
}

.yanta-chat-handle-help.taken,
.yanta-chat-handle-help.invalid,
.yanta-chat-handle-help.error {
  color: var(--red);
}

.yanta-chat-auth-actions,
.yanta-chat-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.yanta-chat-auth-actions .grow,
.yanta-chat-actions .grow {
  flex: 1;
}

@keyframes yanta-chat-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 560px) {
  .yanta-chat-input-row,
  .yanta-chat-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .yanta-chat-actions .btn,
  .yanta-chat-auth-actions .btn {
    justify-content: center;
  }

  .yanta-chat-actions .grow,
  .yanta-chat-auth-actions .grow {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .yanta-chat-availability.checking svg {
    animation: none !important;
  }
}
`;
  document.head.append(style);
}

function close() {
  if (availabilityTimer) {
    clearTimeout(availabilityTimer);
    availabilityTimer = null;
  }

  availabilitySeq += 1;

  if (modal) {
    modal.hidden = true;
  }
}

function ensureModal() {
  if (modal) return modal;

  ensureCss();

  modal = el('div', {
    class: 'modal yanta-chat-modal',
    hidden: true,
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
    if (e.target.closest?.('[data-yanta-chat-close]')) close();
  });

  window.addEventListener('keydown', (e) => {
    if (modal?.hidden !== false) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }, true);

  document.body.append(modal);

  return modal;
}

function renderShell(title, bodyHtml) {
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-chat-card" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
      <header class="modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn" data-yanta-chat-close title="Close">&times;</button>
      </header>

      <div class="modal-body yanta-chat-body">
        ${bodyHtml}
        <div class="yanta-chat-status" data-status aria-live="polite"></div>
      </div>
    </div>
  `;

  statusEl = m.querySelector('[data-status]');
  m.hidden = false;
}

function availabilityIcon() {
  if (state.availability === 'checking') {
    return lucide('loader-2', 16);
  }

  if (state.availability === 'available') {
    return lucide('check-circle-2', 17);
  }

  if (
    state.availability === 'taken' ||
    state.availability === 'invalid' ||
    state.availability === 'error'
  ) {
    return lucide('x-circle', 17);
  }

  return lucide('circle', 14);
}

function availabilityLabel() {
  if (state.availability === 'checking') return 'Checking availability…';
  if (state.availability === 'available') return `${state.handle} is available.`;
  if (state.availability === 'taken') return state.message || 'This handle is already taken.';
  if (state.availability === 'invalid') return state.message || 'Choose a valid handle.';
  if (state.availability === 'error') return state.message || 'Could not check availability.';

  return `Use ${HANDLE_MIN}–${HANDLE_MAX} characters.`;
}

function syncHandleUi() {
  const indicator = modal?.querySelector('[data-chat-availability]');
  const help = modal?.querySelector('[data-chat-handle-help]');
  const preview = modal?.querySelector('[data-chat-preview]');
  const submit = modal?.querySelector('[data-chat-provision]');

  if (indicator) {
    indicator.className = `yanta-chat-availability ${state.availability}`;
    indicator.innerHTML = availabilityIcon();
  }

  if (help) {
    help.className = `yanta-chat-handle-help ${state.availability}`;
    help.textContent = availabilityLabel();
  }

  if (preview) {
    preview.innerHTML = `
      ${lucide('at-sign', 15)}
      <span>@${escapeHtml(state.handle || 'your-handle')}:${escapeHtml(CHAT_DOMAIN)}</span>
    `;
  }

  if (submit) {
    submit.disabled = !state.available || state.availability !== 'available';
  }
}

async function runAvailabilityCheck(name, seq) {
  const validationMessage = validateHandle(name);

  if (validationMessage) {
    state.availability = name ? 'invalid' : 'idle';
    state.available = false;
    state.message = validationMessage;
    syncHandleUi();
    return false;
  }

  state.availability = 'checking';
  state.available = false;
  state.message = '';
  syncHandleUi();

  try {
    const res = await chatUsernameAvailable(name);

    // Warum: User can type faster than the network. Old responses must not
    // overwrite newer input state.
    if (seq !== availabilitySeq || name !== state.handle) {
      return false;
    }

    const available = !!res?.available;

    state.availability = available ? 'available' : 'taken';
    state.available = available;
    state.message =
      res?.message ||
      (available ? `${name} is available.` : 'This handle is already taken.');

    syncHandleUi();

    return available;
  } catch (err) {
    if (seq !== availabilitySeq) {
      return false;
    }

    state.availability = 'error';
    state.available = false;
    state.message = err?.message || 'Could not check availability.';
    syncHandleUi();

    reportError('Could not check handle availability.', err);

    return false;
  }
}

function scheduleAvailabilityCheck(name) {
  if (availabilityTimer) {
    clearTimeout(availabilityTimer);
    availabilityTimer = null;
  }

  availabilitySeq += 1;
  const seq = availabilitySeq;

  state.handle = name;
  state.available = false;

  const validationMessage = validateHandle(name);

  if (validationMessage) {
    state.availability = name ? 'invalid' : 'idle';
    state.message = validationMessage;
    syncHandleUi();
    return;
  }

  state.availability = 'checking';
  state.message = 'Checking availability…';
  syncHandleUi();

  availabilityTimer = setTimeout(() => {
    runAvailabilityCheck(name, seq);
  }, 350);
}

function isProvisionedAccount(res) {
  const account = res?.account || res || {};
  const matrix = account.matrix || {};

  return !!(
    res?.provisioned ||
    account.provisioned ||
    account.userId ||
    account.user_id ||
    account.matrixUserId ||
    account.matrix_user_id ||
    account.matrixUserId ||
    account.mxid ||
    account.mx_id ||
    matrix.userId ||
    matrix.user_id ||
    matrix.mxid ||
    res?.matrixUserId ||
    res?.matrix_user_id ||
    res?.userId ||
    res?.user_id
  );
}

function normalizedAccount(res) {
  const account = res?.account || res || null;
  if (!account) return null;

  const matrix = account.matrix || {};

  return {
    ...account,

    // Keep original nested data, but expose common Matrix fields at top-level
    // for AP3. Warum: backend/API versions may use snake_case or nested
    // matrix payloads; AP3 should not depend on one exact response shape.
    userId:
      account.userId ||
      account.user_id ||
      account.matrixUserId ||
      account.matrix_user_id ||
      account.mxid ||
      matrix.userId ||
      matrix.user_id ||
      matrix.mxid ||
      '',

    homeserverUrl:
      account.homeserverUrl ||
      account.homeserver_url ||
      account.baseUrl ||
      account.base_url ||
      account.matrixHomeserverUrl ||
      account.matrix_homeserver_url ||
      matrix.homeserverUrl ||
      matrix.homeserver_url ||
      matrix.baseUrl ||
      matrix.base_url ||
      '',

    password:
      account.password ||
      account.matrixPassword ||
      account.matrix_password ||
      matrix.password ||
      matrix.matrixPassword ||
      matrix.matrix_password ||
      '',
  };
}

async function continueToChatBootstrap(account, {
  source = 'chat-onboarding',
} = {}) {
  try {
    if (typeof currentOptions.onProvisioned === 'function') {
      await currentOptions.onProvisioned(account, {
        source,
      });
      return;
    }

    if (typeof window.yantaOpenChat === 'function') {
      await window.yantaOpenChat({
        account,
        source,
      });
      return;
    }

    /*
      AP3 hook:
      AP3 can listen for this event and perform Matrix bootstrap/opening.
      We intentionally do not store secrets here. Any tokens must stay in
      memory/IndexedDB paths owned by the Matrix bootstrap layer.
    */
    window.dispatchEvent(new CustomEvent('yanta-chat-account-ready', {
      detail: {
        account,
        open: true,
        source,
      },
    }));
  } catch (err) {
    reportError('Could not open Chat.', err);
    throw err;
  }
}

function renderLoading() {
  renderShell('YANTA Chat', `
    <div class="yanta-chat-hero">
      <div class="yanta-chat-hero-icon">${lucide('messages-square', 28)}</div>
      <div>
        <strong>Preparing Chat…</strong>
        <p>Checking your YANTA Cloud login and Chat account.</p>
      </div>
    </div>
  `);

  setStatus('Loading…');
}

function renderAuthRequired() {
  renderShell('Sign in to activate Chat', `
    <div class="yanta-chat-hero">
      <div class="yanta-chat-hero-icon">${lucide('cloud', 28)}</div>
      <div>
        <strong>Chat requires YANTA Cloud login</strong>
        <p>Sign in first, then choose your permanent Chat handle.</p>
      </div>
    </div>

    <section class="yanta-chat-section">
      <h4>YANTA Cloud</h4>
      <p>Your Cloud account protects Chat registration and prevents handle abuse.</p>

      <div class="yanta-chat-auth-actions">
        <button class="btn primary" data-chat-open-cloud-login>
          ${lucide('log-in', 14)}
          Sign in to YANTA Cloud
        </button>

        <span class="grow"></span>

        <button class="btn" data-chat-retry-auth>
          ${lucide('refresh-cw', 14)}
          I’m signed in
        </button>
      </div>
    </section>
  `);

  setStatus('Sign in to continue.');

  modal.querySelector('[data-chat-open-cloud-login]')?.addEventListener('click', async () => {
    try {
      setStatus('Opening YANTA Cloud login…');

      await openYantaCloudLoginForChat();

      setStatus('After signing in, return here and tap “I’m signed in”.', 'success');
    } catch (err) {
      setStatus(err?.message || 'Could not open YANTA Cloud login.', 'error');
      reportError('Could not open YANTA Cloud login.', err);
    }
  });

  modal.querySelector('[data-chat-retry-auth]')?.addEventListener('click', () => {
    openChatOnboarding(currentOptions);
  });
}

function renderHandleStep({
  suggestedHandle = '',
} = {}) {
  state.handle = normalizeHandle(suggestedHandle);
  state.availability = state.handle ? 'checking' : 'idle';
  state.available = false;
  state.message = '';

  renderShell('Activate Chat', `
    <div class="yanta-chat-hero">
      <div class="yanta-chat-hero-icon">${lucide('message-circle-heart', 28)}</div>
      <div>
        <strong>Choose your Chat handle</strong>
        <p>This creates your Matrix-compatible YANTA Chat identity.</p>
      </div>
    </div>

    <section class="yanta-chat-section">
      <h4>Handle</h4>

      <div class="yanta-chat-field">
        <div class="yanta-chat-input-row">
          <div class="yanta-chat-input-wrap">
            <input
              class="text-input"
              data-chat-handle
              value="${escapeAttr(state.handle)}"
              placeholder="your-handle"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              maxlength="${HANDLE_MAX}" />

            <span class="yanta-chat-availability idle" data-chat-availability aria-hidden="true">
              ${lucide('circle', 14)}
            </span>
          </div>
        </div>

        <div class="yanta-chat-preview" data-chat-preview>
          ${lucide('at-sign', 15)}
          <span>@${escapeHtml(state.handle || 'your-handle')}:${escapeHtml(CHAT_DOMAIN)}</span>
        </div>

        <div class="yanta-chat-handle-help" data-chat-handle-help aria-live="polite">
          Use ${HANDLE_MIN}–${HANDLE_MAX} characters.
        </div>
      </div>
    </section>

    <div class="yanta-chat-hint">
      ${lucide('triangle-alert', 15)}
      <span>
        Your handle is permanent and may eventually become your YANTA email address.
        Choose something you’re comfortable keeping.
      </span>
    </div>

    <div class="yanta-chat-actions">
      <button class="btn" data-yanta-chat-close>
        Cancel
      </button>

      <span class="grow"></span>

      <button class="btn primary" data-chat-provision disabled>
        ${lucide('sparkles', 14)}
        Activate Chat
      </button>
    </div>
  `);

  const input = modal.querySelector('[data-chat-handle]');
  const provisionBtn = modal.querySelector('[data-chat-provision]');

  input?.addEventListener('input', () => {
    const normalized = normalizeHandle(input.value);

    if (input.value !== normalized) {
      const pos = normalized.length;
      input.value = normalized;
      input.setSelectionRange?.(pos, pos);
    }

    scheduleAvailabilityCheck(normalized);
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      provisionBtn?.click();
    }
  });

  provisionBtn?.addEventListener('click', async () => {
    const name = normalizeHandle(input?.value || '');
    const validationMessage = validateHandle(name);

    if (validationMessage) {
      state.handle = name;
      state.availability = 'invalid';
      state.available = false;
      state.message = validationMessage;
      syncHandleUi();
      setStatus(validationMessage, 'error');
      return;
    }

    try {
      provisionBtn.disabled = true;
      setStatus('Final availability check…');

      availabilitySeq += 1;
      const seq = availabilitySeq;
      const available = await runAvailabilityCheck(name, seq);

      if (!available) {
        setStatus(state.message || 'Choose another handle.', 'error');
        return;
      }

      setStatus('Activating Chat…');

      await requireChatCloudAuth();

      const res = await chatProvision(name);
      const account = normalizedAccount(res);

      setStatus('Chat activated.', 'success');
      toast('Chat activated', 'success');

      close();

      await continueToChatBootstrap(account, {
        source: 'chat-provision',
      });
    } catch (err) {
      provisionBtn.disabled = false;

      if (isChatAuthRequiredError(err)) {
        setStatus('Sign in to YANTA Cloud to activate Chat.', 'error');
        reportError('Sign in to YANTA Cloud to activate Chat.', err);
        renderAuthRequired();
        return;
      }

      setStatus(err?.message || 'Could not activate Chat.', 'error');
      reportError('Could not activate Chat.', err);
    }
  });

  syncHandleUi();

  if (state.handle) {
    scheduleAvailabilityCheck(state.handle);
  }

  setTimeout(() => {
    input?.focus();
    input?.select?.();
  }, 0);
}

function suggestedHandleFromAuth(auth) {
  const email = String(auth?.me?.user?.email || '').trim().toLowerCase();
  const local = email.split('@')[0] || '';

  return normalizeHandle(local.replace(/\+/g, '.'));
}

/**
 * Opens the Chat onboarding flow.
 *
 * If the user already has a Chat account, this jumps directly to the AP3
 * bootstrap hook and opens Chat.
 */
export async function openChatOnboarding(options = {}) {
  currentOptions = {
    ...currentOptions,
    ...options,
  };

  renderLoading();

  let auth = null;

  try {
    auth = await requireChatCloudAuth();
  } catch (err) {
    if (isChatAuthRequiredError(err)) {
      console.warn('[YANTA Chat] Cloud login required', err);
      toast('Sign in to YANTA Cloud to activate Chat.', 'error');
      renderAuthRequired();
      return;
    }

    setStatus(err?.message || 'Could not verify Cloud login.', 'error');
    reportError('Could not verify Cloud login.', err);
    return;
  }

  try {
    setStatus('Checking Chat account…');

    const res = await chatAccount();

    if (isProvisionedAccount(res)) {
      close();

      await continueToChatBootstrap(normalizedAccount(res), {
        source: 'chat-existing-account',
      });

      return;
    }

    renderHandleStep({
      suggestedHandle: res?.suggestedName || suggestedHandleFromAuth(auth),
    });
  } catch (err) {
    if (err?.status === 404) {
      renderHandleStep({
        suggestedHandle: suggestedHandleFromAuth(auth),
      });
      return;
    }

    if (isChatAuthRequiredError(err)) {
      console.warn('[YANTA Chat] Cloud login required', err);
      toast('Sign in to YANTA Cloud to activate Chat.', 'error');
      renderAuthRequired();
      return;
    }

    setStatus(err?.message || 'Could not load Chat account.', 'error');
    reportError('Could not load Chat account.', err);
  }
}

/**
 * Ensures a Chat account exists and opens Chat.
 */
export async function ensureChatAccountAndOpen(options = {}) {
  return openChatOnboarding(options);
}

/**
 * Closes the Chat onboarding modal.
 */
export function closeChatOnboarding() {
  close();
}
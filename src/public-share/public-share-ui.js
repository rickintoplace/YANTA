import { renderBrandedQrSvg } from '../qr.js';
import { BRAND_LOGO_SVG } from '../brand-logo.js';

import {
  state,
  escapeHtml,
  lucide,
  toast,
} from '../core.js';

import {
  stopSharing as stopLegacyLiveSharing,
} from '../sharing.js';

import {
  createSpaceForNote,
  createSpaceForFolder,
  stopSpaceShare,
  spaceSessionForNote,
  spaceSessionForFolder,
  spaceLinksFor,
  leaveSpace,
  apiListSpaceMembers,
  apiAddSpaceMember,
  apiRemoveSpaceMember,
  rotateSpaceWriteAccess,
} from '../spaces/space-session.js';

import {
  sendSpaceInvite,
  sendSpaceRevokeNotice,
  sendSpaceLinkMessage,
} from '../spaces/space-matrix.js';

import {
  resolveMatrixClient,
  normalizeUserId,
} from '../chat/chat-actions.js';

import {
  createOrGetPublicShare,
  publishPublicShareNow,
  publicShareStateForNote,
  stopPublicShare,
  stopPublicShareById,
  stopAllPublicShares,
  isPublicShareActive,
  refreshOwnPublicShareStatusFromCloud,
} from './public-share-publisher.js';

import {
  listOwnPublicShares,
} from './public-share-api.js';

import {
  makePublicShareUrl,
} from './public-share-crypto.js';

import {
  openYantaCloudSetup,
} from '../sync2/yanta-cloud-setup-ui.js';

import {
  yantaConfirm,
} from '../dialogs.js';

import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
  overlayIdFromState,
} from '../overlay-history.js';

let modal = null;
let shareOverlayRegistered = false;

// What the dialog is currently sharing: a single note, or a folder
// subtree as a live workspace. The Live and People tabs work for both;
// public read-only links exist for notes only.
let shareTarget = { kind: 'note', id: '' };

function targetIsFolder() {
  return shareTarget.kind === 'folder';
}

function targetTitle() {
  return targetIsFolder()
    ? state.folders.get(shareTarget.id)?.name || 'Untitled folder'
    : state.notes.get(shareTarget.id)?.title || 'Untitled';
}

function targetSession() {
  return targetIsFolder()
    ? spaceSessionForFolder(shareTarget.id)
    : spaceSessionForNote(shareTarget.id);
}

async function createTargetSpace() {
  return targetIsFolder()
    ? createSpaceForFolder(shareTarget.id)
    : createSpaceForNote(shareTarget.id);
}

function unifiedShareModalIsOpen() {
  return !!modal && modal.hidden === false;
}

function publicSharesManagerIsOpen() {
  return !!managerModal && managerModal.hidden === false;
}

function registerShareOverlayRoutes() {
  if (shareOverlayRegistered) return;

  shareOverlayRegistered = true;

  registerOverlayRoute('share-note', {
    open: ({ data, state: historyState } = {}) => {
      const folderId = data?.folderId || historyState?.folderId || '';

      if (folderId) {
        return openUnifiedShareModal({
          fromHistory: true,
          folderId,
        });
      }

      const noteId =
        data?.noteId ||
        historyState?.noteId ||
        state.currentNoteId ||
        '';

      if (noteId && state.notes.has(noteId)) {
        state.currentNoteId = noteId;
      }

      return openUnifiedShareModal({
        fromHistory: true,
      });
    },

    close: () => {
      closeUnifiedShareModal({
        fromHistory: true,
      });
    },

    isOpen: unifiedShareModalIsOpen,
  });

  registerOverlayRoute('public-shares-manager', {
    open: () => {
      return openPublicSharesManager({
        fromHistory: true,
      });
    },

    close: () => {
      closePublicSharesManager({
        fromHistory: true,
      });
    },

    isOpen: publicSharesManagerIsOpen,
  });
}

function ensureCss() {
  if (document.getElementById('yanta-public-share-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-public-share-css';
  style.textContent = `
.yanta-public-share-card {
  width: min(620px, 94vw);
}

.yanta-share-tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
  margin-bottom: 14px;
}

.yanta-share-tabs button {
  flex: 1;
  min-height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 750;
}

.yanta-share-tabs button.active {
  background: var(--bg-elev-3);
  color: var(--accent);
}

.yanta-public-share-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yanta-public-share-info {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.5;
}

.yanta-public-share-status {
  padding: 9px 10px;
  border-radius: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
}

.yanta-public-share-status.good {
  color: var(--green);
  border-color: color-mix(in srgb, var(--green) 38%, var(--border));
}

.yanta-public-share-status.warn {
  color: var(--yellow);
  border-color: color-mix(in srgb, var(--yellow) 38%, var(--border));
}

.yanta-public-share-status.error {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 45%, var(--border));
}

.yanta-public-share-link-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.yanta-public-share-link-row input {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
}

  .yanta-public-share-qr {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 18px;
    border-radius: 18px;
    background: white;
    box-shadow: 0 8px 24px rgba(0,0,0,0.08);
    overflow: hidden;
    width: fit-content;
    margin: auto;
  }

  .yanta-public-share-qr svg {
    display: block;
    max-width: 100%;
    height: auto;
  }


.yanta-public-share-danger {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.yanta-public-share-link-row .btn.success {
  color: white;
  background: var(--green);
  border-color: var(--green);
}

.yanta-public-share-link-row .btn.success svg {
  animation: yanta-public-share-copy-pop 360ms cubic-bezier(.2,.8,.2,1);
}

@keyframes yanta-public-share-copy-pop {
  0% {
    transform: scale(0.62) rotate(-18deg);
    opacity: 0;
  }
  55% {
    transform: scale(1.18) rotate(4deg);
    opacity: 1;
  }
  100% {
    transform: scale(1) rotate(0);
    opacity: 1;
  }
}

.yanta-public-shares-manager-card {
  width: min(760px, 94vw);
}

.yanta-public-shares-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-public-share-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;

  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;

  background: var(--bg-elev-2);
}

.yanta-public-share-row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yanta-public-share-row-main strong {
  color: var(--text);
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-public-share-row-main small {
  color: var(--text-faint);
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-public-share-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.yanta-public-shares-empty {
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  color: var(--text-faint);
  text-align: center;
  font-size: 13px;
}

.compress-actions.sharing-options {
    flex-direction: row;
    flex-wrap: wrap;
}

.compress-actions.sharing-options button.btn.primary {
    flex: auto;
}

.yanta-share-link-section {
  display: grid;
  gap: 0.45rem;
}

.yanta-share-link-info {
  display: grid;
  gap: 0.2rem;
}

.yanta-share-link-title,
.yanta-share-qr-title {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.yanta-share-link-title svg,
.yanta-share-qr-title svg {
  color: var(--accent);
}

.yanta-copy-compact {
  width: auto;
  min-width: 2.25rem;
  padding-inline: 0.65rem;
  flex: 0 0 auto;
}

.yanta-qr-toggle {
  flex: 0 0 auto;
}

.yanta-qr-toggle.is-active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.yanta-share-qr-panel {
  display: grid;
  justify-items: center;
  gap: 0.75rem;
  padding-block: 0.5rem;
}

.yanta-share-qr-heading {
  display: grid;
  justify-items: center;
  gap: 0.2rem;
  text-align: center;
}

.yanta-share-qr-heading small {
  color: var(--text-faint);
}

@media (max-width: 680px) {
  .yanta-public-share-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .yanta-public-share-row-actions .btn {
    width: 100%;
    justify-content: center;
  }
}
  `;
  document.head.append(style);
}

function ensureModal() {
  registerShareOverlayRoutes();

  if (modal) return modal;

  ensureCss();

  modal = document.createElement('div');
  modal.className = 'modal yanta-public-share-modal';
  modal.hidden = true;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeUnifiedShareModal();
    if (e.target.closest?.('[data-public-share-close]')) closeUnifiedShareModal();
  });

  document.body.append(modal);

  return modal;
}

export function closeUnifiedShareModal({
  fromHistory = false,
} = {}) {
  if (!modal) return;

  /*
    Only consume history if the current overlay is actually share-note.
    This prevents closing a parent overlay accidentally.
  */
  if (
    !fromHistory &&
    modal.hidden === false &&
    overlayIdFromState() === 'share-note'
  ) {
    closeTopOverlay(() => {
      closeUnifiedShareModal({
        fromHistory: true,
      });
    });

    return;
  }

  modal.hidden = true;
}

function statusText(status) {
  const map = {
    active: 'Shared · active',
    pending: 'Shared · changes pending',
    publishing: 'Shared · publishing…',
    'up-to-date': 'Shared · up to date',
    failed: 'Shared · publish failed',
    revoked: 'Sharing stopped',
  };

  return map[status] || 'Not shared yet';
}

function statusClass(status) {
  if (status === 'up-to-date') return 'good';
  if (status === 'failed') return 'error';
  if (status === 'pending' || status === 'publishing') return 'warn';
  return '';
}

async function renderPublicTab(noteId) {
  const share = publicShareStateForNote(noteId);
  const hasShare = isPublicShareActive(share);
  const hasPrivateKey = !!share?.shareKey;

  const url = hasShare && hasPrivateKey
    ? share.url || makePublicShareUrl(share.shareId, share.shareKey)
    : '';

  const body = modal.querySelector('[data-share-body]');
  if (!body) return;

  body.innerHTML = `
    <div class="yanta-public-share-box">
      <div class="yanta-public-share-info">
        <strong>Public link</strong><br>
        Anyone with the full link can read the latest published version.
        The private key is after <code>#k=</code> and is not sent to the server.
      </div>

      ${
        hasShare
          ? `
            <div class="yanta-public-share-status ${statusClass(share.status)}">
              ${escapeHtml(
                hasPrivateKey
                  ? statusText(share.status)
                  : 'Shared · private link key not available on this device'
              )}
              ${
                share.lastError
                  ? `<br>${escapeHtml(share.lastError)}`
                  : ''
              }
            </div>

            ${
              hasPrivateKey
                ? `
                  <div class="yanta-public-share-link-row">
                    <input class="text-input" data-public-share-link readonly value="${escapeHtml(url)}">
                    <button class="btn primary" data-copy-public-share>${lucide('copy', 14)} Copy</button>
                  </div>

                  <div class="yanta-public-share-qr" data-public-share-qr></div>

                  ${
                    Array.isArray(share.missingAssets) && share.missingAssets.length
                      ? `
                        <div class="yanta-public-share-status warn">
                          ${share.missingAssets.length} asset${share.missingAssets.length === 1 ? '' : 's'} missing and not included.
                        </div>
                      `
                      : ''
                  }

                  <div class="compress-actions">
                    <button class="btn" data-publish-public-share>
                      ${lucide('refresh-cw', 14)}
                      ${share.status === 'failed' ? 'Retry publish' : 'Publish pending changes'}
                    </button>
                    <span class="grow"></span>
                    <button class="btn" data-open-public-shares-manager>
                      ${lucide('list', 14)}
                      Manage public links
                    </button>
                    <button class="btn danger" data-stop-public-share>
                      ${lucide('globe-off', 14)}
                      Stop sharing
                    </button>
                  </div>
                `
                : `
                  <div class="yanta-public-share-info">
                    This note already has an active public link, created on another device.
                    This device does not have the private link key yet, so it cannot copy or republish
                    the exact link. You can still stop sharing immediately.
                  </div>

                  <div class="compress-actions">
                    <button class="btn" data-open-public-shares-manager>
                      ${lucide('list', 14)}
                      Manage public links
                    </button>
                    <span class="grow"></span>
                    <button class="btn danger" data-stop-public-share>
                      ${lucide('globe-off', 14)}
                      Stop sharing
                    </button>
                  </div>
                `
            }

            <div class="yanta-public-share-danger">
              <small style="color:var(--text-faint)">
                Stopping sharing prevents future access through this link. It cannot remove copies already downloaded.
              </small>
            </div>
          `
          : `
            <label>
              Expires
              <select class="text-input" data-public-share-expiry>
                <option value="2592000000">30 days</option>
                <option value="86400000">1 day</option>
                <option value="0">Until revoked</option>
              </select>
            </label>

            <div class="compress-actions sharing-options">
              <button class="btn primary" data-create-public-share>
                ${lucide('link', 14)}
                Create public link
              </button>
              <button class="btn" data-open-public-shares-manager>
                ${lucide('list', 14)}
                Manage public links
              </button>
              <button class="btn" data-open-cloud-setup>
                ${lucide('cloud', 14)}
                Set up YANTA Cloud
              </button>
            </div>
          `
      }
    </div>
  `;

  if (hasShare && hasPrivateKey) {
    body.querySelector('[data-public-share-qr]')?.append(renderBrandedQrSvg(url, {
      size: 220,
      logo: BRAND_LOGO_SVG,
    }));
  }

  body.querySelector('[data-copy-public-share]')?.addEventListener('click', async (e) => {
    if (!url) {
      toast('Private share key is not available on this device', 'error');
      return;
    }

    const btn = e.currentTarget;
    const originalHtml = btn.dataset.originalHtml || btn.innerHTML;
    btn.dataset.originalHtml = originalHtml;

    const width = Math.ceil(btn.getBoundingClientRect().width || 0);
    const previousMinWidth = btn.style.minWidth;

    if (width) btn.style.minWidth = `${width}px`;

    try {
      await navigator.clipboard.writeText(url);

      btn.disabled = true;
      btn.classList.add('success');
      btn.innerHTML = `${lucide('check', 14)} Copied`;

      window.setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('success');
        btn.innerHTML = originalHtml;
        btn.style.minWidth = previousMinWidth;
      }, 1300);
    } catch {
      toast('Copy failed', 'error');
      btn.style.minWidth = previousMinWidth;
    }
  });

  body.querySelector('[data-create-public-share]')?.addEventListener('click', async () => {
    try {
      const ttl = Number(body.querySelector('[data-public-share-expiry]')?.value || 0);
      const expiresAt = ttl > 0 ? Date.now() + ttl : null;

      body.querySelector('[data-create-public-share]').disabled = true;

      await createOrGetPublicShare(noteId, {
        expiresAt,
      });

      await publishPublicShareNow(noteId, {
        force: true,
        expiresAt,
      });

      await renderPublicTab(noteId);
      toast('Public link created', 'success');
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Could not create public link', 'error');
      await renderPublicTab(noteId);
    }
  });

  body.querySelector('[data-publish-public-share]')?.addEventListener('click', async () => {
    try {
      await publishPublicShareNow(noteId, {
        force: true,
      });

      await renderPublicTab(noteId);
      toast('Public share published', 'success');
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Publish failed', 'error');
      await renderPublicTab(noteId);
    }
  });

  body.querySelector('[data-stop-public-share]')?.addEventListener('click', async () => {
    const ok = await yantaConfirm({
      title: 'Stop public sharing?',
      message: [
        'Stop public sharing for this note?',
        '',
        'Future access through this public link will be blocked.',
        'Copies already downloaded cannot be removed.',
      ].join('\n'),
      confirmLabel: 'Stop sharing',
      cancelLabel: 'Cancel',
      danger: true,
      icon: 'globe-off',
    });

    if (!ok) return;

    try {
      await stopPublicShare(noteId);
      await renderPublicTab(noteId);
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Could not stop sharing', 'error');
    }
  });

  body.querySelector('[data-open-cloud-setup]')?.addEventListener('click', async () => {
    await openYantaCloudSetup();
  });

  body.querySelector('[data-open-public-shares-manager]')?.addEventListener('click', async () => {
    await openPublicSharesManager();
  });
}

function wireCopyButton(btn, value) {
  btn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);

      const originalHtml = btn.dataset.originalHtml || btn.innerHTML;
      btn.dataset.originalHtml = originalHtml;
      btn.classList.add('success');
      btn.innerHTML = `${lucide('check', 14)} Copied`;

      window.setTimeout(() => {
        btn.classList.remove('success');
        btn.innerHTML = originalHtml;
      }, 1300);
    } catch {
      toast('Copy failed', 'error');
    }
  });
}

async function renderLiveTab() {
  const body = modal.querySelector('[data-share-body]');
  if (!body) return;

  const isFolder = targetIsFolder();
  const thing = isFolder ? 'folder' : 'note';
  const session = targetSession();
  const legacy = !isFolder ? state.liveShares.get(shareTarget.id) : null;

  // Recipient view: mounted from someone else's space.
  if (session && session.role !== 'owner') {
    const roleLabel = session.role === 'write'
      ? `You can read and edit this shared ${thing}.`
      : `You have read-only access to this shared ${thing}.`;

    body.innerHTML = `
      <div class="yanta-public-share-box">
        <div class="yanta-public-share-info">
          <strong>Shared with you</strong><br>
          ${roleLabel} Changes sync even while the owner is offline.
        </div>

        <div class="compress-actions">
          <span class="grow"></span>
          <button class="btn danger" data-leave-space>${lucide('log-out', 14)} Leave share</button>
        </div>
      </div>
    `;

    body.querySelector('[data-leave-space]')?.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: 'Leave this share?',
        message: `The shared ${thing} will be removed from this device. You can rejoin anytime with the link.`,
        confirmLabel: 'Leave share',
        cancelLabel: 'Cancel',
        danger: true,
        icon: 'log-out',
      });

      if (!ok) return;

      await leaveSpace(session.spaceId);
      closeUnifiedShareModal();
      toast('Left the share');
    });

    return;
  }

  // Owner view without an active space yet.
  if (!session) {
    body.innerHTML = `
      <div class="yanta-public-share-box">
        <div class="yanta-public-share-info">
          <strong>Live share</strong><br>
          ${
            isFolder
              ? 'Share this folder as a live workspace — editors can add, change and remove notes inside it.'
              : 'Invite people to read or edit this note in real time — drawings included.'
          }
          Everything is end-to-end encrypted, and the share keeps working when you go offline.
        </div>

        <div class="compress-actions sharing-options">
          <button class="btn primary" data-start-space-share>
            ${lucide('users', 14)}
            Start live share
          </button>
          <button class="btn" data-open-cloud-setup>
            ${lucide('cloud', 14)}
            Set up YANTA Cloud
          </button>
        </div>

        ${
          legacy
            ? `
              <div class="yanta-public-share-status warn">
                A legacy live share is still active for this note. It only works while this device is online.
              </div>
              <div class="compress-actions">
                <span class="grow"></span>
                <button class="btn danger" data-stop-legacy-share>${lucide('x', 14)} Stop legacy share</button>
              </div>
            `
            : ''
        }
      </div>
    `;

    body.querySelector('[data-start-space-share]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;

      try {
        await createTargetSpace();
        await renderLiveTab();
        toast('Live share started', 'success');
      } catch (err) {
        console.error(err);
        btn.disabled = false;

        if (err?.status === 401) {
          toast('Sign in to YANTA Cloud to start a live share', 'error');
        } else {
          toast(err?.message || 'Could not start live share', 'error');
        }
      }
    });

    body.querySelector('[data-open-cloud-setup]')?.addEventListener('click', async () => {
      await openYantaCloudSetup();
    });

    body.querySelector('[data-stop-legacy-share]')?.addEventListener('click', async () => {
      await stopLegacyLiveSharing(shareTarget.id);
      await renderLiveTab();
    });

    return;
  }

// Owner view with an active space.
const links = spaceLinksFor(session);
const peers = session.peers || 0;

body.innerHTML = `
  <div class="yanta-public-share-box">
    <div class="yanta-public-share-status good">
      ${
        isFolder
          ? 'Workspace share active · changes sync for everyone with access'
          : `Live share active · ${peers} ${peers === 1 ? 'person' : 'people'} connected live`
      }
    </div>

    <div class="yanta-share-link-section">
      <div class="yanta-public-share-info yanta-share-link-info">
        <div class="yanta-share-link-title">
          ${lucide('eye', 15)}
          <strong>Read link</strong>
        </div>
        <span>Anyone with it can view, near-live, but never edit.</span>
      </div>

      <div class="yanta-public-share-link-row">
        <input class="text-input" data-space-read-link readonly value="${escapeHtml(links.read)}">

        <button
          class="btn yanta-qr-toggle is-active"
          data-space-qr-read
          type="button"
          aria-pressed="true"
          title="Show read QR code"
        >
          ${lucide('qr-code', 14)}
          <span>QR</span>
        </button>

        <button
          class="btn primary yanta-copy-compact"
          data-copy-space-read
          type="button"
          aria-label="Copy read link"
          title="Copy read link"
        >
          ${lucide('copy', 14)}
        </button>
      </div>
    </div>

    ${
      links.write
        ? `
          <div class="yanta-share-link-section">
            <div class="yanta-public-share-info yanta-share-link-info">
              <div class="yanta-share-link-title">
                ${lucide('pencil', 15)}
                <strong>Edit link</strong>
              </div>
              <span>Anyone with it can edit in real time. Share carefully.</span>
            </div>

            <div class="yanta-public-share-link-row">
              <input class="text-input" data-space-write-link readonly value="${escapeHtml(links.write)}">

              <button
                class="btn yanta-qr-toggle"
                data-space-qr-write
                type="button"
                aria-pressed="false"
                title="Show edit QR code"
              >
                ${lucide('qr-code', 14)}
                <span>QR</span>
              </button>

              <button
                class="btn primary yanta-copy-compact"
                data-copy-space-write
                type="button"
                aria-label="Copy edit link"
                title="Copy edit link"
              >
                ${lucide('copy', 14)}
              </button>
            </div>
          </div>
        `
        : ''
    }

    <div class="yanta-share-qr-panel">
      <div class="yanta-share-qr-heading" data-space-qr-heading></div>
      <div class="yanta-public-share-qr" data-space-qr></div>
    </div>

    <div class="compress-actions">
      <span class="grow"></span>
      <button class="btn danger" data-stop-space-share>
        ${lucide('x', 14)}
        Stop live share
      </button>
    </div>

    <div class="yanta-public-share-danger">
      <small style="color:var(--text-faint)">
        Stopping removes the encrypted share data from the cloud and blocks all links immediately.
      </small>
    </div>
  </div>
`;

const qrHost = body.querySelector('[data-space-qr]');
const qrHeading = body.querySelector('[data-space-qr-heading]');
const readQrButton = body.querySelector('[data-space-qr-read]');
const writeQrButton = body.querySelector('[data-space-qr-write]');

const setQrButtonState = (mode) => {
  readQrButton?.classList.toggle('is-active', mode === 'read');
  readQrButton?.setAttribute('aria-pressed', mode === 'read' ? 'true' : 'false');

  writeQrButton?.classList.toggle('is-active', mode === 'write');
  writeQrButton?.setAttribute('aria-pressed', mode === 'write' ? 'true' : 'false');
};

const showQr = (mode) => {
  if (!qrHost) return;

  const isWrite = mode === 'write';
  const url = isWrite ? links.write : links.read;

  if (!url) return;

  if (qrHeading) {
    qrHeading.innerHTML = isWrite
      ? `
        <div class="yanta-share-qr-title">
          ${lucide('pencil', 16)}
          <strong>Edit QR code</strong>
        </div>
        <small>Scan to join with editing access.</small>
      `
      : `
        <div class="yanta-share-qr-title">
          ${lucide('eye', 16)}
          <strong>Read QR code</strong>
        </div>
        <small>Scan to open read-only access.</small>
      `;
  }

  qrHost.replaceChildren(renderBrandedQrSvg(url, {
    size: 220,
    logo: BRAND_LOGO_SVG,
  }));

  setQrButtonState(mode);
};

showQr('read');

readQrButton?.addEventListener('click', () => showQr('read'));
writeQrButton?.addEventListener('click', () => showQr('write'));

wireCopyButton(body.querySelector('[data-copy-space-read]'), links.read);

if (links.write) {
  wireCopyButton(body.querySelector('[data-copy-space-write]'), links.write);
}

body.querySelector('[data-stop-space-share]')?.addEventListener('click', async () => {
  const ok = await yantaConfirm({
    title: 'Stop live sharing?',
    message: [
      `Stop live sharing this ${thing}?`,
      '',
      'All links stop working and the encrypted share data is deleted from the cloud.',
      'Copies already synced to other devices cannot be removed.',
    ].join('\n'),
    confirmLabel: 'Stop sharing',
    cancelLabel: 'Cancel',
    danger: true,
    icon: 'x',
  });

  if (!ok) return;

  try {
    await stopSpaceShare(session.spaceId);
    await renderLiveTab();
  } catch (err) {
    console.error(err);
    toast(err?.message || 'Could not stop sharing', 'error');
  }
});
}

// ---------------- People tab (Matrix-ID grants) -------------------

async function ownMatrixServer() {
  try {
    const client = await resolveMatrixClient();
    const userId = String(client?.getUserId?.() || '');
    const idx = userId.indexOf(':');
    return idx > 0 ? userId.slice(idx + 1) : '';
  } catch {
    return '';
  }
}

// Rotating write access invalidates the writer secret every member
// held — remaining writers need a fresh bundle delivered over Matrix.
async function rotateAndRedeliver(session) {
  const record = await rotateSpaceWriteAccess(session.spaceId);
  const members = await apiListSpaceMembers(session.spaceId).catch(() => []);

  for (const member of members) {
    if (member.role !== 'write' || !member.matrixUserId) continue;

    await sendSpaceInvite(record, member.matrixUserId, 'write').catch((err) => {
      console.warn('[YANTA Spaces] re-delivery after rotation failed', member.matrixUserId, err);
      toast(`Could not re-deliver keys to ${member.matrixUserId}`, 'error');
    });
  }
}

async function renderPeopleTab() {
  const body = modal.querySelector('[data-share-body]');
  if (!body) return;

  const session = targetSession();

  if (!session || session.role !== 'owner') {
    body.innerHTML = `
      <div class="yanta-public-share-box">
        <div class="yanta-public-share-info">
          <strong>People</strong><br>
          Give specific people read or edit access via their Matrix ID.
          Start a live share first — keys are delivered end-to-end encrypted over Chat.
        </div>

        <div class="compress-actions">
          <button class="btn primary" data-people-start-share>
            ${lucide('users', 14)}
            Start live share
          </button>
        </div>
      </div>
    `;

    body.querySelector('[data-people-start-share]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;

      try {
        await createTargetSpace();
      } catch (err) {
        console.error(err);
        toast(err?.status === 401
          ? 'Sign in to YANTA Cloud to start a live share'
          : err?.message || 'Could not start live share', 'error');
      }

      await renderPeopleTab();
    });

    return;
  }

  body.innerHTML = `
    <div class="yanta-public-share-box">
      <div class="yanta-public-share-info">
        <strong>People</strong><br>
        Invite by Matrix ID (e.g. <code>@anna:yanta.me</code>) or YANTA handle.
        Keys are delivered end-to-end encrypted over Chat; access is enforced by the server.
      </div>

      <div class="yanta-public-share-link-row">
        <input class="text-input" data-people-input placeholder="@user:yanta.me">
        <select class="text-input" data-people-role style="max-width:120px">
          <option value="read">Can view</option>
          <option value="write">Can edit</option>
        </select>
        <button class="btn primary" data-people-add>${lucide('user-plus', 14)} Add</button>
      </div>

      <div class="yanta-public-shares-list" data-people-list>
        <div class="yanta-public-shares-empty">Loading…</div>
      </div>
    </div>
  `;

  const listHost = body.querySelector('[data-people-list]');

  const renderMembers = async () => {
    let members = [];

    try {
      members = await apiListSpaceMembers(session.spaceId);
    } catch (err) {
      listHost.innerHTML = `<div class="yanta-public-shares-empty">${escapeHtml(err?.message || 'Could not load members')}</div>`;
      return;
    }

    if (!members.length) {
      listHost.innerHTML = '<div class="yanta-public-shares-empty">Nobody has personal access yet.</div>';
      return;
    }

    listHost.replaceChildren();

    for (const member of members) {
      const row = document.createElement('div');
      row.className = 'yanta-public-share-row';

      row.innerHTML = `
        <div class="yanta-public-share-row-main">
          <strong>${escapeHtml(member.matrixUserId || member.userId)}</strong>
          <small>${member.role === 'write' ? 'Can edit' : 'Can view'}</small>
        </div>
        <div class="yanta-public-share-row-actions">
          <select class="text-input" data-member-role style="max-width:110px">
            <option value="read" ${member.role === 'read' ? 'selected' : ''}>Can view</option>
            <option value="write" ${member.role === 'write' ? 'selected' : ''}>Can edit</option>
          </select>
          <button class="btn danger" data-member-remove title="Remove access">${lucide('user-x', 14)}</button>
        </div>
      `;

      row.querySelector('[data-member-role]')?.addEventListener('change', async (e) => {
        const newRole = e.target.value === 'write' ? 'write' : 'read';
        if (newRole === member.role) return;

        e.target.disabled = true;

        try {
          await apiAddSpaceMember(session.spaceId, {
            matrixUserId: member.matrixUserId,
            role: newRole,
          });

          if (member.role === 'write' && newRole === 'read') {
            // Downgraded writers held the writer secret — rotate it.
            await rotateAndRedeliver(session);
          }

          await sendSpaceInvite(session.record, member.matrixUserId, newRole).catch((err) => {
            console.warn('[YANTA Spaces] role-change delivery failed', err);
          });

          toast('Access updated', 'success');
        } catch (err) {
          console.error(err);
          toast(err?.message || 'Could not change access', 'error');
        }

        await renderMembers();
      });

      row.querySelector('[data-member-remove]')?.addEventListener('click', async () => {
        const ok = await yantaConfirm({
          title: 'Remove access?',
          message: `Remove ${member.matrixUserId || 'this member'} from this share? They lose access immediately.`,
          confirmLabel: 'Remove',
          cancelLabel: 'Cancel',
          danger: true,
          icon: 'user-x',
        });

        if (!ok) return;

        try {
          await apiRemoveSpaceMember(session.spaceId, member.userId);

          if (member.role === 'write') {
            await rotateAndRedeliver(session);
          }

          if (member.matrixUserId) {
            sendSpaceRevokeNotice(session.spaceId, member.matrixUserId);
          }

          toast('Access removed', 'success');
        } catch (err) {
          console.error(err);
          toast(err?.message || 'Could not remove access', 'error');
        }

        await renderMembers();
      });

      listHost.append(row);
    }
  };

  renderMembers();

  body.querySelector('[data-people-add]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const input = body.querySelector('[data-people-input]');
    const role = body.querySelector('[data-people-role]')?.value === 'write' ? 'write' : 'read';

    const matrixUserId = normalizeUserId(input?.value || '', {
      defaultServer: await ownMatrixServer(),
    });

    if (!matrixUserId) {
      toast('Enter a Matrix ID like @user:yanta.me', 'error');
      return;
    }

    btn.disabled = true;

    try {
      const res = await apiAddSpaceMember(session.spaceId, { matrixUserId, role });

      if (res.resolved) {
        await sendSpaceInvite(session.record, matrixUserId, role);
        toast(`Shared with ${matrixUserId}`, 'success');
        if (input) input.value = '';
      } else {
        // Not a YANTA user — offer the link fallback over federation.
        const ok = await yantaConfirm({
          title: 'Not a YANTA user',
          message: [
            `${matrixUserId} has no YANTA account, so access cannot be enforced per person.`,
            '',
            role === 'write'
              ? 'Send them the edit link via chat instead? Anyone with that link can edit.'
              : 'Send them the read link via chat instead? Anyone with that link can view.',
          ].join('\n'),
          confirmLabel: 'Send link',
          cancelLabel: 'Cancel',
          icon: 'link',
        });

        if (ok) {
          const links = spaceLinksFor(session);
          const url = role === 'write' && links.write ? links.write : links.read;
          await sendSpaceLinkMessage(
            matrixUserId,
            `I shared "${session.record.title || 'a note'}" with you on YANTA: ${url}`
          );
          toast(`Link sent to ${matrixUserId}`, 'success');
          if (input) input.value = '';
        }
      }
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Could not share', 'error');
    }

    btn.disabled = false;
    await renderMembers();
  });
}

// Keep the live tab fresh while it is visible (peer count, stop/start
// from elsewhere). Space events are rare, so a full re-render is fine.
if (typeof window !== 'undefined') {
  window.addEventListener('yanta-space-changed', () => {
    const liveTabActive = modal?.hidden === false &&
      modal.querySelector('[data-share-tab="live"]')?.classList.contains('active');

    if (liveTabActive) {
      renderLiveTab().catch(() => {});
    }
  });
}

let managerModal = null;

function ensureManagerModal() {
  registerShareOverlayRoutes();
  ensureCss();

  if (managerModal) return managerModal;

  managerModal = document.createElement('div');
  managerModal.className = 'modal yanta-public-shares-manager-modal';
  managerModal.hidden = true;

  managerModal.addEventListener('click', (e) => {
    if (e.target === managerModal) {
      closePublicSharesManager();
    }

    if (e.target.closest?.('[data-public-shares-manager-close]')) {
      closePublicSharesManager();
    }
  });

  document.body.append(managerModal);

  return managerModal;
}

export function closePublicSharesManager({
  fromHistory = false,
} = {}) {
  if (!managerModal) return;

  if (
    !fromHistory &&
    managerModal.hidden === false &&
    overlayIdFromState() === 'public-shares-manager'
  ) {
    closeTopOverlay(() => {
      closePublicSharesManager({
        fromHistory: true,
      });
    });

    return;
  }

  managerModal.hidden = true;
}

function cloudShareActive(raw = {}) {
  return isPublicShareActive({
    shareId: raw.shareId || raw.id,
    status: raw.status,
    expiresAt: raw.expiresAt || raw.expires_at,
    revokedAt: raw.revokedAt || raw.revoked_at,
  });
}

async function loadPublicShareRows() {
  const rows = new Map();

  for (const note of state.notes.values()) {
    const share = publicShareStateForNote(note.id);

    if (!isPublicShareActive(share)) continue;

    const shareId = share.shareId || share.id || '';

    rows.set(shareId || `note:${note.id}`, {
      noteId: note.id,
      note,
      shareId,
      share,
      local: true,
      cloud: false,
    });
  }

  try {
    const res = await listOwnPublicShares();

    for (const raw of res?.shares || []) {
      const sourceType = raw.sourceType || raw.source_type || 'note';
      if (sourceType !== 'note') continue;
      if (!cloudShareActive(raw)) continue;

      const shareId = String(raw.shareId || raw.id || '').trim();
      const noteId = String(raw.sourceId || raw.source_id || '').trim();

      if (!shareId || !noteId) continue;

      const key = shareId || `note:${noteId}`;
      const existing = rows.get(key);

      if (existing) {
        existing.cloud = true;
        existing.cloudStatus = raw.status || 'active';
        existing.lastPublishedAt =
          raw.lastPublishedAt ||
          raw.last_published_at ||
          existing.share?.lastPublishedAt ||
          null;
        continue;
      }

      rows.set(key, {
        noteId,
        note: state.notes.get(noteId) || null,
        shareId,
        share: {
          shareId,
          enabled: true,
          status: raw.status || 'active',
          expiresAt: raw.expiresAt || raw.expires_at || null,
          lastPublishedAt: raw.lastPublishedAt || raw.last_published_at || null,
          cloudOnly: true,
        },
        local: false,
        cloud: true,
      });
    }
  } catch (err) {
    console.info('[YANTA Public Share] could not load cloud share list', err?.message || err);
  }

  return [...rows.values()].sort((a, b) => {
    const at = a.note?.title || a.noteId || '';
    const bt = b.note?.title || b.noteId || '';

    return at.localeCompare(bt);
  });
}

function formatPublicShareTime(ts) {
  if (!ts) return '';

  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';

  return d.toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function publicShareRowStatus(row) {
  const parts = [];

  const status = row.share?.status || row.cloudStatus || 'active';

  if (status === 'up-to-date') {
    parts.push('up to date');
  } else if (status === 'pending') {
    parts.push('changes pending');
  } else if (status === 'publishing') {
    parts.push('publishing');
  } else if (status === 'failed') {
    parts.push('publish failed');
  } else {
    parts.push('active');
  }

  if (row.share?.cloudOnly) {
    parts.push('cloud-only on this device');
  }

  const published = row.lastPublishedAt || row.share?.lastPublishedAt;
  if (published) {
    parts.push(`published ${formatPublicShareTime(published)}`);
  }

  return parts.join(' · ');
}

async function renderPublicSharesManager() {
  const m = ensureManagerModal();

  m.innerHTML = `
    <div class="modal-card yanta-public-shares-manager-card">
      <header class="modal-head">
        <h3>Shared public notes</h3>
        <button class="icon-btn" data-public-shares-manager-close>&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-public-share-info">
          Notes listed here have an active public read-only link.
          You can stop sharing individual notes or revoke all public links.
        </div>

        <div class="compress-actions" style="margin:12px 0;flex-wrap:wrap">
          <button class="btn" data-refresh-public-shares-manager>
            ${lucide('refresh-cw', 14)}
            Refresh
          </button>

          <span class="grow"></span>

          <button class="btn danger" data-stop-all-public-shares>
            ${lucide('trash', 14)}
            Stop sharing for all notes
          </button>
        </div>

        <div data-public-shares-manager-body>
          <div class="tree-empty">Loading shared notes…</div>
        </div>
      </div>
    </div>
  `;

  const body = m.querySelector('[data-public-shares-manager-body]');
  const rows = await loadPublicShareRows();

  if (!rows.length) {
    body.innerHTML = `
      <div class="yanta-public-shares-empty">
        No active public shares.
      </div>
    `;
  } else {
    body.innerHTML = `
      <div class="yanta-public-shares-list">
        ${rows.map((row) => {
          const title =
            row.note?.title ||
            `Missing local note (${row.noteId})`;

          const status = publicShareRowStatus(row);
          const shareId = row.shareId || row.share?.shareId || '';

          return `
            <div class="yanta-public-share-row" data-share-id="${escapeHtml(shareId)}" data-note-id="${escapeHtml(row.noteId)}">
              <div class="yanta-public-share-row-main">
                <strong>${escapeHtml(title)}</strong>
                <small>${escapeHtml(status)}</small>
                <small>${escapeHtml(shareId)}</small>
              </div>

              <div class="yanta-public-share-row-actions">
                <button class="btn danger" data-stop-public-share-row>
                  ${lucide('trash', 14)}
                  Stop sharing
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  m.querySelector('[data-refresh-public-shares-manager]')?.addEventListener('click', async () => {
    await renderPublicSharesManager();
  });

  m.querySelector('[data-stop-all-public-shares]')?.addEventListener('click', async () => {
    const ok = await yantaConfirm({
      title: 'Stop sharing all notes?',
      message: [
        'Stop public sharing for all notes?',
        '',
        'All active public links will be revoked.',
        'Future access through these links will be blocked.',
        '',
        'Copies already downloaded cannot be removed.',
      ].join('\n'),
      confirmLabel: 'Stop sharing all',
      cancelLabel: 'Cancel',
      danger: true,
      icon: 'trash',
    });

    if (!ok) return;

    try {
      await stopAllPublicShares();
      await renderPublicSharesManager();
    } catch (err) {
      console.error(err);
      toast(err?.message || 'Could not stop all public sharing', 'error');
    }
  });

  m.querySelectorAll('[data-stop-public-share-row]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.yanta-public-share-row');
      const shareId = row?.dataset?.shareId || '';
      const noteId = row?.dataset?.noteId || '';

      if (!shareId) return;

      const note = state.notes.get(noteId);

      const ok = await yantaConfirm({
        title: 'Stop public sharing?',
        message: [
          `Stop public sharing for "${note?.title || noteId || 'this note'}"?`,
          '',
          'Future access through this public link will be blocked.',
          'Copies already downloaded cannot be removed.',
        ].join('\n'),
        confirmLabel: 'Stop sharing',
        cancelLabel: 'Cancel',
        danger: true,
        icon: 'trash',
      });

      if (!ok) return;

      try {
        await stopPublicShareById(shareId, {
          noteId,
        });

        await renderPublicSharesManager();
      } catch (err) {
        console.error(err);
        toast(err?.message || 'Could not stop sharing', 'error');
      }
    });
  });
}

export async function openPublicSharesManager({
  fromHistory = false,
} = {}) {
  const m = ensureManagerModal();

  const wasClosed = m.hidden !== false;

  m.hidden = false;

  if (!fromHistory && wasClosed) {
    pushOverlayState('public-shares-manager');
  }

  await refreshOwnPublicShareStatusFromCloud().catch(() => {});
  await renderPublicSharesManager();
}

/**
 * Share dialog for a note or a folder.
 *
 * Notes get all three tabs; folders are shared as live workspaces and
 * have no public read-only snapshot, so their dialog opens on Live.
 */
export async function openUnifiedShareModal({
  fromHistory = false,
  folderId = '',
  noteId: explicitNoteId = '',
} = {}) {
  registerShareOverlayRoutes();

  if (folderId) {
    if (!state.folders.has(folderId)) {
      toast('Folder not found', 'error');
      return;
    }

    shareTarget = { kind: 'folder', id: folderId };
  } else {
    const noteId = explicitNoteId || state.currentNoteId;

    if (!noteId || !state.notes.has(noteId)) {
      toast('Open a note first', 'error');
      return;
    }

    shareTarget = { kind: 'note', id: noteId };
  }

  const isFolder = targetIsFolder();
  const targetId = shareTarget.id;
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-public-share-card">
      <header class="modal-head">
        <h3>Share ${isFolder ? 'folder' : 'note'}: ${escapeHtml(targetTitle())}</h3>
        <button class="icon-btn" data-public-share-close>&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-share-tabs">
          ${isFolder ? '' : '<button data-share-tab="public" class="active">Public link</button>'}
          <button data-share-tab="live" ${isFolder ? 'class="active"' : ''}>Live collaboration</button>
          <button data-share-tab="people">People</button>
        </div>

        <div data-share-body></div>
      </div>
    </div>
  `;

  const activate = (tab) => {
    m.querySelectorAll('[data-share-tab]').forEach((b) => b.classList.remove('active'));
    m.querySelector(`[data-share-tab="${tab}"]`)?.classList.add('active');
  };

  m.querySelector('[data-share-tab="public"]')?.addEventListener('click', async () => {
    activate('public');
    await refreshOwnPublicShareStatusFromCloud().catch(() => {});
    await renderPublicTab(targetId);
  });

  m.querySelector('[data-share-tab="live"]')?.addEventListener('click', () => {
    activate('live');
    renderLiveTab();
  });

  m.querySelector('[data-share-tab="people"]')?.addEventListener('click', () => {
    activate('people');
    renderPeopleTab();
  });

  const wasClosed = m.hidden !== false;

  m.hidden = false;

  if (!fromHistory && wasClosed) {
    pushOverlayState('share-note', {
      noteId: isFolder ? '' : targetId,
      folderId: isFolder ? targetId : '',
    });
  }

  if (isFolder) {
    await renderLiveTab();
    return;
  }

  await renderPublicTab(targetId);

  /*
    Fast first paint, then reconcile with cloud.
    This catches cloud-only shares and repairs stale local status without making
    the dialog feel slow.
  */
  refreshOwnPublicShareStatusFromCloud()
    .then(() => {
      if (modal?.hidden === false && shareTarget.id === targetId) {
        return renderPublicTab(targetId);
      }
    })
    .catch(() => {});
}
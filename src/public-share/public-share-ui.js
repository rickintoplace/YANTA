import { renderBrandedQrSvg } from '../qr.js';

import { isChatEnabled } from '../chat/chat-enabled.js';
import { BRAND_LOGO_SVG } from '../brand-logo.js';

import {
  state,
  store,
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
  createSpaceForCalendarCategory,
  stopSpaceShare,
  spaceSessionForNote,
  spaceSessionForFolder,
  spaceSessionForCalendarCategory,
  spaceLinksFor,
  leaveSpace,
  apiGetSpace,
  apiListSpaceMembers,
  apiAddSpaceMember,
  apiRemoveSpaceMember,
  rotateSpaceWriteAccess,
  sharingConflictForNote,
  sharingConflictForFolder,
  sharingConflictForCalendarCategory,
} from '../spaces/space-session.js';

import {
  calendarBridgeForSpace,
  spaceEventProviderForSpace,
} from '../spaces/calendar-registry.js';

import { formatDateTime } from '../i18n/format.js';
import { t } from '../i18n/index.js';

import {
  publishSpaceRoster,
} from '../spaces/space-people.js';

import {
  loadShareGroups,
  createShareGroup,
  deleteShareGroup,
  setShareGroupMembers,
} from '../spaces/share-groups.js';

import {
  sendSpaceInvite,
  sendSpaceRevokeNotice,
  sendSpaceLinkMessage,
} from '../spaces/space-matrix.js';

// Loaded on use: chat is optional and heavy (see chat/chat-enabled.js).
const chatActions = () => import('../chat/chat-actions.js');

async function resolveMatrixClient() {
  return (await chatActions()).resolveMatrixClient();
}

import {
  createOrGetPublicShare,
  publishPublicShareNow,
  publicShareStateForNote,
  stopPublicShare,
  stopPublicShareById,
  stopAllPublicShares,
  isPublicShareActive,
  refreshOwnPublicShareStatusFromCloud,
  listLocalPublicSharedNotes,
  schedulePublicSharePublish,
  PUBLIC_SHARE_BRANDING_SETTING,
} from './public-share-publisher.js';

import {
  currentBillingSummary,
  openYantaPlusUpgrade,
} from '../billing/billing-ui.js';

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

// What the dialog is currently sharing: a single note, a folder
// subtree as a live workspace, or a calendar category as a live
// calendar. The Live and People tabs work for all three; public
// read-only snapshot links exist for notes only.
let shareTarget = { kind: 'note', id: '' };

function targetIsFolder() {
  return shareTarget.kind === 'folder';
}

function targetIsCalendar() {
  return shareTarget.kind === 'calendar';
}

function targetThing() {
  return targetIsCalendar() ? 'calendar' : targetIsFolder() ? 'folder' : 'note';
}

function targetTitle() {
  if (targetIsCalendar()) {
    return state.calendarCategories.get(shareTarget.id)?.name || t('publicShare.untitledCalendar');
  }

  return targetIsFolder()
    ? state.folders.get(shareTarget.id)?.name || t('publicShare.untitledFolder')
    : state.notes.get(shareTarget.id)?.title || t('note.untitled');
}

function targetSession() {
  if (targetIsCalendar()) return spaceSessionForCalendarCategory(shareTarget.id);

  return targetIsFolder()
    ? spaceSessionForFolder(shareTarget.id)
    : spaceSessionForNote(shareTarget.id);
}

async function createTargetSpace() {
  if (targetIsCalendar()) return createSpaceForCalendarCategory(shareTarget.id);

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
      const calendarCategoryId =
        data?.calendarCategoryId || historyState?.calendarCategoryId || '';

      if (folderId) {
        return openUnifiedShareModal({
          fromHistory: true,
          folderId,
        });
      }

      if (calendarCategoryId) {
        return openUnifiedShareModal({
          fromHistory: true,
          calendarCategoryId,
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

.yanta-share-e2ee-note {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}

.yanta-calendar-share-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 12.5px;
}

.yanta-calendar-share-stats-warn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--warn, #f59e0b);
  font-weight: 600;
}

.yanta-calendar-share-extras {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yanta-calendar-share-note-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.yanta-calendar-share-note-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}

.yanta-calendar-share-note-row:hover {
  background: var(--bg-elev-2);
}

.yanta-calendar-share-note-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanta-calendar-share-note-row small {
  color: var(--text-faint);
  flex: 0 0 auto;
}

.yanta-share-groups-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.yanta-share-group-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--bg-elev-3);
  font-size: 10.5px;
  font-weight: 700;
}

.yanta-share-groups-card {
  width: min(520px, 94vw);
}

.yanta-share-group-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.yanta-share-group-editor textarea {
  resize: vertical;
  font-size: 12.5px;
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

.yanta-public-share-branding {
  display: flex;
  align-items: center;
  gap: 9px;

  padding: 9px 11px;

  border: 1px solid var(--border);
  border-radius: 10px;

  background: var(--bg-elev);

  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1.4;
}

.yanta-public-share-branding input[type="checkbox"] {
  flex: 0 0 auto;
  accent-color: var(--accent);
}

.yanta-public-share-branding .grow {
  flex: 1;
}

.yanta-public-share-branding-plus {
  flex: 0 0 auto;

  display: inline-flex;
  align-items: center;
  gap: 4px;

  min-height: 22px;
  padding: 1px 8px;

  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, transparent);

  font-size: 11px;
  font-weight: 750;

  cursor: pointer;
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
    active: t('publicShare.status.active'),
    pending: t('publicShare.status.pending'),
    publishing: t('publicShare.status.publishing'),
    'up-to-date': t('publicShare.status.upToDate'),
    failed: t('publicShare.status.failed'),
    revoked: t('publicShare.status.revoked'),
  };

  return map[status] || t('publicShare.status.none');
}

function statusClass(status) {
  if (status === 'up-to-date') return 'good';
  if (status === 'failed') return 'error';
  if (status === 'pending' || status === 'publishing') return 'warn';
  return '';
}

async function renderPublicTab(noteId) {
  const body0 = modal.querySelector('[data-share-body]');

  // Notes mounted from someone else's space are not in this user's own
  // cloud vault — publishing would leak a degraded copy without assets.
  if (state.notes.get(noteId)?.spaceId) {
    if (body0) {
      body0.innerHTML = `
        <div class="yanta-public-share-box">
          <div class="yanta-public-share-info">
            <strong>${escapeHtml(t('sharing.sharedWithYou'))}</strong><br>
            ${escapeHtml(t('publicShare.public.recipientText'))}
          </div>
        </div>
      `;
    }

    return;
  }

  const share = publicShareStateForNote(noteId);
  const hasShare = isPublicShareActive(share);
  const hasPrivateKey = !!share?.shareKey;

  /*
    "Made with YANTA" badge preference. Hiding is a Plus perk; free plans see
    the toggle locked to "shown". Offline/signed-out defaults to free, which
    only locks the toggle — publishing itself enforces the plan again.
  */
  let brandingIsPlus = false;

  try {
    brandingIsPlus = (await currentBillingSummary()).plan === 'premium';
  } catch {}

  const brandingShown =
    !brandingIsPlus ||
    (await store.settings.get(PUBLIC_SHARE_BRANDING_SETTING, true)) !== false;

  const url = hasShare && hasPrivateKey
    ? share.url || makePublicShareUrl(share.shareId, share.shareKey)
    : '';

  const body = modal.querySelector('[data-share-body]');
  if (!body) return;

  body.innerHTML = `
    <div class="yanta-public-share-box">
      <div class="yanta-public-share-info">
        <strong>${escapeHtml(t('publicShare.tab.public'))}</strong><br>
        ${t('publicShare.public.info', { code: '<code>#k=</code>' })}
      </div>

      ${
        hasShare
          ? `
            <div class="yanta-public-share-status ${statusClass(share.status)}">
              ${escapeHtml(
                hasPrivateKey
                  ? statusText(share.status)
                  : t('publicShare.status.noKey')
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
                    <button class="btn primary" data-copy-public-share>${lucide('copy', 14)} ${escapeHtml(t('common.copy'))}</button>
                  </div>

                  <div class="yanta-public-share-qr" data-public-share-qr></div>

                  ${
                    Array.isArray(share.missingAssets) && share.missingAssets.length
                      ? `
                        <div class="yanta-public-share-status warn">
                          ${escapeHtml(t('publicShare.public.missingAssets', { count: share.missingAssets.length }))}
                        </div>
                      `
                      : ''
                  }

                  <div class="compress-actions">
                    <button class="btn" data-publish-public-share>
                      ${lucide('refresh-cw', 14)}
                      ${escapeHtml(share.status === 'failed' ? t('publicShare.public.retry') : t('publicShare.public.publishPending'))}
                    </button>
                    <span class="grow"></span>
                    <button class="btn" data-open-public-shares-manager>
                      ${lucide('list', 14)}
                      ${escapeHtml(t('publicShare.public.manage'))}
                    </button>
                    <button class="btn danger" data-stop-public-share>
                      ${lucide('globe-off', 14)}
                      ${escapeHtml(t('publicShare.public.stop'))}
                    </button>
                  </div>
                `
                : `
                  <div class="yanta-public-share-info">
                    ${escapeHtml(t('publicShare.public.otherDevice'))}
                  </div>

                  <div class="compress-actions">
                    <button class="btn" data-open-public-shares-manager>
                      ${lucide('list', 14)}
                      ${escapeHtml(t('publicShare.public.manage'))}
                    </button>
                    <span class="grow"></span>
                    <button class="btn danger" data-stop-public-share>
                      ${lucide('globe-off', 14)}
                      ${escapeHtml(t('publicShare.public.stop'))}
                    </button>
                  </div>
                `
            }

            <div class="yanta-public-share-danger">
              <small style="color:var(--text-faint)">
                ${escapeHtml(t('publicShare.public.stopHint'))}
              </small>
            </div>
          `
          : `
            <label>
              ${escapeHtml(t('publicShare.public.expires'))}
              <select class="text-input" data-public-share-expiry>
                <option value="2592000000">${escapeHtml(t('publicShare.public.expiry30d'))}</option>
                <option value="86400000">${escapeHtml(t('publicShare.public.expiry1d'))}</option>
                <option value="0">${escapeHtml(t('publicShare.public.expiryNever'))}</option>
              </select>
            </label>

            <div class="compress-actions sharing-options">
              <button class="btn primary" data-create-public-share>
                ${lucide('link', 14)}
                ${escapeHtml(t('publicShare.public.create'))}
              </button>
              <button class="btn" data-open-public-shares-manager>
                ${lucide('list', 14)}
                ${escapeHtml(t('publicShare.public.manage'))}
              </button>
              <button class="btn" data-open-cloud-setup>
                ${lucide('cloud', 14)}
                ${escapeHtml(t('publicShare.public.setupCloud'))}
              </button>
            </div>
          `
      }

      <label class="yanta-public-share-branding">
        <input
          type="checkbox"
          data-public-share-branding
          ${brandingShown ? 'checked' : ''}
          ${brandingIsPlus ? '' : 'disabled'}
        >
        <span>${escapeHtml(t('publicShare.public.branding'))}</span>
        <span class="grow"></span>
        ${
          brandingIsPlus
            ? ''
            : `
              <button
                type="button"
                class="yanta-public-share-branding-plus"
                data-branding-upgrade
                title="${escapeHtml(t('publicShare.public.brandingPlus'))}"
              >
                ${lucide('sparkles', 11)} Plus
              </button>
            `
        }
      </label>
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
      toast(t('publicShare.public.noKey'), 'error');
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
      btn.innerHTML = `${lucide('check', 14)} ${escapeHtml(t('publicShare.copied'))}`;

      window.setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('success');
        btn.innerHTML = originalHtml;
        btn.style.minWidth = previousMinWidth;
      }, 1300);
    } catch {
      toast(t('publicShare.copyFailed'), 'error');
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
      toast(t('publicShare.public.created'), 'success');
    } catch (err) {
      console.error(err);
      toast(err?.message || t('publicShare.public.createFailed'), 'error');
      await renderPublicTab(noteId);
    }
  });

  body.querySelector('[data-publish-public-share]')?.addEventListener('click', async () => {
    try {
      await publishPublicShareNow(noteId, {
        force: true,
      });

      await renderPublicTab(noteId);
      toast(t('publicShare.public.published'), 'success');
    } catch (err) {
      console.error(err);
      toast(err?.message || t('publicShare.public.publishFailed'), 'error');
      await renderPublicTab(noteId);
    }
  });

  body.querySelector('[data-stop-public-share]')?.addEventListener('click', async () => {
    const ok = await yantaConfirm({
      title: t('publicShare.public.stopTitle'),
      message: t('publicShare.public.stopMessage'),
      confirmLabel: t('publicShare.public.stop'),
      cancelLabel: t('common.cancel'),
      danger: true,
      icon: 'globe-off',
    });

    if (!ok) return;

    try {
      await stopPublicShare(noteId);
      await renderPublicTab(noteId);
    } catch (err) {
      console.error(err);
      toast(err?.message || t('publicShare.public.stopFailed'), 'error');
    }
  });

  body.querySelector('[data-public-share-branding]')?.addEventListener('change', async (e) => {
    const show = !!e.currentTarget.checked;

    try {
      await store.settings.set(PUBLIC_SHARE_BRANDING_SETTING, show);
    } catch (err) {
      console.error(err);
      toast(t('publicShare.public.badgeSaveFailed'), 'error');
      return;
    }

    /*
      The badge travels inside each published payload, so already-published
      pages only pick up the change through a republish.
    */
    let republished = 0;

    for (const row of listLocalPublicSharedNotes()) {
      if (!row.share?.shareKey) continue;

      schedulePublicSharePublish(row.noteId, {
        delay: 600,
      });

      republished++;
    }

    toast(
      republished
        ? t(show ? 'publicShare.public.badgeShownUpdating' : 'publicShare.public.badgeHiddenUpdating', { count: republished })
        : t(show ? 'publicShare.public.badgeShown' : 'publicShare.public.badgeHidden'),
      'success'
    );
  });

  body.querySelector('[data-branding-upgrade]')?.addEventListener('click', async (e) => {
    e.preventDefault();

    try {
      await openYantaPlusUpgrade();
    } catch (err) {
      console.error(err);
      toast(err?.message || t('publicShare.public.upgradeFailed'), 'error');
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
      btn.innerHTML = `${lucide('check', 14)} ${escapeHtml(t('publicShare.copied'))}`;

      window.setTimeout(() => {
        btn.classList.remove('success');
        btn.innerHTML = originalHtml;
      }, 1300);
    } catch {
      toast(t('publicShare.copyFailed'), 'error');
    }
  });
}

async function renderLiveTab() {
  const body = modal.querySelector('[data-share-body]');
  if (!body) return;

  const isFolder = targetIsFolder();
  const isCalendar = targetIsCalendar();
  const thing = targetThing();
  const session = targetSession();
  const legacy = shareTarget.kind === 'note' ? state.liveShares.get(shareTarget.id) : null;

  // Recipient view: mounted from someone else's space.
  if (session && session.role !== 'owner') {
    const roleLabel = session.role === 'write'
      ? t(`publicShare.live.recipient.write.${thing}`)
      : t(`publicShare.live.recipient.read.${thing}`);

    body.innerHTML = `
      <div class="yanta-public-share-box">
        <div class="yanta-public-share-info">
          <strong>${escapeHtml(t('sharing.sharedWithYou'))}</strong><br>
          ${escapeHtml(roleLabel)} ${escapeHtml(t('publicShare.live.recipientSync'))}
        </div>

        <div class="compress-actions">
          <span class="grow"></span>
          <button class="btn danger" data-leave-space>${lucide('log-out', 14)} ${escapeHtml(t('publicShare.live.leave'))}</button>
        </div>
      </div>
    `;

    body.querySelector('[data-leave-space]')?.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: t('publicShare.live.leaveTitle'),
        message: t(`publicShare.live.leaveMessage.${thing}`),
        confirmLabel: t('publicShare.live.leave'),
        cancelLabel: t('common.cancel'),
        danger: true,
        icon: 'log-out',
      });

      if (!ok) return;

      await leaveSpace(session.spaceId);
      closeUnifiedShareModal();
      toast(t('publicShare.live.left'));
    });

    return;
  }

  // No session for this exact item — but it may already be covered by
  // another share (inside a shared workspace, or shared with this user).
  // Show why instead of offering a "Start live share" that would fail.
  const conflict = !session
    ? (isCalendar
        ? sharingConflictForCalendarCategory(shareTarget.id)
        : isFolder
          ? sharingConflictForFolder(shareTarget.id)
          : sharingConflictForNote(shareTarget.id))
    : '';

  if (conflict) {
    body.innerHTML = `
      <div class="yanta-public-share-box">
        <div class="yanta-public-share-info">
          <strong>${escapeHtml(t('publicShare.live.covered'))}</strong><br>
          ${escapeHtml(conflict)}
        </div>
      </div>
    `;

    return;
  }

  // Owner view without an active space yet.
  if (!session) {
    body.innerHTML = `
      <div class="yanta-public-share-box">
        <div class="yanta-public-share-info">
          <strong>${escapeHtml(t('publicShare.live.title'))}</strong><br>
          ${escapeHtml(
            isCalendar
              ? t('publicShare.live.introCalendar')
              : isFolder
                ? t('publicShare.live.introFolder')
                : t('publicShare.live.introNote')
          )}
          ${escapeHtml(t('publicShare.live.introE2ee'))}
        </div>

        <div class="compress-actions sharing-options">
          <button class="btn primary" data-start-space-share>
            ${lucide('users', 14)}
            ${escapeHtml(t('publicShare.live.start'))}
          </button>
          <button class="btn" data-open-cloud-setup>
            ${lucide('cloud', 14)}
            ${escapeHtml(t('publicShare.public.setupCloud'))}
          </button>
        </div>

        ${
          legacy
            ? `
              <div class="yanta-public-share-status warn">
                ${escapeHtml(t('publicShare.live.legacyActive'))}
              </div>
              <div class="compress-actions">
                <span class="grow"></span>
                <button class="btn danger" data-stop-legacy-share>${lucide('x', 14)} ${escapeHtml(t('publicShare.live.stopLegacy'))}</button>
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
        toast(t('publicShare.live.started'), 'success');
      } catch (err) {
        console.error(err);
        btn.disabled = false;

        if (err?.status === 401) {
          toast(t('publicShare.live.signIn'), 'error');
        } else {
          toast(err?.message || t('publicShare.live.startFailed'), 'error');
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
      ${escapeHtml(
        isFolder
          ? t('publicShare.live.activeFolder')
          : isCalendar
            ? t('publicShare.live.activeCalendar')
            : t('publicShare.live.activePeers', { count: peers })
      )}
    </div>

    <div class="yanta-public-share-info yanta-share-e2ee-note">
      ${lucide('shield-check', 14)}
      ${escapeHtml(t(`publicShare.live.e2ee.${thing}`))}
    </div>

    <div class="yanta-share-link-section">
      <div class="yanta-public-share-info yanta-share-link-info">
        <div class="yanta-share-link-title">
          ${lucide('eye', 15)}
          <strong>${escapeHtml(t('publicShare.live.readLink'))}</strong>
        </div>
        <span>${escapeHtml(t('publicShare.live.readLinkHint'))}</span>
      </div>

      <div class="yanta-public-share-link-row">
        <input class="text-input" data-space-read-link readonly value="${escapeHtml(links.read)}">

        <button
          class="btn yanta-qr-toggle is-active"
          data-space-qr-read
          type="button"
          aria-pressed="true"
          title="${escapeHtml(t('publicShare.live.showReadQr'))}"
        >
          ${lucide('qr-code', 14)}
          <span>QR</span>
        </button>

        <button
          class="btn primary yanta-copy-compact"
          data-copy-space-read
          type="button"
          aria-label="${escapeHtml(t('publicShare.live.copyReadLink'))}"
          title="${escapeHtml(t('publicShare.live.copyReadLink'))}"
        >
          ${lucide('copy', 14)} ${escapeHtml(t('publicShare.live.copyReadLink'))}
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
                <strong>${escapeHtml(t('publicShare.live.editLink'))}</strong>
              </div>
              <span>${escapeHtml(t('publicShare.live.editLinkHint'))}</span>
            </div>

            <div class="yanta-public-share-link-row">
              <input class="text-input" data-space-write-link readonly value="${escapeHtml(links.write)}">

              <button
                class="btn yanta-qr-toggle"
                data-space-qr-write
                type="button"
                aria-pressed="false"
                title="${escapeHtml(t('publicShare.live.showEditQr'))}"
              >
                ${lucide('qr-code', 14)}
                <span>QR</span>
              </button>

              <button
                class="btn primary yanta-copy-compact"
                data-copy-space-write
                type="button"
                aria-label="${escapeHtml(t('publicShare.live.copyEditLink'))}"
                title="${escapeHtml(t('publicShare.live.copyEditLink'))}"
              >
                ${lucide('copy', 14)} ${escapeHtml(t('publicShare.live.copyEditLink'))}
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

    ${isCalendar ? '<div data-calendar-share-extras></div>' : ''}
    ${isFolder ? '<div data-folder-share-extras></div>' : ''}

    <div class="compress-actions">
      <span class="grow"></span>
      <button class="btn danger" data-stop-space-share>
        ${lucide('x', 14)}
        ${escapeHtml(t('publicShare.live.stopLive'))}
      </button>
    </div>

    <div class="yanta-public-share-danger">
      <small style="color:var(--text-faint)">
        ${escapeHtml(t('publicShare.live.stopLiveHint'))}
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
          <strong>${escapeHtml(t('publicShare.live.editQr'))}</strong>
        </div>
        <small>${escapeHtml(t('publicShare.live.editQrHint'))}</small>
      `
      : `
        <div class="yanta-share-qr-title">
          ${lucide('eye', 16)}
          <strong>${escapeHtml(t('publicShare.live.readQr'))}</strong>
        </div>
        <small>${escapeHtml(t('publicShare.live.readQrHint'))}</small>
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

if (isCalendar) {
  renderCalendarShareExtras(body, session).catch(() => {});
}

if (isFolder) {
  renderFolderShareExtras(body, session);
}

body.querySelector('[data-stop-space-share]')?.addEventListener('click', async () => {
  const ok = await yantaConfirm({
    title: t('publicShare.live.stopLiveTitle'),
    message: t(`publicShare.live.stopLiveMessage.${thing}`),
    confirmLabel: t('publicShare.public.stop'),
    cancelLabel: t('common.cancel'),
    danger: true,
    icon: 'x',
  });

  if (!ok) return;

  try {
    await stopSpaceShare(session.spaceId);
    await renderLiveTab();
  } catch (err) {
    console.error(err);
    toast(err?.message || t('publicShare.public.stopFailed'), 'error');
  }
});
}

// ---------------- Calendar share extras ----------------------------
//
// Owner-only panel under the links: approximate link stats (opens,
// throttling) and the linked-notes list with per-note opt-out — the
// single most important control against accidental oversharing.

async function renderCalendarShareExtras(body, session) {
  const host = body.querySelector('[data-calendar-share-extras]');
  if (!host) return;

  const bridge = calendarBridgeForSpace(session.spaceId);

  const excluded = new Set(session.record.excludedNoteIds || []);
  const referenced = bridge ? [...bridge.referencedNoteIds()] : [];

  const noteRows = referenced
    .map((noteId) => {
      const note = state.notes.get(noteId);
      const title = note?.title || t('publicShare.untitledNote');
      const checked = !excluded.has(noteId);

      return `
        <label class="yanta-calendar-share-note-row">
          <input type="checkbox" data-share-note-id="${escapeHtml(noteId)}" ${checked ? 'checked' : ''} />
          <span class="yanta-calendar-share-note-title">
            ${lucide(note?.icon || 'file-text', 13)}
            ${escapeHtml(title)}
          </span>
          <small>${escapeHtml(checked ? t('publicShare.live.noteShared') : t('publicShare.live.noteKeptPrivate'))}</small>
        </label>
      `;
    })
    .join('');

  let statsHtml = '';

  try {
    const meta = await apiGetSpace(session.spaceId, session.record);
    const stats = meta?.linkStats;

    if (stats) {
      const day = 24 * 60 * 60 * 1000;
      const throttled = stats.throttledAt && Date.now() - stats.throttledAt < day;
      const quotaHit = stats.quotaHitAt && Date.now() - stats.quotaHitAt < day;

      statsHtml = `
        <div class="yanta-calendar-share-stats">
          ${lucide('eye', 13)}
          ${escapeHtml(t('publicShare.live.linkOpens', { count: Number(stats.linkOpens || 0) }))}
          ${
            throttled
              ? `<span class="yanta-calendar-share-stats-warn">${lucide('flame', 12)} ${escapeHtml(t('publicShare.live.hot'))}</span>`
              : ''
          }
          ${
            quotaHit
              ? `<span class="yanta-calendar-share-stats-warn">${lucide('triangle-alert', 12)} ${escapeHtml(t('publicShare.live.quotaHit'))}</span>`
              : ''
          }
        </div>
      `;
    }
  } catch {}

  host.innerHTML = `
    <div class="yanta-calendar-share-extras">
      ${statsHtml}

      <div class="yanta-share-link-section">
        <div class="yanta-public-share-info yanta-share-link-info">
          <div class="yanta-share-link-title">
            ${lucide('file-text', 15)}
            <strong>${escapeHtml(t('publicShare.live.linkedNotes'))}</strong>
          </div>
          <span>
            ${escapeHtml(
              referenced.length
                ? t('publicShare.live.linkedNotesHint')
                : t('publicShare.live.linkedNotesEmpty')
            )}
          </span>
        </div>

        ${noteRows ? `<div class="yanta-calendar-share-note-list">${noteRows}</div>` : ''}
      </div>
    </div>
  `;

  host.querySelectorAll('[data-share-note-id]').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const noteId = checkbox.dataset.shareNoteId;
      const nextExcluded = new Set(session.record.excludedNoteIds || []);

      if (checkbox.checked) {
        nextExcluded.delete(noteId);
      } else {
        nextExcluded.add(noteId);
      }

      try {
        await bridge?.setExcludedNoteIds([...nextExcluded]);
        toast(checkbox.checked ? t('publicShare.live.noteSharedToast') : t('publicShare.live.notePrivateToast'), 'success');
      } catch (err) {
        console.error(err);
        toast(t('publicShare.live.noteToggleFailed'), 'error');
      }

      renderCalendarShareExtras(body, session).catch(() => {});
    });
  });
}

// ---------------- Folder share extras ------------------------------
//
// The mirror of the calendar panel: a folder carries the calendar
// events linked to the notes inside it, and the owner decides which of
// them travel. Same rule as everywhere — nothing leaves silently.

function renderFolderShareExtras(body, session) {
  const host = body.querySelector('[data-folder-share-extras]');
  if (!host) return;

  const provider = spaceEventProviderForSpace(session.spaceId);
  if (!provider) return;

  const excluded = provider.excludedEventIds();

  const events = provider.linkableEvents()
    .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));

  const eventRows = events
    .map((ev) => {
      const checked = !excluded.has(ev.id);
      const when = ev.start ? formatDateTime(ev.start) : '';

      return `
        <label class="yanta-calendar-share-note-row">
          <input type="checkbox" data-share-event-id="${escapeHtml(ev.id)}" ${checked ? 'checked' : ''} />
          <span class="yanta-calendar-share-note-title">
            ${lucide('calendar', 13)}
            ${escapeHtml(ev.title || t('publicShare.untitledEvent'))}
          </span>
          <small>${escapeHtml(when)}${checked ? '' : ` · ${escapeHtml(t('publicShare.live.eventKeptPrivate'))}`}</small>
        </label>
      `;
    })
    .join('');

  host.innerHTML = `
    <div class="yanta-calendar-share-extras">
      <div class="yanta-share-link-section">
        <div class="yanta-public-share-info yanta-share-link-info">
          <div class="yanta-share-link-title">
            ${lucide('calendar', 15)}
            <strong>${escapeHtml(t('publicShare.live.linkedEvents'))}</strong>
          </div>
          <span>
            ${escapeHtml(
              events.length
                ? t('publicShare.live.linkedEventsHint')
                : t('publicShare.live.linkedEventsEmpty')
            )}
          </span>
        </div>

        ${eventRows ? `<div class="yanta-calendar-share-note-list">${eventRows}</div>` : ''}
      </div>
    </div>
  `;

  host.querySelectorAll('[data-share-event-id]').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const eventId = checkbox.dataset.shareEventId;
      const nextExcluded = new Set(provider.excludedEventIds());

      if (checkbox.checked) {
        nextExcluded.delete(eventId);
      } else {
        nextExcluded.add(eventId);
      }

      try {
        await provider.setExcludedEventIds([...nextExcluded]);
        toast(checkbox.checked ? t('publicShare.live.eventSharedToast') : t('publicShare.live.eventPrivateToast'), 'success');
      } catch (err) {
        console.error(err);
        toast(t('publicShare.live.eventToggleFailed'), 'error');
      }

      renderFolderShareExtras(body, session);
    });
  });
}

// ---------------- Share groups (Family, Team, …) -------------------
//
// Personal shortcuts that expand to per-member grants. Deliberately
// minimal: chips + one manage dialog. The server never learns about
// groups; access stays per person, so revocation keeps working.

async function renderShareGroupsRow(body, session, renderMembers) {
  const host = body.querySelector('[data-people-groups]');
  if (!host) return;

  const groups = await loadShareGroups();

  host.innerHTML = `
    <div class="yanta-share-groups-row">
      ${groups
        .filter((group) => group.members.length)
        .map((group) => `
          <button class="btn compact" data-share-group="${escapeHtml(group.id)}" title="${escapeHtml(group.members.join(', '))}">
            ${lucide('users', 13)}
            ${escapeHtml(group.name)}
            <span class="yanta-share-group-count">${group.members.length}</span>
          </button>
        `)
        .join('')}
      <button class="btn compact" data-share-groups-manage>
        ${lucide('settings-2', 13)} ${escapeHtml(t('publicShare.groups.manage'))}
      </button>
    </div>
  `;

  host.querySelectorAll('[data-share-group]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const group = groups.find((g) => g.id === btn.dataset.shareGroup);
      if (!group?.members.length) return;

      const role = body.querySelector('[data-people-role]')?.value === 'write' ? 'write' : 'read';

      const ok = await yantaConfirm({
        title: t('publicShare.groups.confirmTitle', { name: group.name }),
        message: [
          t(role === 'write' ? 'publicShare.groups.confirmWrite' : 'publicShare.groups.confirmRead', { count: group.members.length }),
          '',
          group.members.join('\n'),
        ].join('\n'),
        confirmLabel: t('publicShare.groups.shareWithGroup'),
        cancelLabel: t('common.cancel'),
        icon: 'users',
      });

      if (!ok) return;

      btn.disabled = true;

      const failed = [];

      for (const matrixUserId of group.members) {
        try {
          const res = await apiAddSpaceMember(session.spaceId, { matrixUserId, role });

          if (res.resolved) {
            await sendSpaceInvite(session.record, matrixUserId, role).catch((err) => {
              console.warn('[YANTA Spaces] group invite delivery failed', matrixUserId, err);
              failed.push(t('publicShare.groups.failKeys', { id: matrixUserId }));
            });
          } else {
            failed.push(t('publicShare.groups.failNoAccount', { id: matrixUserId }));
          }
        } catch (err) {
          console.error(err);
          failed.push(`${matrixUserId} (${err?.message || t('publicShare.groups.failed')})`);
        }
      }

      btn.disabled = false;

      if (failed.length) {
        toast(t('publicShare.groups.sharedIssues', { name: group.name, issues: failed.join(' · ') }), 'error');
      } else {
        toast(t('publicShare.groups.sharedAll', { name: group.name }), 'success');
      }

      await renderMembers();
    });
  });

  host.querySelector('[data-share-groups-manage]')?.addEventListener('click', async () => {
    await openShareGroupsManager();
    await renderShareGroupsRow(body, session, renderMembers);
  });
}

async function openShareGroupsManager() {
  const groups = await loadShareGroups();

  const wrap = document.createElement('div');
  wrap.className = 'modal yanta-share-groups-modal';

  const renderList = () => {
    wrap.querySelector('[data-groups-list]').innerHTML = groups.length
      ? groups.map((group) => `
          <div class="yanta-share-group-editor" data-group-id="${escapeHtml(group.id)}">
            <div class="yanta-public-share-link-row">
              <input class="text-input" data-group-name value="${escapeHtml(group.name)}" />
              <button class="btn danger" data-group-delete title="${escapeHtml(t('publicShare.groups.delete'))}">${lucide('trash', 14)}</button>
            </div>
            <textarea
              class="text-input"
              data-group-members
              rows="3"
              placeholder="@anna:yanta.me&#10;@ben:yanta.me"
            >${escapeHtml(group.members.join('\n'))}</textarea>
          </div>
        `).join('')
      : `<div class="yanta-public-shares-empty">${escapeHtml(t('publicShare.groups.empty'))}</div>`;

    wrap.querySelectorAll('[data-group-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('[data-group-id]')?.dataset.groupId;
        await deleteShareGroup(id);

        const idx = groups.findIndex((g) => g.id === id);
        if (idx >= 0) groups.splice(idx, 1);

        renderList();
      });
    });
  };

  return new Promise((resolve) => {
    wrap.innerHTML = `
      <div class="modal-card yanta-share-groups-card">
        <header class="modal-head">
          <h3>${lucide('users', 16)} ${escapeHtml(t('publicShare.groups.title'))}</h3>
          <button class="icon-btn" data-groups-close>&times;</button>
        </header>

        <div class="modal-body">
          <div class="yanta-public-share-info">
            ${escapeHtml(t('publicShare.groups.info'))}
          </div>

          <div data-groups-list></div>

          <div class="yanta-public-share-link-row" style="margin-top:10px">
            <input class="text-input" data-new-group-name placeholder="${escapeHtml(t('publicShare.groups.newPlaceholder'))}" />
            <button class="btn primary" data-new-group-add>${lucide('plus', 14)} ${escapeHtml(t('publicShare.groups.create'))}</button>
          </div>

          <div class="compress-actions">
            <span class="grow"></span>
            <button class="btn primary" data-groups-save>${lucide('check', 14)} ${escapeHtml(t('publicShare.groups.saveClose'))}</button>
          </div>
        </div>
      </div>
    `;

    document.body.append(wrap);
    renderList();

    const close = () => {
      wrap.remove();
      resolve();
    };

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close();
      if (e.target.closest?.('[data-groups-close]')) close();
    });

    wrap.querySelector('[data-new-group-add]')?.addEventListener('click', async () => {
      const input = wrap.querySelector('[data-new-group-name]');
      const name = input?.value?.trim();
      if (!name) return;

      const group = await createShareGroup(name);
      groups.push(group);

      if (input) input.value = '';
      renderList();
    });

    wrap.querySelector('[data-groups-save]')?.addEventListener('click', async () => {
      for (const editor of wrap.querySelectorAll('[data-group-id]')) {
        const id = editor.dataset.groupId;
        const name = editor.querySelector('[data-group-name]')?.value?.trim();
        const members = (editor.querySelector('[data-group-members]')?.value || '')
          .split(/[\n,;]+/)
          .map((m) => m.trim())
          .filter(Boolean);

        const group = groups.find((g) => g.id === id);

        if (group) {
          group.name = name || group.name;
          group.members = members;

          const { renameShareGroup } = await import('../spaces/share-groups.js');
          await renameShareGroup(id, group.name);
          await setShareGroupMembers(id, members);
        }
      }

      toast(t('publicShare.groups.saved'), 'success');
      close();
    });
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
      toast(t('publicShare.people.redeliverFailed', { id: member.matrixUserId }), 'error');
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
          <strong>${escapeHtml(t('publicShare.tab.people'))}</strong><br>
          ${escapeHtml(t('publicShare.people.introNoShare'))}
        </div>

        <div class="compress-actions">
          <button class="btn primary" data-people-start-share>
            ${lucide('users', 14)}
            ${escapeHtml(t('publicShare.live.start'))}
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
          ? t('publicShare.live.signIn')
          : err?.message || t('publicShare.live.startFailed'), 'error');
      }

      await renderPeopleTab();
    });

    return;
  }

  body.innerHTML = `
    <div class="yanta-public-share-box">
      <div class="yanta-public-share-info">
        <strong>${escapeHtml(t('publicShare.tab.people'))}</strong><br>
        ${t(`publicShare.people.intro.${targetThing()}`, {
          example: '<code>@anna:yanta.me</code>',
          sharedWithMe: `<em>${escapeHtml(t('tree.section.sharedWithMe'))}</em>`,
        })}
      </div>

      <div class="yanta-public-share-link-row">
        <input class="text-input" data-people-input placeholder="@user:yanta.me">
        <select class="text-input" data-people-role style="max-width:120px">
          <option value="read">${escapeHtml(t('calendarShare.role.read'))}</option>
          <option value="write">${escapeHtml(t('calendarShare.role.write'))}</option>
        </select>
        <button class="btn primary" data-people-add>${lucide('user-plus', 14)} ${escapeHtml(t('publicShare.people.add'))}</button>
      </div>

      <div class="yanta-share-groups" data-people-groups></div>

      <div class="yanta-public-shares-list" data-people-list>
        <div class="yanta-public-shares-empty">${escapeHtml(t('publicShare.people.loading'))}</div>
      </div>
    </div>
  `;

  const listHost = body.querySelector('[data-people-list]');

  const renderMembers = async () => {
    let members = [];

    try {
      members = await apiListSpaceMembers(session.spaceId);
    } catch (err) {
      listHost.innerHTML = `<div class="yanta-public-shares-empty">${escapeHtml(err?.message || t('publicShare.people.loadFailed'))}</div>`;
      return;
    }

    // Every membership change ends up here — the single place to keep
    // the in-space roster (what recipients and the dashboard read) in
    // step with the server's member table.
    publishSpaceRoster(session.spaceId, members).catch(() => {});

    if (!members.length) {
      listHost.innerHTML = `<div class="yanta-public-shares-empty">${escapeHtml(t('publicShare.people.none'))}</div>`;
      return;
    }

    listHost.replaceChildren();

    for (const member of members) {
      const row = document.createElement('div');
      row.className = 'yanta-public-share-row';

      row.innerHTML = `
        <div class="yanta-public-share-row-main">
          <strong>${escapeHtml(member.matrixUserId || member.userId)}</strong>
          <small>${escapeHtml(member.role === 'write' ? t('calendarShare.role.write') : t('calendarShare.role.read'))}</small>
        </div>
        <div class="yanta-public-share-row-actions">
          <select class="text-input" data-member-role style="max-width:110px">
            <option value="read" ${member.role === 'read' ? 'selected' : ''}>${escapeHtml(t('calendarShare.role.read'))}</option>
            <option value="write" ${member.role === 'write' ? 'selected' : ''}>${escapeHtml(t('calendarShare.role.write'))}</option>
          </select>
          <button class="btn" data-member-resend title="${escapeHtml(t('publicShare.people.resend'))}">${lucide('send', 14)}</button>
          <button class="btn danger" data-member-remove title="${escapeHtml(t('publicShare.people.remove'))}">${lucide('user-x', 14)}</button>
        </div>
      `;

      row.querySelector('[data-member-resend]')?.addEventListener('click', async (e) => {
        const resendBtn = e.currentTarget;
        resendBtn.disabled = true;

        try {
          await sendSpaceInvite(session.record, member.matrixUserId, member.role);
          toast(t('publicShare.people.resent', { id: member.matrixUserId }), 'success');
        } catch (err) {
          console.error(err);
          toast(err?.message || t('publicShare.people.resendFailed'), 'error');
        }

        resendBtn.disabled = false;
      });

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

          toast(t('publicShare.people.updated'), 'success');
        } catch (err) {
          console.error(err);
          toast(err?.message || t('publicShare.people.changeFailed'), 'error');
        }

        await renderMembers();
      });

      row.querySelector('[data-member-remove]')?.addEventListener('click', async () => {
        const ok = await yantaConfirm({
          title: t('publicShare.people.removeTitle'),
          message: member.matrixUserId
            ? t('publicShare.people.removeMessage', { id: member.matrixUserId })
            : t('publicShare.people.removeMessageUnknown'),
          confirmLabel: t('publicShare.people.removeConfirm'),
          cancelLabel: t('common.cancel'),
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

          toast(t('publicShare.people.removed'), 'success');
        } catch (err) {
          console.error(err);
          toast(err?.message || t('publicShare.people.removeFailed'), 'error');
        }

        await renderMembers();
      });

      listHost.append(row);
    }
  };

  renderMembers();
  renderShareGroupsRow(body, session, renderMembers).catch(() => {});

  body.querySelector('[data-people-add]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const input = body.querySelector('[data-people-input]');
    const role = body.querySelector('[data-people-role]')?.value === 'write' ? 'write' : 'read';

    const matrixUserId = (await chatActions()).normalizeUserId(input?.value || '', {
      defaultServer: await ownMatrixServer(),
    });

    if (!matrixUserId) {
      toast(t('publicShare.people.invalidId'), 'error');
      return;
    }

    btn.disabled = true;

    try {
      const res = await apiAddSpaceMember(session.spaceId, { matrixUserId, role });

      if (res.resolved) {
        /*
          Access is granted at this point even if key delivery fails
          (e.g. Chat not connected). Say so explicitly — otherwise the
          owner sees an error and assumes nothing happened, while the
          member row exists without keys.
        */
        try {
          await sendSpaceInvite(session.record, matrixUserId, role);
          toast(t('publicShare.people.shared', { id: matrixUserId }), 'success');
        } catch (err) {
          console.error(err);
          toast(
            t('publicShare.people.keyDeliveryFailed', { reason: err?.message || t('publicShare.people.chatUnavailable') }),
            'error'
          );
        }

        if (input) input.value = '';
      } else {
        // Not a YANTA user — offer the link fallback over federation.
        const ok = await yantaConfirm({
          title: t('publicShare.people.notUserTitle'),
          message: t(role === 'write' ? 'publicShare.people.notUserWrite' : 'publicShare.people.notUserRead', { id: matrixUserId }),
          confirmLabel: t('publicShare.people.sendLink'),
          cancelLabel: t('common.cancel'),
          icon: 'link',
        });

        if (ok) {
          const links = spaceLinksFor(session);
          const url = role === 'write' && links.write ? links.write : links.read;
          await sendSpaceLinkMessage(
            matrixUserId,
            session.record.title
              ? t('publicShare.people.linkMessage', { title: session.record.title, url })
              : t('publicShare.people.linkMessageUntitled', { url })
          );
          toast(t('publicShare.people.linkSent', { id: matrixUserId }), 'success');
          if (input) input.value = '';
        }
      }
    } catch (err) {
      console.error(err);
      toast(err?.message || t('publicShare.people.shareFailed'), 'error');
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
    parts.push(t('publicShare.manager.upToDate'));
  } else if (status === 'pending') {
    parts.push(t('publicShare.manager.pending'));
  } else if (status === 'publishing') {
    parts.push(t('publicShare.manager.publishing'));
  } else if (status === 'failed') {
    parts.push(t('publicShare.manager.failed'));
  } else {
    parts.push(t('publicShare.manager.active'));
  }

  if (row.share?.cloudOnly) {
    parts.push(t('publicShare.manager.cloudOnly'));
  }

  const published = row.lastPublishedAt || row.share?.lastPublishedAt;
  if (published) {
    parts.push(t('publicShare.manager.published', { time: formatPublicShareTime(published) }));
  }

  return parts.join(' · ');
}

async function renderPublicSharesManager() {
  const m = ensureManagerModal();

  m.innerHTML = `
    <div class="modal-card yanta-public-shares-manager-card">
      <header class="modal-head">
        <h3>${escapeHtml(t('publicShare.manager.title'))}</h3>
        <button class="icon-btn" data-public-shares-manager-close>&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-public-share-info">
          ${escapeHtml(t('publicShare.manager.info'))}
        </div>

        <div class="compress-actions" style="margin:12px 0;flex-wrap:wrap">
          <button class="btn" data-refresh-public-shares-manager>
            ${lucide('refresh-cw', 14)}
            ${escapeHtml(t('publicShare.manager.refresh'))}
          </button>

          <span class="grow"></span>

          <button class="btn danger" data-stop-all-public-shares>
            ${lucide('trash', 14)}
            ${escapeHtml(t('publicShare.manager.stopAll'))}
          </button>
        </div>

        <div data-public-shares-manager-body>
          <div class="tree-empty">${escapeHtml(t('publicShare.manager.loading'))}</div>
        </div>
      </div>
    </div>
  `;

  const body = m.querySelector('[data-public-shares-manager-body]');
  const rows = await loadPublicShareRows();

  if (!rows.length) {
    body.innerHTML = `
      <div class="yanta-public-shares-empty">
        ${escapeHtml(t('publicShare.manager.empty'))}
      </div>
    `;
  } else {
    body.innerHTML = `
      <div class="yanta-public-shares-list">
        ${rows.map((row) => {
          const title =
            row.note?.title ||
            t('publicShare.manager.missingNote', { id: row.noteId });

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
                  ${escapeHtml(t('publicShare.public.stop'))}
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
      title: t('publicShare.manager.stopAllTitle'),
      message: t('publicShare.manager.stopAllMessage'),
      confirmLabel: t('publicShare.manager.stopAllConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
      icon: 'trash',
    });

    if (!ok) return;

    try {
      await stopAllPublicShares();
      await renderPublicSharesManager();
    } catch (err) {
      console.error(err);
      toast(err?.message || t('publicShare.manager.stopAllFailed'), 'error');
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
        title: t('publicShare.public.stopTitle'),
        message: (note?.title || noteId)
          ? t('publicShare.public.stopNamedMessage', { title: note?.title || noteId })
          : t('publicShare.public.stopMessage'),
        confirmLabel: t('publicShare.public.stop'),
        cancelLabel: t('common.cancel'),
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
        toast(err?.message || t('publicShare.public.stopFailed'), 'error');
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
  calendarCategoryId = '',
  noteId: explicitNoteId = '',
} = {}) {
  registerShareOverlayRoutes();

  if (folderId) {
    if (!state.folders.has(folderId)) {
      toast(t('publicShare.folderNotFound'), 'error');
      return;
    }

    shareTarget = { kind: 'folder', id: folderId };
  } else if (calendarCategoryId) {
    if (!state.calendarCategories.has(calendarCategoryId)) {
      toast(t('publicShare.calendarNotFound'), 'error');
      return;
    }

    shareTarget = { kind: 'calendar', id: calendarCategoryId };
  } else {
    const noteId = explicitNoteId || state.currentNoteId;

    if (!noteId || !state.notes.has(noteId)) {
      toast(t('publicShare.openNoteFirst'), 'error');
      return;
    }

    shareTarget = { kind: 'note', id: noteId };
  }

  // A private folder's content never leaves it (private/private-folders.js).
  const privateTarget = shareTarget.kind === 'note'
    ? state.notes.get(shareTarget.id)?.privateFolderId
    : shareTarget.kind === 'folder' && state.folders.get(shareTarget.id)?.privateFolderId;
  if (privateTarget) {
    toast(t('private.noShare'), 'error');
    return;
  }

  const isNote = shareTarget.kind === 'note';
  const isFolder = targetIsFolder();
  const targetId = shareTarget.id;
  const m = ensureModal();

  m.innerHTML = `
    <div class="modal-card yanta-public-share-card">
      <header class="modal-head">
        <h3>${escapeHtml(t(`publicShare.dialogTitle.${targetThing()}`, { title: targetTitle() }))}</h3>
        <button class="icon-btn" data-public-share-close>&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-share-tabs">
          ${isNote ? `<button data-share-tab="public" class="active">${escapeHtml(t('publicShare.tab.public'))}</button>` : ''}
          <button data-share-tab="live" ${isNote ? '' : 'class="active"'}>${escapeHtml(t('publicShare.tab.live'))}</button>
          ${isChatEnabled() ? `<button data-share-tab="people">${escapeHtml(t('publicShare.tab.people'))}</button>` : ''}
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
      noteId: isNote ? targetId : '',
      folderId: isFolder ? targetId : '',
      calendarCategoryId: targetIsCalendar() ? targetId : '',
    });
  }

  if (!isNote) {
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
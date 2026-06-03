// ============================================================
// YANTA Sync2 — Progress UI
//
// Best-practice UX:
// - Routine / mini syncs: use existing vaultIndicator in sidebar-toe.
//   No layout shift, no distracting card.
// - Large / initial / explicit syncs: show a detailed progress box above
//   sidebar footer.
// - "Sync complete" always renders progress as 100%.
// ============================================================

import {
  lucide,
} from '../core.js';

let detailRoot = null;
let hideTimer = 0;
let hadVisibleDetailedActivity = false;
let compactResetTimer = 0;

const DETAILED_TOTAL_THRESHOLD = 50;

/*
  Nur Phasen, die eindeutig für einen großen/initialen Sync stehen.
  Asset-"Checking" passiert auch bei Routine-Syncs und darf NICHT automatisch
  den großen Indicator öffnen.
*/
const DETAILED_PHASES = new Set([
  'uploadVaultSnapshot',
  'uploadNoteSnapshots',
]);

function escapeHtmlLocal(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function ensureCss() {
  if (document.getElementById('yanta-sync2-progress-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-sync2-progress-css';
  style.textContent = `
/* ============================================================
   Compact sync state: existing vaultIndicator
   ============================================================ */

.vault-indicator.yanta-sync2-compact {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  min-width: 0;

  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    color 160ms ease,
    opacity 160ms ease,
    transform 160ms ease;
}

.vault-indicator.yanta-sync2-compact .yanta-sync2-compact-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  width: 14px;
  height: 14px;

  color: currentColor;
}

.vault-indicator.yanta-sync2-compact .yanta-sync2-compact-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.vault-indicator.yanta-sync2-compact.is-syncing {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
  background: color-mix(in srgb, var(--accent) 9%, transparent);
}

.vault-indicator.yanta-sync2-compact.is-syncing .yanta-sync2-compact-icon {
  animation: yanta-sync2-spin 0.9s linear infinite;
}

.vault-indicator.yanta-sync2-compact.is-uploading {
  color: var(--accent);
}

.vault-indicator.yanta-sync2-compact.is-downloading {
  color: var(--accent-2);
}

.vault-indicator.yanta-sync2-compact.is-done {
  color: var(--green);
  border-color: color-mix(in srgb, var(--green) 36%, var(--border));
  background: color-mix(in srgb, var(--green) 9%, transparent);
}

.vault-indicator.yanta-sync2-compact.is-error {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 45%, var(--border));
  background: color-mix(in srgb, var(--red) 9%, transparent);
}

@keyframes yanta-sync2-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Collapsed sidebar: compact remains icon-like */
.app.sidebar-collapsed .vault-indicator.yanta-sync2-compact {
  width: 30px;
  height: 30px;
  padding: 0;

  justify-content: center;
  border-radius: 999px;
}

.app.sidebar-collapsed .vault-indicator.yanta-sync2-compact .yanta-sync2-compact-label {
  display: none;
}

/* ============================================================
   Detailed sync progress box
   ============================================================ */

.yanta-sync2-progress-sidebar {
  margin: 8px 10px 8px;
  padding: 9px 10px;

  display: flex;
  flex-direction: column;
  gap: 7px;

  border: 1px solid var(--border);
  border-radius: 11px;

  background: var(--bg-elev-2);
  color: var(--text);

  box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset;

  opacity: 1;
  transform: translateY(0);

  transition:
    opacity 180ms ease,
    transform 220ms cubic-bezier(.2,.8,.2,1),
    border-color 160ms ease,
    background-color 160ms ease;
}

.yanta-sync2-progress-sidebar[hidden] {
  display: none !important;
}

.yanta-sync2-progress-sidebar.is-hiding {
  opacity: 0;
  transform: translateY(5px);
}

.yanta-sync2-progress-sidebar.is-done {
  border-color: color-mix(in srgb, var(--green) 38%, var(--border));
  background: color-mix(in srgb, var(--green) 7%, var(--bg-elev-2));
}

.yanta-sync2-progress-sidebar.is-error {
  border-color: color-mix(in srgb, var(--red) 45%, var(--border));
  background: color-mix(in srgb, var(--red) 8%, var(--bg-elev-2));
}

.yanta-sync2-progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.yanta-sync2-progress-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.yanta-sync2-progress-sidebar.is-done .yanta-sync2-progress-icon {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 14%, transparent);
}

.yanta-sync2-progress-sidebar.is-error .yanta-sync2-progress-icon {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 14%, transparent);
}

.yanta-sync2-progress-main {
  flex: 1;
  min-width: 0;
}

.yanta-sync2-progress-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--text);

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-sync2-progress-sub {
  margin-top: 1px;
  font-size: 10px;
  color: var(--text-dim);

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-sync2-progress-count {
  flex: 0 0 auto;

  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
}

.yanta-sync2-progress-bar {
  position: relative;
  height: 4px;

  overflow: hidden;
  border-radius: 999px;

  background: color-mix(in srgb, var(--text-faint) 18%, transparent);
}

.yanta-sync2-progress-bar > span {
  position: absolute;
  inset: 0 auto 0 0;

  width: calc(var(--sync2-pct, 0) * 1%);
  min-width: var(--sync2-min-width, 0px);

  border-radius: inherit;
  background: linear-gradient(
    90deg,
    var(--accent),
    color-mix(in srgb, var(--accent) 65%, white)
  );

  transition: width 260ms ease;
}

.yanta-sync2-progress-sidebar.indeterminate .yanta-sync2-progress-bar > span {
  width: 45%;
  min-width: 45%;
  animation: yanta-sync2-indeterminate 1.1s ease-in-out infinite;
}

.yanta-sync2-progress-sidebar.is-done .yanta-sync2-progress-bar > span {
  width: 100% !important;
  min-width: 100% !important;
  background: var(--green);
}

.yanta-sync2-progress-sidebar.is-error .yanta-sync2-progress-bar > span {
  background: var(--red);
}

@keyframes yanta-sync2-indeterminate {
  0% {
    transform: translateX(-110%);
  }
  50% {
    transform: translateX(70%);
  }
  100% {
    transform: translateX(240%);
  }
}

/* Collapsed sidebar: hide detailed box entirely, use compact indicator only */
.app.sidebar-collapsed .yanta-sync2-progress-sidebar {
  display: none !important;
}

@media (max-width: 880px) {
  .yanta-sync2-progress-sidebar {
    margin: 8px 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .vault-indicator.yanta-sync2-compact,
  .vault-indicator.yanta-sync2-compact *,
  .yanta-sync2-progress-sidebar,
  .yanta-sync2-progress-sidebar *,
  .yanta-sync2-progress-sidebar *::before,
  .yanta-sync2-progress-sidebar *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;

  document.head.append(style);
}

function vaultIndicator() {
  return document.getElementById('vaultIndicator');
}

function ensureDetailedRoot() {
  if (detailRoot) return detailRoot;

  ensureCss();

  detailRoot = document.createElement('div');
  detailRoot.className = 'yanta-sync2-progress-sidebar';
  detailRoot.hidden = true;

  const sidebar = document.getElementById('sidebar');
  const toe = sidebar?.querySelector('.sidebar-toe');

  if (sidebar && toe) {
    sidebar.insertBefore(detailRoot, toe);
  } else if (sidebar) {
    sidebar.append(detailRoot);
  } else {
    document.body.append(detailRoot);
  }

  return detailRoot;
}

function phaseLabel(phase = '') {
  const map = {
    start: 'Starting sync…',
    init: 'Preparing sync…',

    uploadOutbox: 'Uploading changes…',
    uploadVaultSnapshot: 'Uploading vault snapshot…',
    uploadNoteSnapshots: 'Uploading note snapshots…',
    uploadAssets: 'Uploading assets…',

    downloadVaultSnapshots: 'Checking vault snapshots…',
    downloadVaultUpdates: 'Downloading vault updates…',
    downloadNoteSnapshots: 'Checking note snapshots…',
    downloadNoteUpdates: 'Checking note updates…',
    downloadAssets: 'Downloading assets…',

    hydrate: 'Updating local vault…',
    finalize: 'Finalizing sync…',
    complete: 'Sync complete',
    error: 'Sync failed',
  };

  return map[phase] || phase || 'Synchronizing…';
}

function directionIcon(detail) {
  if (detail?.status === 'error') return 'triangle-alert';
  if (detail?.status === 'done' || detail?.phase === 'complete') return 'check';

  if (detail?.direction === 'up') return 'cloud-upload';
  if (detail?.direction === 'down') return 'cloud-download';

  return 'refresh-cw';
}

function compactLabel(detail) {
  if (detail?.status === 'error' || detail?.phase === 'error') return 'Sync error';
  if (detail?.status === 'done' || detail?.phase === 'complete') return 'Synced';
  if (detail?.direction === 'up') return 'Syncing…';
  if (detail?.direction === 'down') return 'Checking…';
  return 'Syncing…';
}

function subtitle(detail) {
  const bits = [];

  if (detail.provider) bits.push(detail.provider.replace('ObjectStore', ''));
  if (detail.direction === 'up') bits.push('upload');
  if (detail.direction === 'down') bits.push('download');
  if (detail.message) bits.push(detail.message);
  if (detail.noteId) bits.push(`note ${String(detail.noteId).slice(0, 8)}…`);

  return bits.join(' · ');
}

function pct(detail) {
  const isDone = detail?.status === 'done' || detail?.phase === 'complete';

  if (isDone) return 100;

  const current = Number(detail.current || 0);
  const total = Number(detail.total || 0);

  if (!total || total <= 0) return null;

  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function countText(detail) {
  const isDone = detail?.status === 'done' || detail?.phase === 'complete';

  if (isDone) return '100%';

  const current = Number(detail.current || 0);
  const total = Number(detail.total || 0);

  if (!total || total <= 0) return '';

  return `${current}/${total}`;
}

function shouldShowDetailed(detail = {}) {
  const phase = detail.phase || '';
  const direction = detail.direction || '';
  const status = detail.status || '';
  const total = Number(detail.total || 0);
  const msg = String(detail.message || '').toLowerCase();

  /*
    Fehler immer sichtbar machen.
  */
  if (status === 'error' || phase === 'error') {
    return true;
  }

  /*
    Complete nur groß anzeigen, wenn vorher auch große Aktivität sichtbar war.
    Sonst bleibt "Synced" nur im kompakten vaultIndicator.
  */
  if (status === 'done' || phase === 'complete') {
    return hadVisibleDetailedActivity;
  }

  /*
    Explizit große Operationen. Das ist der sauberste Trigger.
    Beispiel: Setup / Full Snapshot / Repair.
  */
  if (detail.detailed === true) {
    return true;
  }

  /*
    Initial/full snapshot phases.
    Diese sind immer user-relevant und dürfen Platz einnehmen.
  */
  if (DETAILED_PHASES.has(phase)) {
    return true;
  }

  /*
    Upload-Outbox ist echte Arbeit.
    Aber nur große Upload-Batches öffnen die große Box.
    Kleine Uploads bleiben kompakt im vaultIndicator.
  */
  if (
    phase === 'uploadOutbox' &&
    direction === 'up' &&
    total >= DETAILED_TOTAL_THRESHOLD
  ) {
    return true;
  }

  /*
    Asset-Upload nur groß anzeigen, wenn explizit detailed gesetzt wurde
    oder wirklich viele Assets betroffen sind.
  */
  if (
    phase === 'uploadAssets' &&
    direction === 'up' &&
    total >= DETAILED_TOTAL_THRESHOLD
  ) {
    return true;
  }

  /*
    Downloads/Checks bei Routine-Syncs bleiben kompakt.
    Wichtig:
    Bei Cloud-Sync kann total die Anzahl historischer Remote-Objekte sein,
    nicht die Anzahl echter Änderungen. Deshalb KEIN generisches:
      if (total >= threshold) true
    für Downloads.
  */
  if (direction === 'down') {
    return false;
  }

  return false;
}

function updateCompact(detail = {}) {
  const indicator = vaultIndicator();
  if (!indicator) return;

  ensureCss();

  clearTimeout(compactResetTimer);

  const isDone = detail.status === 'done' || detail.phase === 'complete';
  const isError = detail.status === 'error' || detail.phase === 'error';
  const isUp = detail.direction === 'up';
  const isDown = detail.direction === 'down';
  const isSyncing = !isDone && !isError;

  indicator.hidden = false;
  indicator.classList.add('yanta-sync2-compact');
  indicator.classList.toggle('is-syncing', isSyncing);
  indicator.classList.toggle('is-uploading', isUp && isSyncing);
  indicator.classList.toggle('is-downloading', isDown && isSyncing);
  indicator.classList.toggle('is-done', isDone);
  indicator.classList.toggle('is-error', isError);

  const icon = directionIcon(detail);
  const label = compactLabel(detail);
  const title = [
    phaseLabel(detail.phase),
    detail.message,
    detail.noteId ? `Note ${detail.noteId}` : '',
  ].filter(Boolean).join(' · ');

  indicator.title = title || label;

  indicator.innerHTML = `
    <span class="yanta-sync2-compact-icon">
      ${lucide(icon, 13)}
    </span>
    <span class="yanta-sync2-compact-label">
      ${escapeHtmlLocal(label)}
    </span>
  `;

  if (isDone || isError) {
    compactResetTimer = window.setTimeout(() => {
      resetCompact();
    }, isError ? 5200 : 1800);
  }
}

function resetCompact() {
  const indicator = vaultIndicator();
  if (!indicator) return;

  indicator.classList.remove(
    'yanta-sync2-compact',
    'is-syncing',
    'is-uploading',
    'is-downloading',
    'is-done',
    'is-error'
  );

  /*
    Restore neutral vault indicator content.
    If another module later renders richer provider status, it can overwrite.
  */
  indicator.innerHTML = `
    <span class="sync-sym sync-synced">✓</span>
    <span>Cloud</span>
  `;

  indicator.title = 'YANTA Cloud Sync';
}

function showDetailed(detail = {}) {
  const node = ensureDetailedRoot();

  clearTimeout(hideTimer);

  const p = pct(detail);
  const indeterminate = p == null;
  const isDone = detail.status === 'done' || detail.phase === 'complete';
  const isError = detail.status === 'error' || detail.phase === 'error';

  if (!isDone && !isError) {
    hadVisibleDetailedActivity = true;
  }

  node.hidden = false;
  node.classList.remove('is-hiding');

  node.classList.toggle('indeterminate', indeterminate && !isDone && !isError);
  node.classList.toggle('is-done', isDone);
  node.classList.toggle('is-error', isError);

  node.style.setProperty('--sync2-pct', String(p ?? 0));
  node.style.setProperty('--sync2-min-width', indeterminate ? '24px' : '0px');

  node.title = `${phaseLabel(detail.phase)}${detail.message ? ` · ${detail.message}` : ''}`;

  node.innerHTML = `
    <div class="yanta-sync2-progress-row">
      <span class="yanta-sync2-progress-icon">
        ${lucide(directionIcon(detail), 15)}
      </span>

      <span class="yanta-sync2-progress-main">
        <div class="yanta-sync2-progress-title">
          ${escapeHtmlLocal(phaseLabel(detail.phase))}
        </div>
        <div class="yanta-sync2-progress-sub">
          ${escapeHtmlLocal(subtitle(detail))}
        </div>
      </span>

      <span class="yanta-sync2-progress-count">
        ${escapeHtmlLocal(countText(detail))}
      </span>
    </div>

    <div class="yanta-sync2-progress-bar">
      <span></span>
    </div>
  `;

  if (isDone || isError) {
    hideTimer = window.setTimeout(() => {
      hideDetailed();
    }, isError ? 5200 : 1800);
  }
}

function hideDetailed() {
  if (!detailRoot) return;

  detailRoot.classList.add('is-hiding');

  window.setTimeout(() => {
    if (!detailRoot) return;

    detailRoot.hidden = true;
    detailRoot.classList.remove('is-hiding');
    hadVisibleDetailedActivity = false;
  }, 240);
}

function handleProgress(detail = {}) {
  updateCompact(detail);

  const detailed = shouldShowDetailed(detail);

  if (detailed) {
    showDetailed(detail);
    return;
  }

  /*
    Wenn ein Routine-Sync läuft, darf eine alte detailed Box nicht offen bleiben.
    Mini-Syncs sollen ausschließlich im vaultIndicator sichtbar sein.
  */
  if (
    detailRoot &&
    !detailRoot.hidden &&
    detail.phase !== 'complete' &&
    detail.status !== 'done'
  ) {
    hideDetailed();
  }
}

export function setupSync2ProgressUi() {
  ensureCss();
  ensureDetailedRoot();

  window.addEventListener('yanta-sync2-progress', (e) => {
    handleProgress(e.detail || {});
  });

  window.addEventListener('yanta-sync2-progress-hide', () => {
    hideDetailed();
    resetCompact();
  });
}
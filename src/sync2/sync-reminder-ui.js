// ============================================================
// YANTA Sync Reminder UI
//
// Gentle data-safety reminder:
// - Only appears if no sync provider / sync folder is configured.
// - Triggered after meaningful note changes.
// - Not too aggressive: change threshold + cooldown + snooze.
// - Offers primary Cloud Sync and secondary encrypted backup.
// ============================================================

import {
    state,
    store,
    toast,
    lucide,
  } from '../core.js';
  
  import {
    sync,
  } from '../sync.js';
  
  const REMINDER_STATE_KEY = 'yanta.syncReminder.state.v1';
  
  const CHANGE_THRESHOLD = 3;
  const MIN_USER_NOTE_COUNT = 1;
  
  const FIRST_SHOW_DELAY_MS = 2500;
  const RESHOW_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
  const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
  const BACKUP_OK_MS = 30 * 24 * 60 * 60 * 1000;
  
  let initialized = false;
  let root = null;
  let showTimer = 0;
  let changeSaveTimer = 0;
  
  function now() {
    return Date.now();
  }
  
  function safeJsonParse(raw, fallback = {}) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  
  function readReminderState() {
    return {
      changes: 0,
      firstChangeAt: 0,
      lastShownAt: 0,
      snoozedUntil: 0,
      backupAt: 0,
      syncSeenAt: 0,
      ...safeJsonParse(localStorage.getItem(REMINDER_STATE_KEY) || '{}', {}),
    };
  }
  
  function writeReminderState(patch = {}) {
    const next = {
      ...readReminderState(),
      ...patch,
    };
  
    try {
      localStorage.setItem(REMINDER_STATE_KEY, JSON.stringify(next));
    } catch {}
  
    return next;
  }
  
  function userNotesCount() {
    let count = 0;
  
    for (const note of state.notes.values()) {
      if (!note) continue;
      if (note.system || note.aiBrain) continue;
      if (note.trashed) continue;
      if (String(note.id || '').startsWith('welcome_')) continue;
  
      count++;
    }
  
    return count;
  }
  
  async function hasAnySyncConfigured() {
    try {
      const provider = await store.settings.get('sync2.provider', null);
  
      if (provider) return true;
    } catch {}
  
    try {
      if (sync.handle) return true;
    } catch {}
  
    try {
      const legacyHandle = await store.settings.get('syncFolderHandle', null);
  
      if (legacyHandle) return true;
    } catch {}
  
    return false;
  }
  
  function hasRecentBackup(reminderState = readReminderState()) {
    return (
      reminderState.backupAt &&
      now() - Number(reminderState.backupAt || 0) < BACKUP_OK_MS
    );
  }
  
  function visibleModalOpen() {
    return !!document.querySelector(
      [
        '.modal:not([hidden])',
        '.yanta-dialog-modal:not([hidden])',
        '.palette:not([hidden])',
        '.yanta-cite-modal:not([hidden])',
        '.yanta-draw-modal:not([hidden])',
      ].join(',')
    );
  }
  
  function currentSurfaceAllowsReminder() {
    const app = document.getElementById('app');
    const surface = state.surface || app?.dataset?.surface || 'note';
  
    return surface === 'note' || surface === 'dashboard';
  }
  
  function injectCss() {
    if (document.getElementById('yanta-sync-reminder-css')) return;
  
    const style = document.createElement('style');
    style.id = 'yanta-sync-reminder-css';
    style.textContent = `
  .yanta-sync-reminder {
    position: fixed;
    right: max(18px, env(safe-area-inset-right));
    bottom: max(18px, env(safe-area-inset-bottom));
    z-index: 240;
  
    width: min(420px, calc(100vw - 28px));
  
    display: flex;
    flex-direction: column;
    gap: 10px;
  
    padding: 14px;
  
    border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border));
    border-radius: 16px;
  
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--accent) 10%, var(--bg-elev)),
        var(--bg-elev)
      );
  
    color: var(--text);
  
    box-shadow:
      0 24px 80px rgba(0,0,0,0.42),
      0 1px 0 rgba(255,255,255,0.04) inset;
  
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  
    animation: yanta-sync-reminder-in 180ms cubic-bezier(.2,.8,.2,1);
  }
  
  .yanta-sync-reminder[hidden] {
    display: none !important;
  }
  
  .yanta-sync-reminder-head {
    display: flex;
    align-items: flex-start;
    gap: 11px;
  }
  
  .yanta-sync-reminder-icon {
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
  
    display: inline-flex;
    align-items: center;
    justify-content: center;
  
    border-radius: 999px;
  
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
  
  .yanta-sync-reminder-main {
    flex: 1;
    min-width: 0;
  }
  
  .yanta-sync-reminder-main strong {
    display: block;
    color: var(--text);
    font-size: 14px;
    line-height: 1.25;
  }
  
  .yanta-sync-reminder-main p {
    margin: 4px 0 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.45;
  }
  
  .yanta-sync-reminder-close {
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
  
    display: inline-flex;
    align-items: center;
    justify-content: center;
  
    border: 0;
    border-radius: 999px;
  
    background: transparent;
    color: var(--text-faint);
  
    cursor: pointer;
  }
  
  .yanta-sync-reminder-close:hover {
    background: var(--bg-elev-2);
    color: var(--text);
  }
  
  .yanta-sync-reminder-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;
    flex-wrap: wrap;
  }
  
  .yanta-sync-reminder-actions .btn {
    min-height: 34px;
  }
  
  @keyframes yanta-sync-reminder-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.985);
    }
  
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  
  @media (max-width: 720px) {
    .yanta-sync-reminder {
      left: max(12px, env(safe-area-inset-left));
      right: max(12px, env(safe-area-inset-right));
      bottom: max(12px, env(safe-area-inset-bottom));
      width: auto;
    }
  
    .yanta-sync-reminder-actions {
      justify-content: stretch;
    }
  
    .yanta-sync-reminder-actions .btn {
      flex: 1 1 auto;
      justify-content: center;
    }
  }
  
  @media (prefers-reduced-motion: reduce) {
    .yanta-sync-reminder {
      animation: none !important;
    }
  }
    `;
  
    document.head.append(style);
  }
  
  function ensureRoot() {
    if (root) return root;
  
    injectCss();
  
    root = document.createElement('div');
    root.className = 'yanta-sync-reminder';
    root.hidden = true;
  
    root.innerHTML = `
      <div class="yanta-sync-reminder-head">
        <span class="yanta-sync-reminder-icon">
          ${lucide('shield-check', 18)}
        </span>
  
        <span class="yanta-sync-reminder-main">
          <strong>Schütze deine YANTA-Daten</strong>
          <p>
            Deine Notizen sind aktuell nur lokal gespeichert.
            Richte Sync ein oder lade ein verschlüsseltes Backup herunter,
            damit du deine Daten nicht verlierst.
          </p>
        </span>
  
        <button class="yanta-sync-reminder-close" data-sync-reminder-snooze title="Später erinnern">
          ${lucide('x', 15)}
        </button>
      </div>
  
      <div class="yanta-sync-reminder-actions">
        <button class="btn" data-sync-reminder-backup>
          ${lucide('download', 14)}
          Backup herunterladen
        </button>
  
        <button class="btn primary" data-sync-reminder-cloud>
          ${lucide('cloud', 14)}
          Cloud Sync einrichten
        </button>
      </div>
    `;
  
    root.querySelector('[data-sync-reminder-snooze]')?.addEventListener('click', () => {
      snoozeReminder();
    });
  
    root.querySelector('[data-sync-reminder-cloud]')?.addEventListener('click', async () => {
      hideReminder();
  
      try {
        const { openYantaCloudSetup } = await import('./yanta-cloud-setup-ui.js');
        await openYantaCloudSetup();
  
        writeReminderState({
          syncSeenAt: now(),
          snoozedUntil: now() + SNOOZE_MS,
        });
      } catch (err) {
        console.error('[YANTA Sync Reminder] could not open Cloud setup', err);
        toast('Cloud Sync konnte nicht geöffnet werden', 'error');
      }
    });
  
    root.querySelector('[data-sync-reminder-backup]')?.addEventListener('click', async () => {
      hideReminder();
  
      try {
        const { exportSyncCapsule } = await import('./capsule.js');
  
        await exportSyncCapsule();
  
        writeReminderState({
          backupAt: now(),
          snoozedUntil: now() + BACKUP_OK_MS,
        });
  
        toast('Verschlüsseltes Backup heruntergeladen', 'success');
      } catch (err) {
        console.error('[YANTA Sync Reminder] backup failed', err);
        toast('Backup konnte nicht erstellt werden', 'error');
      }
    });
  
    document.body.append(root);
  
    return root;
  }
  
  function showReminder() {
    const node = ensureRoot();
  
    node.hidden = false;
  
    writeReminderState({
      lastShownAt: now(),
    });
  }
  
  function hideReminder() {
    if (root) {
      root.hidden = true;
    }
  }
  
  function snoozeReminder() {
    hideReminder();
  
    writeReminderState({
      snoozedUntil: now() + SNOOZE_MS,
      lastShownAt: now(),
    });
  }
  
  async function shouldShowReminder() {
    if (!currentSurfaceAllowsReminder()) return false;
  
    if (visibleModalOpen()) return false;
  
    if (userNotesCount() < MIN_USER_NOTE_COUNT) return false;
  
    const reminderState = readReminderState();
  
    if (hasRecentBackup(reminderState)) return false;
  
    if (Number(reminderState.snoozedUntil || 0) > now()) return false;
  
    if (
      reminderState.lastShownAt &&
      now() - Number(reminderState.lastShownAt || 0) < RESHOW_COOLDOWN_MS
    ) {
      return false;
    }
  
    if (Number(reminderState.changes || 0) < CHANGE_THRESHOLD) return false;
  
    if (await hasAnySyncConfigured()) return false;
  
    return true;
  }
  
  function scheduleMaybeShowReminder(delay = FIRST_SHOW_DELAY_MS) {
    clearTimeout(showTimer);
  
    showTimer = window.setTimeout(async () => {
      try {
        if (await shouldShowReminder()) {
          showReminder();
        }
      } catch (err) {
        console.warn('[YANTA Sync Reminder] check failed', err);
      }
    }, delay);
  }
  
  function incrementMeaningfulChange() {
    clearTimeout(changeSaveTimer);
  
    const s = readReminderState();
  
    const next = {
      changes: Number(s.changes || 0) + 1,
      firstChangeAt: s.firstChangeAt || now(),
    };
  
    changeSaveTimer = window.setTimeout(() => {
      writeReminderState(next);
    }, 300);
  
    scheduleMaybeShowReminder();
  }
  
  function noteUpdateShouldCount(detail = {}) {
    const source = String(detail.source || '');
    const reason = String(detail.reason || '');
  
    if (source === 'sync' || source === 'sync2') return false;
    if (source === 'trash') return false;
  
    if (reason.includes('trash')) return false;
    if (reason.includes('sync')) return false;
  
    return true;
  }
  
  export function markSyncReminderBackupCreated() {
    writeReminderState({
      backupAt: now(),
      snoozedUntil: now() + BACKUP_OK_MS,
    });
  
    hideReminder();
  }
  
  export function setupSyncReminderUi() {
    if (initialized) return;
    initialized = true;
  
    injectCss();
    ensureRoot();
  
    window.addEventListener('yanta-note-updated', (e) => {
      if (!noteUpdateShouldCount(e.detail || {})) return;
  
      incrementMeaningfulChange();
    });
  
    window.addEventListener('yanta-folder-updated', (e) => {
      if (String(e.detail?.source || '') === 'sync') return;
  
      incrementMeaningfulChange();
    });
  
    window.addEventListener('yanta-sync2-runtime-ready', () => {
      writeReminderState({
        syncSeenAt: now(),
        snoozedUntil: now() + SNOOZE_MS,
      });
  
      hideReminder();
    });
  
    window.addEventListener('online', () => {
      scheduleMaybeShowReminder(1200);
    });
  
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        scheduleMaybeShowReminder(1200);
      }
    });
  
    // Initial delayed check. Usually this will not show because the threshold
    // has not been reached yet, but it covers returning users.
    scheduleMaybeShowReminder(4500);
  }
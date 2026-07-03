/**
 * Central event contract for app-wide Yanta events.
 *
 * Rules:
 * 1. `reason` is required for NOTE_UPDATED.
 *    Allowed values:
 *    - body-change
 *    - drawing-change
 *    - task-toggle
 *    - title-change
 *    - metadata-save
 *    - pin-toggle
 *    - layout-change
 *    - note-created
 *    - external-insert
 *
 * 2. Events with `source === 'sync'` and `changed === false` must never trigger
 *    visible re-renders or animations.
 *
 * 3. `reason === 'layout-change'` must not invalidate preview caches.
 */

export const EVT = Object.freeze({
  NOTE_UPDATED: 'yanta-note-updated',
  NOTE_OPENED: 'yanta-note-opened',
  NOTE_CLOSING: 'yanta-note-closing',
  FOLDER_UPDATED: 'yanta-folder-updated',
  DRAWING_UPDATED: 'yanta-drawing-updated',
  CALENDAR_UPDATED: 'yanta-calendar-updated',
  VAULT_HYDRATED: 'yanta-vault-hydrated',
  DASHBOARD_REFRESH: 'yanta-dashboard-refresh',
  THEME_CHANGE: 'yanta-theme-change',
});

const NOTE_UPDATED_REASONS = new Set([
  'body-change',
  'drawing-change',
  'task-toggle',
  'title-change',
  'metadata-save',
  'pin-toggle',
  'layout-change',
  'note-created',
  'external-insert',
]);

export function emit(name, detail = {}) {
  if (name === EVT.NOTE_UPDATED) {
    const reason = detail?.reason;

    if (!NOTE_UPDATED_REASONS.has(reason) && import.meta.env.DEV) {
      console.warn('[events] Invalid or missing NOTE_UPDATED reason:', reason, detail);
    }
  }

  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, handler, options) {
  window.addEventListener(name, handler, options);
  return () => window.removeEventListener(name, handler, options);
}

export function shouldIgnoreInvisibleSyncEvent(detail) {
  return detail?.source === 'sync' && detail?.changed === false;
}
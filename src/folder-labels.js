// ============================================================
// YANTA — what a folder is called on screen
//
// Folders the app creates for itself (the AI's memory, its chat history)
// are stored with an English name, and the AI's own instructions refer
// to them by it. On screen they read in the app's language — as long as
// nobody renamed them; a name someone chose is shown as it is.
// ============================================================

import { t } from './i18n/index.js';

const SYSTEM_FOLDERS = {
  system_ai_brain: ['AI Brain', 'folders.aiBrain'],
  system_ai_brain_skills: ['Skills', 'folders.aiSkills'],
  system_ai_brain_sessions: ['Session Summaries', 'folders.aiSummaries'],
  system_ai_sessions: ['AI Sessions', 'folders.aiSessions'],
};

/** The name to show for a folder. */
export function folderLabel(folder) {
  if (!folder) return t('items.folderFallback');
  const known = SYSTEM_FOLDERS[folder.id];
  if (known && (!folder.name || folder.name === known[0])) return t(known[1]);
  return folder.name || t('items.folderFallback');
}

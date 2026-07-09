// ============================================================
// YANTA Chat — Device-local UX preferences
//
// No secrets. These are UX-only settings and may safely live in Chat IndexedDB.
// ============================================================

import {
    toast,
  } from '../core.js';
  
  import {
    chatSettings,
  } from './chat-store.js';
  
  export const CHAT_PREFS_KEY = 'chat.preferences.v1';
  
  export const DEFAULT_CHAT_PREFERENCES = {
    sendReadReceipts: true,
    enterBehavior: 'send', // send | newline
    mediaAutoDownload: 'ask', // always | ask
  };
  
  /**
   * Returns effective Chat UX preferences.
   */
  export async function getChatPreferences() {
    try {
      const saved = await chatSettings.get(CHAT_PREFS_KEY, null);
  
      return {
        ...DEFAULT_CHAT_PREFERENCES,
        ...(saved || {}),
      };
    } catch (err) {
      console.warn('[YANTA Chat Preferences] Could not read preferences', err);
      toast('Could not read Chat preferences.', 'error');
  
      return {
        ...DEFAULT_CHAT_PREFERENCES,
      };
    }
  }
  
  /**
   * Persists Chat UX preferences.
   */
  export async function setChatPreferences(next = {}) {
    try {
      const current = await getChatPreferences();
  
      const clean = {
        ...current,
        ...next,
      };
  
      if (!['send', 'newline'].includes(clean.enterBehavior)) {
        clean.enterBehavior = DEFAULT_CHAT_PREFERENCES.enterBehavior;
      }
  
      if (!['always', 'ask'].includes(clean.mediaAutoDownload)) {
        clean.mediaAutoDownload = DEFAULT_CHAT_PREFERENCES.mediaAutoDownload;
      }
  
      clean.sendReadReceipts = clean.sendReadReceipts !== false;
  
      await chatSettings.set(CHAT_PREFS_KEY, clean);
  
      window.dispatchEvent(new CustomEvent('yanta-chat-preferences-changed', {
        detail: {
          preferences: clean,
          ts: Date.now(),
        },
      }));
  
      return clean;
    } catch (err) {
      console.warn('[YANTA Chat Preferences] Could not save preferences', err);
      toast('Could not save Chat preferences.', 'error');
  
      throw err;
    }
  }
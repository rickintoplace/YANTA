// ============================================================
// YANTA AI — Assistant UI
//
// Modes:
// - side pane
// - detached movable floating window
//
// Uses View Transition API for dock/undock when available.
// ============================================================

// @i18n-locked

import { t } from '../i18n/index.js';

import {
  escapeHtml,
  toast,
  lucide,
  state,
  safeUrl,
} from '../core.js';

import {
  openSidePane,
  closeSidePane,
  isSidePaneOpen,
} from '../side-pane.js';

import {
  getAiSettings,
  getAiApiKey,
} from './ai-settings.js';

import {
  getEffectiveAiRuntimeSettings,
  isIncludedAiMode,
  canUseIncludedAi,
} from './ai-access-policy.js';

import {
  renderAiSettingsPanel,
} from './ai-settings-panel.js';

import {
  setupAgentBridge,
} from '../agent/agent-bridge-client.js';

import {
  openRouterChatCompletion,
  openRouterChatCompletionStream,
} from './openrouter-client.js';

import {
  needsCompaction,
  compactConversation,
  historySinceSummary,
  summaryMessages,
} from './conversation-compaction.js';

import {
  openAiToolsForModel,
  getTool,
} from './tool-registry.js';

import {
  createToolLoadout,
} from './tool-loadout.js';

import {
  buildSystemMessage,
  buildContextMessage,
} from './context-builder.js';

import {
  renderBlocksInlineWithContext,
} from '../markdown.js';

import {
  createTaintTracker,
  noteToolResult,
  untrustedContentGate,
  collectUrls,
} from './untrusted-content.js';

import {
  runAgentLoop,
  AGENT_STOP,
} from './agent-loop.js';

import { fitHistory } from './agent-runtime.js';

import { buildCitationInstructions, stripForDisplay } from 'veriquote';

import {
  createSourceRegistry,
  YANTA_CITATION_PREAMBLE,
} from './citation-sources.js';

import {
  checkCitations,
  hasCitations,
  CITATION_PROBLEM_TYPES,
} from './citation-check.js';

import {
  WIDGET_INSTRUCTIONS,
  extractWidgets,
  mountWidgets,
} from './ui-widgets.js';

import {
  openNote,
} from '../notes.js';

import {
  noteMarkdown,
} from '../yjs.js';

import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
  overlayIdFromState,
} from '../overlay-history.js';

import {
  createAiContextItemsFromRefs,
  createAiContextItemsFromFiles,
  aiContextTotals,
  formatContextStats,
  modelSupportsImages,
} from './context-attachments.js';

import {
  computeAiContextMeterStats,
  formatAiContextMeterStats,
  aiContextMeterTitle,
} from './context-stats.js';

import {
  readAiContextDragData,
  dataTransferHasAiContext,
} from './context-dnd.js';

import {
  openAiContextPicker,
} from './context-picker-ui.js';

import {
  createAiSession,
  saveAiSession,
  loadAiSession,
} from './ai-sessions.js';

import {
  pushCalendarEventHistory,
} from '../navigation.js';

let initialized = false;
let aiOverlayRegistered = false;

let mode = 'pane'; // pane | floating
let root = null;
let messagesEl = null;
let inputEl = null;
let inputShellEl = null;
let sendBtn = null;
let settingsPanel = null;

let floatingShell = null;
let floatingBody = null;

let conversation = [];

/*
  Follow the conversation only while the reader is at the bottom. Every
  streamed token re-renders the list, and pinning to the bottom on each
  one made it impossible to scroll up and read while an answer was still
  being written.
*/
let pinChatToBottom = true;
let activeContextItems = [];
let contextTrayEl = null;
let contextMeterEl = null;

let currentSessionId = '';
let sessionSaveTimer = 0;

// Prevent duplicate AI Session notes caused by overlapping async saves.
let sessionSavePromise = null;
let sessionSaveRequested = false;
let creatingSession = null;

// Incremented whenever the visible chat/session identity is replaced.
// Async session creates from older generations are ignored.
let sessionGeneration = 0;

let abortController = null;
let settingsOpen = false;

let assistantBusy = false;
let assistantBusyLabel = '';
let assistantBusySince = 0;

let streamingReasoning = '';
// What this conversation has read (see ../ai/untrusted-content.js).
let chatTaint = createTaintTracker();
let externalSourceWriteAllowAll = false;

/*
  Tool groups loaded with tools_load stay loaded for the conversation.
  Rebuilt every turn, a calendar conversation paid an extra tools_load
  round (and its credits) on every single message.
*/
let conversationLoadout = null;
let conversationLoadoutKey = '';

function appendUniqueText(current = '', delta = '') {
  const a = String(current || '');
  const b = String(delta || '');

  if (!b) return a;
  if (!a) return b;

  // Provider sent cumulative text.
  if (b.startsWith(a)) return b;

  // Provider repeated the same delta.
  if (a.endsWith(b)) return a;

  const max = Math.min(a.length, b.length);

  for (let i = max; i > 0; i--) {
    if (a.slice(-i) === b.slice(0, i)) {
      return a + b.slice(i);
    }
  }

  return a + b;
}

const VT_NAME = 'yanta-ai-assistant';

const AI_FULLSCREEN_OVERLAY_ID = 'ai-fullscreen';
const AI_SETTINGS_OVERLAY_ID = 'ai-settings';

const AI_CHAT_TRANSIENT_KEY = 'yanta.ai.chat.transient.v1';
const AI_CHAT_TRANSIENT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const AI_CHAT_MAX_MESSAGES = 120;
const AI_CHAT_MAX_CHARS = 240000;

function supportsViewTransition() {
  return !!document.startViewTransition &&
    // eslint-disable-next-line yanta/no-untranslated-literal -- media query
    !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function isMobileAssistantViewport() {
  // eslint-disable-next-line yanta/no-untranslated-literal -- media query
  return window.matchMedia?.('(max-width: 880px)')?.matches;
}

function aiFullscreenOverlayIsOpen() {
  return (
    mode === 'floating' &&
    isMobileAssistantViewport() &&
    floatingShell &&
    floatingShell.hidden === false
  );
}

function assistantUiIsOpen() {
  if (mode === 'pane') {
    return isSidePaneOpen('ai') && !!root?.isConnected;
  }

  return !!(
    floatingShell &&
    floatingShell.hidden === false &&
    root?.isConnected
  );
}

function aiSettingsOverlayIsOpen() {
  return settingsOpen && assistantUiIsOpen();
}

function openAiSettings({
  fromHistory = false,
} = {}) {
  settingsOpen = true;
  renderSettings();

  /*
    Mobile AI is a fullscreen overlay. Settings inside it must become a
    child overlay so Android/browser Back returns to the chat instead of
    closing the whole assistant.
  */
  if (
    aiFullscreenOverlayIsOpen() &&
    !fromHistory &&
    overlayIdFromState() !== AI_SETTINGS_OVERLAY_ID
  ) {
    pushOverlayState(AI_SETTINGS_OVERLAY_ID);
  }
}

function closeAiSettings({
  fromHistory = false,
} = {}) {
  if (
    !fromHistory &&
    overlayIdFromState() === AI_SETTINGS_OVERLAY_ID
  ) {
    closeTopOverlay(() => {
      settingsOpen = false;
      renderSettings();
    });

    return;
  }

  settingsOpen = false;
  renderSettings();
}

function registerAiOverlayRoute() {
  if (aiOverlayRegistered) return;

  aiOverlayRegistered = true;

  registerOverlayRoute(AI_FULLSCREEN_OVERLAY_ID, {
    open: () => {
      openAssistantFloating({
        fromHistory: true,
      });
    },

    close: () => {
      closeAssistant({
        fromHistory: true,
      });
    },

    isOpen: aiFullscreenOverlayIsOpen,
  });

  registerOverlayRoute(AI_SETTINGS_OVERLAY_ID, {
    open: async () => {
      await openAssistantFloating({
        fromHistory: true,
      });

      openAiSettings({
        fromHistory: true,
      });
    },

    close: () => {
      closeAiSettings({
        fromHistory: true,
      });
    },

    isOpen: aiSettingsOverlayIsOpen,
  });
}

function shouldOpenAssistantFloatingInsteadOfPane() {
  if (mode === 'floating') return true;

  const appSurface =
    state.surface ||
    document.getElementById('app')?.dataset?.surface ||
    'note';

  // Dashboard / Calendar / Graph-like surfaces do not show panePreview reliably.
  if (appSurface !== 'note') return true;

  // If the user is not in split view, the side pane may be hidden by layout.
  if (state.view !== 'split') return true;

  // On mobile, floating/full assistant is more reliable than right-pane layout.
  if (isMobileAssistantViewport()) return true;

  return false;
}

export function openAssistantSmart() {
  if (shouldOpenAssistantFloatingInsteadOfPane()) {
    return openAssistantFloating();
  }

  return openAssistantPane();
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function compactStoredMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;

  const role = String(msg.role || '');

  if (!['user', 'assistant', 'tool', 'summary'].includes(role)) return null;

  return {
    role,
    content: String(msg.content || ''),
    reasoning: msg.reasoning ? String(msg.reasoning || '') : undefined,
    toolName: msg.toolName || undefined,
    model: msg.model || undefined,
    covers: msg.covers || undefined,
    // A check still running when the page closed never finishes.
    citeCheck: msg.citeCheck && !msg.citeCheck.pending ? msg.citeCheck : undefined,
    widgetState: msg.widgetState || undefined,
    ts: Number(msg.ts || Date.now()),
  };
}

function loadTransientConversation() {
  const raw = localStorage.getItem(AI_CHAT_TRANSIENT_KEY);
  if (!raw) return [];

  const parsed = safeJsonParse(raw, null);

  if (!parsed || typeof parsed !== 'object') return [];

  const savedAt = Number(parsed.savedAt || 0);

  if (!savedAt || Date.now() - savedAt > AI_CHAT_TRANSIENT_TTL_MS) {
    localStorage.removeItem(AI_CHAT_TRANSIENT_KEY);
    return [];
  }

  const list = Array.isArray(parsed.messages)
    ? parsed.messages
    : [];

  return list
    .map(compactStoredMessage)
    .filter(Boolean)
    .slice(-AI_CHAT_MAX_MESSAGES);
}

function saveTransientConversation() {
  try {
    let messages = conversation
      .map((m) => ({
        ...m,
        ts: m.ts || Date.now(),
      }))
      .map(compactStoredMessage)
      .filter(Boolean)
      .slice(-AI_CHAT_MAX_MESSAGES);

    while (
      messages.length &&
      JSON.stringify(messages).length > AI_CHAT_MAX_CHARS
    ) {
      messages.shift();
    }

    if (!messages.length) {
      localStorage.removeItem(AI_CHAT_TRANSIENT_KEY);
      return;
    }

    localStorage.setItem(AI_CHAT_TRANSIENT_KEY, JSON.stringify({
      savedAt: Date.now(),
      messages,
    }));
  } catch {}
}

function clearTransientConversation() {
  try {
    localStorage.removeItem(AI_CHAT_TRANSIENT_KEY);
  } catch {}
}

function ensureRoot() {
  if (root) return root;

  injectCss();

  root = document.createElement('div');
  root.className = 'yanta-ai-root';
  root.dataset.aiRoot = '1';
  root.dataset.aiContextDropTarget = '1';
  root.dataset.aiDropLabel = t('ai.chat.context.dropHint');

  root.innerHTML = `
    <header class="yanta-ai-head" data-ai-drag-handle>
      <div class="yanta-ai-title">
        ${lucide('bot', 17)}
        <strong>YANTA AI</strong>
      </div>

      <button class="icon-btn" data-ai-settings title="${escapeHtml(t('ai.chat.header.settings'))}">
        ${lucide('settings', 16)}
      </button>

      <button class="icon-btn" data-ai-detach title="${escapeHtml(t('ai.chat.header.detach'))}">
        ${lucide('picture-in-picture-2', 16)}
      </button>

      <button class="icon-btn" data-ai-clear title="${escapeHtml(t('ai.chat.header.newChat'))}">
        ${lucide('message-circle-plus', 16)}
      </button>

      <button class="icon-btn" data-ai-close title="${escapeHtml(t('ai.chat.header.close'))}">
        ${lucide('x', 16)}
      </button>
    </header>

    <section class="yanta-ai-settings" data-ai-settings-panel hidden></section>

    <main class="yanta-ai-messages" data-ai-messages>

      <div class="yanta-ai-context-meter" data-ai-context-meter hidden></div>
    </main>


    <footer class="yanta-ai-foot">
      <div class="yanta-ai-context-tray" data-ai-context-tray hidden></div>

      <div class="yanta-ai-input-shell" data-ai-input-shell>
        <button class="yanta-ai-input-btn yanta-ai-plus" data-ai-add-context title="${escapeHtml(t('ai.chat.input.addContext'))}" aria-label="${escapeHtml(t('ai.chat.input.addContext'))}">
          ${lucide('plus', 18)}
        </button>

        <textarea
          class="yanta-ai-input"
          data-ai-input
          rows="1"
          placeholder="${escapeHtml(t('ai.chat.input.placeholder'))}"
          enterkeyhint="send"></textarea>

        <button class="yanta-ai-input-btn yanta-ai-send" data-ai-send title="${escapeHtml(t('ai.chat.input.send'))}" aria-label="${escapeHtml(t('ai.chat.input.sendMessage'))}" disabled>
          ${lucide('arrow-up', 18)}
        </button>
      </div>
    </footer>
  `;

  messagesEl = root.querySelector('[data-ai-messages]');
  contextTrayEl = root.querySelector('[data-ai-context-tray]');
  contextMeterEl = root.querySelector('[data-ai-context-meter]');
  inputEl = root.querySelector('[data-ai-input]');
  inputShellEl = root.querySelector('[data-ai-input-shell]');
  sendBtn = root.querySelector('[data-ai-send]');
  settingsPanel = root.querySelector('[data-ai-settings-panel]');

  root.querySelector('[data-ai-settings]')?.addEventListener('click', () => {
    if (settingsOpen) {
      closeAiSettings();
    } else {
      openAiSettings();
    }
  });

  root.querySelector('[data-ai-clear]')?.addEventListener('click', () => {
    sessionGeneration++;
    currentSessionId = '';
    creatingSession = null;
    sessionSaveRequested = false;

    clearTimeout(sessionSaveTimer);

    conversation = [];
    activeContextItems = [];

    streamingReasoning = '';
    chatTaint = createTaintTracker();
    externalSourceWriteAllowAll = false;
    conversationLoadout = null;

    clearTransientConversation();

    renderMessages();
    renderContextTray();
    renderContextMeter();
  });

  root.querySelector('[data-ai-close]')?.addEventListener('click', () => {
    if (settingsOpen) {
      closeAiSettings();
      return;
    }

    closeAssistant();
  });

  root.querySelector('[data-ai-detach]')?.addEventListener('click', () => {
    if (mode === 'floating') {
      openAssistantPane();
    } else {
      openAssistantFloating();
    }
  });

  sendBtn?.addEventListener('click', () => {
    if (assistantBusy && abortController) {
      try { abortController.abort(); } catch {}
      return;
    }
    sendCurrentInput();
  });

  root.querySelector('[data-ai-add-context]')?.addEventListener('click', () => {
    openAiContextPicker({
      onPickRefs: addAiContextRefs,
      onPickFiles: addAiContextFiles,
    });
  });

  root.addEventListener('dragover', (e) => {
    const hasFiles = [...(e.dataTransfer?.types || [])].includes('Files');

    if (!dataTransferHasAiContext(e.dataTransfer) && !hasFiles) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    root.classList.add('is-ai-context-dragover');
  });

  root.addEventListener('dragleave', (e) => {
    if (root.contains(e.relatedTarget)) return;
    root.classList.remove('is-ai-context-dragover');
  });

  root.addEventListener('drop', async (e) => {
    const hasFiles = [...(e.dataTransfer?.types || [])].includes('Files');

    if (!dataTransferHasAiContext(e.dataTransfer) && !hasFiles) return;

    e.preventDefault();
    e.stopPropagation();

    root.classList.remove('is-ai-context-dragover');

    const refs = readAiContextDragData(e.dataTransfer);

    if (refs.length) {
      await addAiContextRefs(refs);
      return;
    }

    const files = [...(e.dataTransfer.files || [])];

    if (files.length) {
      await addAiContextFiles(files);
    }
  });

  window.addEventListener('yanta-ai-add-context-refs', async (e) => {
    const refs = Array.isArray(e.detail?.refs) ? e.detail.refs : [];
    if (refs.length) await addAiContextRefs(refs);
  });

  window.addEventListener('yanta-open-ai-session', async (e) => {
    const sessionId = e.detail?.sessionId;
    if (!sessionId) return;

    await openAiSession(sessionId);
  });

  window.addEventListener('yanta-ai-context-drag-position', (e) => {
    if (!root) return;

    const over = !!e.detail?.over;

    root.classList.toggle('is-ai-context-dragover', over);
  });

  window.addEventListener('yanta-ai-context-drag-end', () => {
    root?.classList.remove('is-ai-context-dragover');
  });

  root.addEventListener('click', (e) => {
    handleAiMessageClick(e).catch((err) => {
      console.error(err);
      toast(t('ai.chat.toast.actionFailed'), 'error');
    });
  });

  inputEl?.addEventListener('input', () => {
    autoResizeInput();
    updateSendButtonState();
  });

  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendCurrentInput();
    }
  });

  renderMessages();
  updateCloseButton();
  updateSendButtonState();

  return root;
}

function updateModeButton() {
  const btn = root?.querySelector('[data-ai-detach]');
  if (!btn) return;

  if (mode === 'floating') {
    btn.title = t('ai.chat.header.dock');
    btn.innerHTML = lucide('panel-right', 16);
  } else {
    btn.title = t('ai.chat.header.detach');
    btn.innerHTML = lucide('picture-in-picture-2', 16);
  }
}

function updateCloseButton() {
  const btn = root?.querySelector('[data-ai-close]');
  if (!btn) return;

  if (settingsOpen) {
    btn.title = t('ai.chat.header.backToChat');
    btn.setAttribute('aria-label', t('ai.chat.header.backToChat'));
    btn.innerHTML = lucide('arrow-left', 16);
  } else {
    btn.title = t('ai.chat.header.close');
    btn.setAttribute('aria-label', t('ai.chat.header.close'));
    btn.innerHTML = lucide('x', 16);
  }
}

function createFloatingShell() {
  if (floatingShell) return floatingShell;

  floatingShell = document.createElement('div');
  floatingShell.className = 'yanta-ai-floating';
  floatingShell.hidden = true;
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS value
  floatingShell.style.left = 'calc(100vw - 700px)';
  floatingShell.style.top = '84px';

  floatingShell.innerHTML = `
    <div class="yanta-ai-floating-body" data-ai-floating-body></div>
  `;

  document.body.append(floatingShell);
  floatingBody = floatingShell.querySelector('[data-ai-floating-body]');

  bindFloatingDrag();

  return floatingShell;
}

function bindFloatingDrag() {
  if (!floatingShell || floatingShell.dataset.dragBound === '1') return;

  floatingShell.dataset.dragBound = '1';

  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  function clampPosition(left, top) {
    const r = floatingShell.getBoundingClientRect();
    const margin = 8;

    return {
      left: Math.max(margin, Math.min(window.innerWidth - r.width - margin, left)),
      top: Math.max(margin, Math.min(window.innerHeight - r.height - margin, top)),
    };
  }

  function onMove(e) {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    e.preventDefault();

    const next = clampPosition(
      startLeft + e.clientX - startX,
      startTop + e.clientY - startY
    );

    floatingShell.style.left = `${next.left}px`;
    floatingShell.style.top = `${next.top}px`;
  }

  function onUp(e) {
    if (pointerId != null && e.pointerId !== pointerId) return;

    dragging = false;
    pointerId = null;
    floatingShell.classList.remove('is-dragging');

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
  }

  floatingShell.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest?.('[data-ai-drag-handle]');
    if (!handle) return;

    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS selector
    if (e.target.closest?.('button, input, textarea, select')) return;
    if (e.button != null && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    const r = floatingShell.getBoundingClientRect();

    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = r.left;
    startTop = r.top;

    floatingShell.classList.add('is-dragging');

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }, true);
}

async function withAiViewTransition(mutator) {
  const node = ensureRoot();

  if (!supportsViewTransition()) {
    mutator();
    return;
  }

  node.style.viewTransitionName = VT_NAME;
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS value
  node.style.contain = 'layout paint';

  try {
    const vt = document.startViewTransition(() => {
      mutator();
    });

    await Promise.allSettled([
      vt.ready,
      vt.updateCallbackDone,
      vt.finished,
    ].filter(Boolean));
  } catch {
    mutator();
  } finally {
    node.style.viewTransitionName = '';
    node.style.contain = '';
  }
}

export async function openAssistantPane() {
  if (shouldOpenAssistantFloatingInsteadOfPane()) {
    return openAssistantFloating();
  }
  ensureRoot();

  await withAiViewTransition(() => {
    floatingShell?.classList.remove('active');
    if (floatingShell) floatingShell.hidden = true;

    const body = openSidePane({
      kind: 'ai',
      title: t('ai.chat.paneTitle'),
      icon: 'sparkles',
      className: 'yanta-ai-side-pane',
      onClose: () => {
        if (mode === 'pane') {
          root?.remove();
        }
      },
    });

    if (!body) return;

    body.replaceChildren(root);
    mode = 'pane';
    updateModeButton();
  });

  renderSettings();
  renderMessages();

  setTimeout(() => inputEl?.focus(), 0);
}

export async function openAssistantFloating({
  fromHistory = false,
} = {}) {
  ensureRoot();
  createFloatingShell();
  registerAiOverlayRoute();

  const wasClosed = !aiFullscreenOverlayIsOpen();

  await withAiViewTransition(() => {
    if (isSidePaneOpen('ai')) {
      closeSidePane({ silent: true });
    }

    floatingShell.hidden = false;
    floatingShell.classList.add('active');
    floatingBody.replaceChildren(root);

    mode = 'floating';
    updateModeButton();
  });

  renderSettings();
  renderMessages();

  if (
    isMobileAssistantViewport() &&
    !fromHistory &&
    wasClosed
  ) {
    pushOverlayState(AI_FULLSCREEN_OVERLAY_ID);
  }

  setTimeout(() => inputEl?.focus(), 0);
}

export function openAssistant() {
  return openAssistantSmart();
}

function closeAssistantUI() {
  if (abortController) {
    try {
      abortController.abort();
    } catch {}
  }

  if (mode === 'pane') {
    closeSidePane();
    return;
  }

  if (floatingShell) {
    floatingShell.hidden = true;
    floatingShell.classList.remove('active');
  }
}

export function closeAssistant({
  fromHistory = false,
} = {}) {
  if (!fromHistory && aiFullscreenOverlayIsOpen()) {
    closeTopOverlay(() => {
      closeAssistantUI();
    });

    return;
  }

  closeAssistantUI();
}

function snapshotMessagesForSessionSave() {
  return conversation.map((msg) => ({
    ...msg,
    content: String(msg.content || ''),
    ts: Number(msg.ts || Date.now()),
  }));
}

function snapshotContextItemsForSessionSave() {
  return activeContextItems.map((item) => ({
    ...item,
    stats: {
      ...(item.stats || {}),
    },
    meta: {
      ...(item.meta || {}),
    },
  }));
}

function effectiveSessionModelLabel() {
  const runtime = getEffectiveAiRuntimeSettings();

  return (
    runtime.includedModel ||
    runtime.model ||
    getAiSettings().model ||
    ''
  );
}

async function ensureCurrentSessionForSave({
  generation,
  messages,
  contextItems,
  model,
} = {}) {
  if (currentSessionId) {
    return currentSessionId;
  }

  if (
    !creatingSession ||
    creatingSession.generation !== generation
  ) {
    creatingSession = {
      generation,
      promise: createAiSession({
        messages,
        contextItems,
        model,
      }),
    };
  }

  try {
    const id = await creatingSession.promise;

    // The visible chat was replaced while creation was in flight.
    // Do not attach the old newly-created session to the new chat.
    if (generation !== sessionGeneration) {
      return '';
    }

    currentSessionId = id;

    return currentSessionId;
  } finally {
    if (creatingSession?.generation === generation) {
      creatingSession = null;
    }
  }
}

async function saveCurrentAiSessionOnce() {
  const generation = sessionGeneration;

  const messages = snapshotMessagesForSessionSave();
  const contextItems = snapshotContextItemsForSessionSave();

  if (!messages.length && !contextItems.length) return;

  const model = effectiveSessionModelLabel();

  const sessionId = await ensureCurrentSessionForSave({
    generation,
    messages,
    contextItems,
    model,
  });

  if (!sessionId) return;
  if (generation !== sessionGeneration) return;

  await saveAiSession(sessionId, {
    messages,
    contextItems,
    model,
  });
}

async function saveCurrentAiSessionQueued() {
  if (sessionSavePromise) {
    sessionSaveRequested = true;
    return sessionSavePromise;
  }

  sessionSavePromise = (async () => {
    do {
      sessionSaveRequested = false;
      await saveCurrentAiSessionOnce();
    } while (sessionSaveRequested);
  })().finally(() => {
    sessionSavePromise = null;
  });

  return sessionSavePromise;
}

function scheduleAiSessionSave() {
  clearTimeout(sessionSaveTimer);

  sessionSaveTimer = window.setTimeout(() => {
    saveCurrentAiSessionQueued().catch((err) => {
      // eslint-disable-next-line yanta/no-untranslated-literal -- console
      console.warn('[YANTA AI] session save failed', err);
    });
  }, 700);
}

async function openAiSession(sessionId) {
  if (assistantBusy && abortController) {
    try {
      abortController.abort();
    } catch {}
  }

  const session = await loadAiSession(sessionId);

  sessionGeneration++;
  creatingSession = null;
  sessionSaveRequested = false;

  clearTimeout(sessionSaveTimer);

  currentSessionId = session.id;
  conversation = Array.isArray(session.messages) ? session.messages : [];
  pinChatToBottom = true;
  activeContextItems = Array.isArray(session.contextItems) ? session.contextItems : [];

  saveTransientConversation();

  await openAssistantSmart();

  renderMessages();
  renderContextTray();
  renderContextMeter();

  toast(t('ai.chat.toast.sessionOpened'), 'success');
}

async function addAiContextRefs(refs = []) {
  const items = await createAiContextItemsFromRefs(refs);

  activeContextItems = mergeContextItems(activeContextItems, items);

  renderContextTray();
  scheduleAiSessionSave();

  const totals = aiContextTotals(items);
  toast(
    `${t('ai.chat.context.addedItems', { count: items.length })} · ${t('ai.chat.context.words', { count: totals.words })}`,
    'success'
  );
}

async function addAiContextFiles(files = []) {
  const items = await createAiContextItemsFromFiles(files);

  activeContextItems = mergeContextItems(activeContextItems, items);

  renderContextTray();
  scheduleAiSessionSave();

  const totals = aiContextTotals(items);
  toast(
    `${t('ai.chat.context.addedUploads', { count: items.length })} · ${t('ai.chat.context.words', { count: totals.words })}`,
    'success'
  );
}

function mergeContextItems(existing = [], incoming = []) {
  const out = [...existing];
  const seen = new Set(
    existing.map((item) => [
      item.kind,
      item.sourceId,
      item.title,
      item.mime,
    ].join('|'))
  );

  for (const item of incoming) {
    const key = [
      item.kind,
      item.sourceId,
      item.title,
      item.mime,
    ].join('|');

    if (seen.has(key)) continue;

    seen.add(key);
    out.push(item);
  }

  return out;
}

function removeAiContextItem(id) {
  activeContextItems = activeContextItems.filter((item) => item.id !== id);
  renderContextTray();
  scheduleAiSessionSave();
}

function clearAiContextItems() {
  activeContextItems = [];
  renderContextTray();
  scheduleAiSessionSave();
}

function renderContextMeter() {
  if (!contextMeterEl) return;

  const stats = computeAiContextMeterStats({
    messages: conversation,
    contextItems: activeContextItems,
  });

  const hasAnything =
    stats.history.messages > 0 ||
    stats.context.items > 0 ||
    stats.total.chars > 0 ||
    stats.total.images > 0 ||
    stats.total.audio > 0;

  contextMeterEl.hidden = !hasAnything;

  if (!hasAnything) {
    contextMeterEl.textContent = '';
    contextMeterEl.removeAttribute('title');
    return;
  }

  contextMeterEl.textContent = formatAiContextMeterStats(stats);
  contextMeterEl.title = aiContextMeterTitle(stats);
}

function renderContextTray() {
  if (!contextTrayEl) return;

  renderContextMeter();

  const totals = aiContextTotals(activeContextItems);

  contextTrayEl.hidden = !activeContextItems.length;
  contextTrayEl.replaceChildren();

  if (!activeContextItems.length) return;

  const head = document.createElement('div');
  head.className = 'yanta-ai-context-tray-head';

  const nonMultimodalImages =
    totals.images > 0 && !modelSupportsImages(getEffectiveAiRuntimeSettings().model);

  const mediaBits = [
    totals.images ? t('ai.chat.context.images', { count: totals.images }) : '',
    totals.audio ? t('ai.chat.context.audio', { count: totals.audio }) : '',
  ].filter(Boolean);

  head.innerHTML = `
    <span>
      ${lucide('paperclip', 13)}
      ${escapeHtml(t('ai.chat.context.items', { count: totals.items }))}
      · ${escapeHtml(t('ai.chat.context.words', { count: totals.words }))}
      · ${escapeHtml(t('ai.chat.context.chars', { count: totals.chars }))}
      ${mediaBits.length ? ` · ${escapeHtml(mediaBits.join(' · '))}` : ''}
    </span>

    <button type="button" class="yanta-ai-context-clear" data-ai-clear-context>
      ${escapeHtml(t('ai.chat.context.clear'))}
    </button>
  `;

  contextTrayEl.append(head);

  if (nonMultimodalImages) {
    const warn = document.createElement('div');
    warn.className = 'yanta-ai-context-warning';
    warn.textContent = t('ai.chat.context.imagesWarning');
    contextTrayEl.append(warn);
  }

  const list = document.createElement('div');
  list.className = 'yanta-ai-context-list';

  for (const item of activeContextItems) {
    const row = document.createElement('div');
    row.className = `yanta-ai-context-chip ${item.error ? 'is-error' : ''} ${item.meta?.unsupported ? 'is-warn' : ''}`;
    row.dataset.contextItemId = item.id;

    const icon =
      item.kind === 'folder'
        ? 'folder'
        : item.kind === 'event'
          ? 'calendar-days'
          : item.kind === 'image'
            ? 'image'
            : item.kind === 'pdf'
              ? 'file-type'
              : 'file-text';

    row.innerHTML = `
      <span class="yanta-ai-context-chip-icon">${lucide(icon, 13)}</span>

      <span class="yanta-ai-context-chip-main">
        <strong>${escapeHtml(item.title || t('ai.chat.context.untitledItem'))}</strong>
        <small>${escapeHtml(contextItemStatsLabel(item))}</small>
      </span>

      <button type="button" class="icon-btn" data-ai-remove-context="${escapeHtml(item.id)}" title="${escapeHtml(t('ai.chat.context.remove'))}">
        ${lucide('x', 13)}
      </button>
    `;

    list.append(row);
  }

  contextTrayEl.append(list);

  contextTrayEl.querySelector('[data-ai-clear-context]')?.addEventListener('click', clearAiContextItems);

  contextTrayEl.querySelectorAll('[data-ai-remove-context]').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeAiContextItem(btn.dataset.aiRemoveContext);
    });
  });
}

function contextItemStatsLabel(item) {
  const base = formatContextStats(item.stats || {});

  if (item.kind === 'folder') {
    const count =
      Array.isArray(item.meta?.includedNoteIds)
        ? item.meta.includedNoteIds.length
        : Number(item.meta?.includedNoteCount || 0);

    if (count > 0) {
      return `${t('ai.chat.context.notes', { count })} · ${base}`;
    }
  }

  return base;
}

function addMessage(role, content, extra = {}) {
  // Sending something always brings the conversation into view.
  if (role === 'user') pinChatToBottom = true;

  conversation.push({
    role,
    content: String(content || ''),
    ts: Date.now(),
    ...extra,
  });

  saveTransientConversation();
  scheduleAiSessionSave();

  renderMessages();
  renderContextMeter();
}

/**
 * Drops a Pulse result into the assistant conversation. Used by routines
 * that declare `output: [chat]` — the AI reporting its own background
 * work belongs on the AI surface, not in a system notification.
 *
 * Safe to call with the pane closed: addMessage persists first and
 * renderMessages() no-ops until the DOM exists.
 */
export function postAssistantNotice({
  title = '',
  body = '',
  routineName = '',
  routineTitle = '',
} = {}) {
  const heading = title ? `**${title}**` : '';
  const source = routineName
    ? `\n\n<sub>${routineTitle || routineName} · YANTA Pulse</sub>`
    : '';

  addMessage('assistant', [heading, body].filter(Boolean).join('\n\n') + source, {
    // eslint-disable-next-line yanta/no-untranslated-literal -- product name
    model: 'YANTA Pulse',
    pulseRoutine: routineName || null,
  });
}

let streamRenderRaf = 0;

function scheduleStreamRender() {
  if (streamRenderRaf) return;

  streamRenderRaf = requestAnimationFrame(() => {
    streamRenderRaf = 0;
    saveTransientConversation();
    renderMessages();
    renderContextMeter();
  });
}

function pushAssistantStreamMessage(extra = {}) {
  const msg = {
    role: 'assistant',
    content: '',
    reasoning: '',
    ts: Date.now(),
    model: getAiSettings().model,
    ...extra,
  };

  conversation.push(msg);
  saveTransientConversation();
  scheduleAiSessionSave();
  renderMessages();

  return msg;
}

function removeConversationMessageObject(target) {
  const idx = conversation.indexOf(target);

  if (idx >= 0) {
    conversation.splice(idx, 1);
    saveTransientConversation();
    scheduleAiSessionSave();
    renderMessages();
  }
}

function finalizeAssistantStreamMessage(msg) {
  if (!msg) return;

  msg.content = String(msg.content || '').trim() || t('ai.chat.noResponse');
  msg.reasoning = String(msg.reasoning || '').trim();

  saveTransientConversation();
  scheduleAiSessionSave();
  renderMessages();
  renderContextMeter();
}

function setAssistantBusy(next, label = '') {
  assistantBusy = !!next;
  assistantBusyLabel = String(label || t('ai.chat.busy.thinking'));

  if (assistantBusy && !assistantBusySince) {
    assistantBusySince = Date.now();
  }

  if (!assistantBusy) {
    assistantBusySince = 0;
  }

  renderMessages();
}

let workingNodeEl = null;

/** The "Thinking… / Responding…" row: one element, updated in place. */
function updateAssistantWorkingNode() {
  const reasoning = String(streamingReasoning || '').trim();

  if (!workingNodeEl) {
    workingNodeEl = document.createElement('div');
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    workingNodeEl.className = 'yanta-ai-msg assistant yanta-ai-working-msg';
    workingNodeEl.innerHTML = `
      <div class="yanta-ai-msg-role"></div>
      <div class="yanta-ai-working">
        <span class="yanta-ai-spinner"></span>
        <span class="yanta-ai-working-text"></span>
        <span class="yanta-ai-working-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      </div>
      <details class="yanta-ai-working-thinking" hidden>
        <summary>${lucide('brain-circuit', 12)}<span>${escapeHtml(t('ai.chat.reasoning.label'))}</span></summary>
        <pre></pre>
      </details>
      <div class="yanta-ai-working-bar"><span></span></div>
    `;
  }

  const set = (sel, text) => {
    const n = workingNodeEl.querySelector(sel);
    if (n.textContent !== text) n.textContent = text;
  };

  set('.yanta-ai-msg-role', `YANTA AI · ${getEffectiveAiRuntimeSettings().model || getAiSettings().model || 'LLM'}`);
  set('.yanta-ai-working-text', assistantBusyLabel || t('ai.chat.busy.thinking'));

  const thinking = workingNodeEl.querySelector('.yanta-ai-working-thinking');
  thinking.hidden = !reasoning;
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS selector
  if (reasoning) set('.yanta-ai-working-thinking pre', reasoning);

  return workingNodeEl;
}


function safeJsonForTool(content) {
  try {
    return JSON.parse(String(content || ''));
  } catch {
    return null;
  }
}

function toolResultIsError(data) {
  if (!data) return false;

  if (data.error) return true;
  if (data.success === false) return true;
  if (data.ok === false) return true;

  return false;
}

function toolResultCount(data) {
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.events)) return data.events.length;
  if (Array.isArray(data?.notes)) return data.notes.length;
  if (Array.isArray(data?.folders)) return data.folders.length;
  if (Array.isArray(data?.results)) return data.results.length;
  if (typeof data?.count === 'number') return data.count;
  return null;
}

function toolDisplayName(name) {
  const map = {
    search_notes: t('ai.chat.tool.name.searchNotes'),
    read_note: t('ai.chat.tool.name.readNote'),
    read_notes: t('ai.chat.tool.name.readNotes'),
    create_note: t('ai.chat.tool.name.createNote'),
    create_drawing_note: t('ai.chat.tool.name.createDrawingNote'),
    update_drawing: t('ai.chat.tool.name.updateDrawing'),
    update_note_appearance: t('ai.chat.tool.name.updateNoteAppearance'),
    append_to_note: t('ai.chat.tool.name.appendToNote'),
    replace_in_note: t('ai.chat.tool.name.replaceInNote'),
    replace_current_selection: t('ai.chat.tool.name.replaceCurrentSelection'),
    delete_note: t('ai.chat.tool.name.deleteNote'),

    search_events: t('ai.chat.tool.name.searchEvents'),
    create_event: t('ai.chat.tool.name.createEvent'),
    update_event: t('ai.chat.tool.name.updateEvent'),
    update_event_appearance: t('ai.chat.tool.name.updateEventAppearance'),
    link_event_to_note: t('ai.chat.tool.name.linkEventToNote'),

    add_rss_source: t('ai.chat.tool.name.addRssSource'),

    ai_brain_list: t('ai.chat.tool.name.aiBrainList'),
    ai_brain_read: t('ai.chat.tool.name.aiBrainRead'),
    ai_brain_search: t('ai.chat.tool.name.aiBrainSearch'),
    ai_brain_write: t('ai.chat.tool.name.aiBrainWrite'),

    get_weather: t('ai.chat.tool.name.getWeather'),
    web_search: t('ai.chat.tool.name.webSearch'),
    web_read: t('ai.chat.tool.name.webRead'),

    create_excalidraw_slideshow: t('ai.chat.tool.name.createExcalidrawSlideshow'),
    update_excalidraw_slideshow: t('ai.chat.tool.name.updateExcalidrawSlideshow'),
    read_excalidraw_drawing_json: t('ai.chat.tool.name.readExcalidrawDrawingJson'),
    validate_excalidraw_slideshow_json: t('ai.chat.tool.name.validateExcalidrawSlideshowJson'),

    skills_list: t('ai.chat.tool.name.skillsList'),
    skill_view: t('ai.chat.tool.name.skillView'),
    skill_manage: t('ai.chat.tool.name.skillManage'),

    chat_find_contact: t('ai.chat.tool.name.chatFindContact'),
    chat_list_rooms: t('ai.chat.tool.name.chatListRooms'),
    chat_read_recent_messages: t('ai.chat.tool.name.chatReadRecentMessages'),
    chat_search_messages: t('ai.chat.tool.name.chatSearchMessages'),
    chat_send_message: t('ai.chat.tool.name.chatSendMessage'),

  };

  return map[name] || name || t('ai.chat.tool.name.fallback');
}

function summarizeToolResult(name, data, rawContent = '') {
  if (!data) {
    const text = String(rawContent || '').trim();

    return text
      ? text.slice(0, 160)
      : t('ai.chat.tool.result.noStructured');
  }

  if (toolResultIsError(data)) {
    return data.error || data.message || t('ai.chat.tool.result.failed');
  }

  if (name === 'chat_find_contact' || name === 'chat_list_rooms') {
    const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
    return t('ai.chat.tool.result.chatRoomsFound', { count: rooms.length });
  }

  if (name === 'chat_read_recent_messages') {
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const roomName = data?.roomName || data?.roomId || t('ai.chat.tool.result.chatFallback');
    return t('ai.chat.tool.result.chatMessagesRead', { count: messages.length, room: roomName });
  }

  if (name === 'chat_search_messages') {
    const results = Array.isArray(data?.results) ? data.results : [];
    return t('ai.chat.tool.result.chatSearchFound', { count: results.length, query: data?.query || '' });
  }

  if (name === 'chat_send_message') {
    if (data.cancelled) return t('ai.chat.tool.result.chatSendCancelled');
    if (data.ok) {
      return data.autonomous
        ? t('ai.chat.tool.result.chatSentAuto')
        : t('ai.chat.tool.result.chatSent');
    }

    return t('ai.chat.tool.result.chatNotSent');
  }

  if (name === 'search_events') {
    const events = Array.isArray(data) ? data : data.events || [];
    const range = data?.range;

    const rangeText = range?.start && range?.end
      ? ` · ${formatToolDate(range.start)} – ${formatToolDate(range.end)}`
      : '';

    return t('ai.chat.tool.result.eventsFound', { count: events.length, range: rangeText });
  }

  if (name === 'search_notes') {
    const notes = Array.isArray(data) ? data : data.notes || data.results || [];
    return t('ai.chat.tool.result.notesFound', { count: notes.length });
  }

  if (name === 'read_note') {
    return t('ai.chat.tool.result.noteRead', { title: data.title || data.id || t('ai.chat.common.untitled') });
  }

  if (name === 'read_notes') {
    const count = Array.isArray(data) ? data.length : toolResultCount(data);
    return t('ai.chat.tool.result.notesRead', { count: count || 0 });
  }

  if (name === 'create_note') {
    return t('ai.chat.tool.result.noteCreated', { title: data.title || data.id || t('ai.chat.common.untitled') });
  }

  if (name === 'update_note_appearance') {
    const note = data.note || data;
    return t('ai.chat.tool.result.noteAppearanceUpdated', { title: note.title || note.id || t('ai.chat.common.untitled') });
  }

  if (name === 'append_to_note') {
    return t('ai.chat.tool.result.noteAppended', { count: Number(data.appendedChars || 0) });
  }

  if (name === 'replace_in_note') {
    return data.ok === false
      ? (data.error || t('ai.chat.tool.result.textNotFound'))
      : t('ai.chat.tool.result.passagesReplaced', { count: Number(data.replaced || 0) });
  }

  if (name === 'replace_current_selection') {
    return t('ai.chat.tool.result.selectionReplaced', { count: Number(data.insertedChars || 0) });
  }

  if (name === 'delete_note') {
    return t('ai.chat.tool.result.noteTrashed', { title: data.title || data.trashedNoteId || t('ai.chat.common.untitled') });
  }

  if (name === 'create_drawing_note') {
    const title = data.note?.title || t('ai.chat.tool.result.drawingFallback');
    return data.source === 'mermaid'
      ? (data.editable
        ? t('ai.chat.tool.result.drawingMermaidEditable', { title })
        : t('ai.chat.tool.result.drawingMermaidImage', { title }))
      : t('ai.chat.tool.result.drawingSvg', { title });
  }

  if (name === 'update_drawing') {
    const count = Number(data.elementCount || 0);
    return data.mode === 'replace'
      ? t('ai.chat.tool.result.drawingReplaced', { count })
      : t('ai.chat.tool.result.drawingUpdated', { count });
  }

  if (name === 'create_event') {
    return t('ai.chat.tool.result.eventCreated', { title: data.title || data.id || t('ai.chat.common.untitledEvent') });
  }

  if (name === 'update_event') {
    return t('ai.chat.tool.result.eventUpdated', { title: data.title || data.id || t('ai.chat.common.untitledEvent') });
  }

  if (name === 'update_event_appearance') {
    const ev = data.event || data;
    const title = ev.title || ev.id || t('ai.chat.common.untitledEvent');

    return data.linkedNoteUpdated
      ? t('ai.chat.tool.result.eventAppearanceUpdatedLinked', { title })
      : t('ai.chat.tool.result.eventAppearanceUpdated', { title });
  }

  if (name === 'link_event_to_note') {
    return data.ok
      ? t('ai.chat.tool.result.eventLinked')
      : t('ai.chat.tool.result.eventLinkFailed');
  }

  if (name === 'ai_brain_write') {
    return t('ai.chat.tool.result.brainUpdated', { title: data.title || data.id || t('ai.chat.common.untitled') });
  }

  if (name === 'ai_brain_search') {
    const count = Array.isArray(data) ? data.length : toolResultCount(data);
    return t('ai.chat.tool.result.brainFound', { count: count || 0 });
  }

  if (name === 'ai_brain_list') {
    const noteCount = data.notes?.length || 0;
    const folderCount = data.folders?.length || 0;
    return t('ai.chat.tool.result.brainContents', {
      notes: t('ai.chat.context.notes', { count: noteCount }),
      folders: t('ai.chat.tool.result.folders', { count: folderCount }),
    });
  }

  if (name === 'get_weather') {
    const location = data.location?.label || t('ai.chat.tool.result.weatherLocationFallback');
    const temp = data.current?.temperatureC;
    const weather = data.current?.weather || t('ai.chat.tool.name.getWeather');

    return temp != null
      ? t('ai.chat.tool.result.weatherWithTemp', { weather, location, temp })
      : t('ai.chat.tool.result.weather', { weather, location });
  }

  if (name === 'web_search') {
    const results = Array.isArray(data?.results) ? data.results : [];
    return t('ai.chat.tool.result.webFound', { count: results.length, query: data?.query || '' });
  }

  if (name === 'web_read') {
    const title = data?.title || data?.url || t('ai.chat.tool.result.webPageFallback');
    const chars = Number(data?.textChars || String(data?.text || '').length || 0);

    return chars
      ? t('ai.chat.tool.result.webReadChars', { title, chars })
      : t('ai.chat.tool.result.webRead', { title });
  }

  if (name === 'add_rss_source') {
    const source = data?.source || data?.feed || data;

    return source?.title || source?.feedUrl
      ? t('ai.chat.tool.result.sourceAddedNamed', { title: source.title || source.feedUrl })
      : data?.message || t('ai.chat.tool.result.sourceAdded');
  }

  const count = toolResultCount(data);

  if (count != null) {
    return t('ai.chat.tool.result.count', { count });
  }

  if (data.ok === true) return t('ai.chat.tool.result.success');
  if (data.success === true) return t('ai.chat.tool.result.success');

  return t('ai.chat.tool.result.completed');
}

function formatToolDate(value) {
  if (!value) return '';

  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    return d.toLocaleDateString([], {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function formatToolDateTime(value, allDay = false) {
  if (!value) return '';

  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    if (allDay) {
      return d.toLocaleDateString([], {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }

    return d.toLocaleString([], {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

// Which activity groups the user opened, so re-renders keep them open.
const openToolActivity = new Set();

// Tool name → key under ai.chat.tool.verb (the activity line's wording).
const TOOL_VERBS = {
  search_notes: 'searchNotes',
  semantic_search_notes: 'semanticSearchNotes',
  read_note: 'readNote',
  read_notes: 'readNotes',
  create_note: 'createNote',
  append_to_note: 'appendToNote',
  replace_in_note: 'replaceInNote',
  delete_note: 'deleteNote',
  web_search: 'webSearch',
  web_read: 'webRead',
  search_events: 'searchEvents',
  create_event: 'createEvent',
  update_event: 'updateEvent',
  rss_search_items: 'rssSearchItems',
  rss_read_item: 'rssReadItem',
  tools_load: 'toolsLoad',
  skill_view: 'skillView',
  skills_list: 'skillsList',
};

function renderToolActivityNode(run) {
  const key = String(run[0]?.ts || '');
  const errors = run.filter((m) => toolResultIsError(safeJsonForTool(m.content)?.result ?? safeJsonForTool(m.content))).length;

  const labels = [];
  for (const m of run) {
    if (m.toolName === 'tools_load') continue;
    const label = TOOL_VERBS[m.toolName]
      ? t(`ai.chat.tool.verb.${TOOL_VERBS[m.toolName]}`)
      : toolDisplayName(m.toolName);
    if (!labels.includes(label)) labels.push(label);
  }
  if (!labels.length) labels.push(t('ai.chat.tool.verb.toolsLoad'));

  const details = document.createElement('details');
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
  details.className = `yanta-ai-msg tool yanta-ai-activity${errors ? ' has-error' : ''}`;
  details.open = openToolActivity.has(key);
  details.addEventListener('toggle', () => {
    if (details.open) openToolActivity.add(key);
    else openToolActivity.delete(key);
  });

  const summary = document.createElement('summary');
  summary.innerHTML = `
    <span class="yanta-ai-activity-icon">${lucide(errors ? 'triangle-alert' : 'sparkles', 13)}</span>
    <span class="yanta-ai-activity-text">${escapeHtml(labels.slice(0, 3).join(' · '))}${labels.length > 3 ? ` · +${labels.length - 3}` : ''}</span>
    ${errors ? `<span class="yanta-ai-activity-err">${escapeHtml(t('ai.chat.tool.activity.failed', { count: errors }))}</span>` : ''}
    <span class="yanta-ai-activity-count">${escapeHtml(t('ai.chat.tool.activity.steps', { count: run.length }))}</span>
    ${lucide('chevron-down', 12)}
  `;
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'yanta-ai-activity-body';
  for (const m of run) body.append(renderToolMessageNode(m));
  details.append(body);

  return details;
}

function renderToolMessageNode(msg) {
  const rawData = safeJsonForTool(msg.content);
  const data =
    rawData &&
    typeof rawData === 'object' &&
    Object.prototype.hasOwnProperty.call(rawData, 'result')
      ? rawData.result
      : rawData;

  const args =
    rawData &&
    typeof rawData === 'object' &&
    Object.prototype.hasOwnProperty.call(rawData, 'args')
      ? rawData.args
      : null;

  const isError = toolResultIsError(data);
  const name = msg.toolName || '';

  const wrap = document.createElement('div');
  wrap.className = `yanta-ai-tool-box ${isError ? 'is-error' : 'is-ok'}`;

  const summary = summarizeToolResult(name, data, msg.content);

  wrap.innerHTML = `
    <div class="yanta-ai-tool-head">
      <span class="yanta-ai-tool-icon">
        ${lucide(isError ? 'triangle-alert' : 'wrench', 15)}
      </span>

      <span class="yanta-ai-tool-title">
        ${escapeHtml(toolDisplayName(name))}
      </span>

      <span class="yanta-ai-tool-status">
        ${escapeHtml(isError ? t('ai.chat.tool.status.failed') : t('ai.chat.tool.status.done'))}
      </span>
    </div>

    <div class="yanta-ai-tool-summary">
      ${escapeHtml(summary)}
    </div>
  `;

  const rich = renderToolRichContent(name, data);

  if (rich) {
    wrap.append(rich);
  }

  const details = document.createElement('details');
  details.className = 'yanta-ai-tool-details';

  const summaryEl = document.createElement('summary');
  summaryEl.textContent = t('ai.chat.tool.showRaw');

  const pre = document.createElement('pre');
  pre.textContent = rawData
    ? JSON.stringify(rawData, null, 2)
    : String(msg.content || '');

  details.append(summaryEl, pre);
  wrap.append(details);

  return wrap;
}

function renderToolRichContent(name, data) {
  if (name === 'web_search') {
    const results = Array.isArray(data?.results) ? data.results : [];

    if (!results.length) return null;

    const details = document.createElement('details');
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    details.className = 'yanta-ai-tool-expandable-results yanta-ai-web-results';

    const summary = document.createElement('summary');

    const chips = results.slice(0, 8).map((result) => `
      <span class="yanta-ai-result-chip" title="${escapeHtml(result.title || result.url || t('ai.chat.tool.resultFallback'))}">
        ${escapeHtml(result.title || result.url || t('ai.chat.tool.resultFallback'))}
      </span>
    `).join('');

    summary.innerHTML = `
      <span class="yanta-ai-results-summary-label">
        ${lucide('list-collapse', 13)}
        ${escapeHtml(t('ai.chat.tool.results', { count: results.length }))}
      </span>

      <span class="yanta-ai-result-chips">
        ${chips}
      </span>
    `;

    const list = document.createElement('div');
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    list.className = 'yanta-ai-tool-list yanta-ai-expanded-result-list';

    for (const result of results.slice(0, 10)) {
      const row = document.createElement('a');
      row.className = 'yanta-ai-tool-row';
      row.href = safeUrl(result.url) || '#';
      row.target = '_blank';
      // eslint-disable-next-line yanta/no-untranslated-literal -- link rel
      row.rel = 'noopener noreferrer';

      row.innerHTML = `
        <span class="yanta-ai-tool-row-icon">${lucide('globe', 14)}</span>
        <span class="yanta-ai-tool-row-main">
          <strong>${escapeHtml(result.title || result.url || t('ai.chat.tool.resultFallback'))}</strong>
          ${result.description ? `<small>${escapeHtml(result.description)}</small>` : ''}
          ${result.url ? `<em>${escapeHtml(result.url)}</em>` : ''}
        </span>
      `;

      list.append(row);
    }

    details.append(summary, list);

    return details;
  }

  if (name === 'web_read') {
    if (!data?.url) return null;

    const list = document.createElement('div');
    list.className = 'yanta-ai-tool-list';

    const row = document.createElement('a');
    row.className = 'yanta-ai-tool-row';
    row.href = safeUrl(data.url) || '#';
    row.target = '_blank';
    // eslint-disable-next-line yanta/no-untranslated-literal -- link rel
    row.rel = 'noopener noreferrer';

    row.innerHTML = `
      <span class="yanta-ai-tool-row-icon">${lucide('file-search', 14)}</span>
      <span class="yanta-ai-tool-row-main">
        <strong>${escapeHtml(data.title || t('ai.chat.tool.webPage'))}</strong>
        <small>${escapeHtml(String(data.excerpt || '').slice(0, 260))}</small>
        <em>${escapeHtml(data.url)}</em>
      </span>
    `;

    list.append(row);
    return list;
  }

  if (!data) return null;

  if (name === 'chat_find_contact' || name === 'chat_list_rooms') {
    const rooms = Array.isArray(data?.rooms) ? data.rooms : [];

    if (!rooms.length) return null;

    const list = document.createElement('div');
    list.className = 'yanta-ai-tool-list';

    for (const room of rooms.slice(0, 8)) {
      list.append(renderToolChatRoomRow(room));
    }

    if (rooms.length > 8) {
      const more = document.createElement('div');
      more.className = 'yanta-ai-tool-more';
      more.textContent = t('ai.chat.common.more', { count: rooms.length - 8 });
      list.append(more);
    }

    return list;
  }

  if (name === 'chat_read_recent_messages') {
    const messages = Array.isArray(data?.messages) ? data.messages : [];

    if (!messages.length) return null;

    const list = document.createElement('div');
    list.className = 'yanta-ai-tool-list';

    for (const msg of messages.slice(-8)) {
      list.append(renderToolChatMessageRow(msg, {
        roomId: data.roomId || '',
      }));
    }

    return list;
  }

  if (name === 'chat_search_messages') {
    const results = Array.isArray(data?.results) ? data.results : [];

    if (!results.length) return null;

    const list = document.createElement('div');
    list.className = 'yanta-ai-tool-list';

    for (const result of results.slice(0, 8)) {
      list.append(renderToolChatMessageRow(result, {
        roomId: result.roomId || data.roomId || '',
      }));
    }

    if (results.length > 8) {
      const more = document.createElement('div');
      more.className = 'yanta-ai-tool-more';
      more.textContent = t('ai.chat.common.more', { count: results.length - 8 });
      list.append(more);
    }

    return list;
  }

  if (name === 'chat_send_message') {
    const list = document.createElement('div');
    list.className = 'yanta-ai-tool-list';

    const row = document.createElement('div');
    row.className = 'yanta-ai-tool-row';

    row.innerHTML = `
      <span class="yanta-ai-tool-row-icon">
        ${lucide(data?.ok ? 'send-horizontal' : 'ban', 14)}
      </span>
      <span class="yanta-ai-tool-row-main">
        <strong>${escapeHtml(data?.ok ? t('ai.chat.tool.chat.sent') : data?.cancelled ? t('ai.chat.tool.chat.cancelled') : t('ai.chat.tool.chat.notSent'))}</strong>
        <small>
          ${data?.roomId ? escapeHtml(t('ai.chat.tool.chat.room', { room: data.roomId })) : ''}
          ${data?.autonomous ? ` · ${escapeHtml(t('ai.chat.tool.chat.autonomous'))}` : ''}
          ${data?.humanConfirmed ? ` · ${escapeHtml(t('ai.chat.tool.chat.confirmed'))}` : ''}
        </small>
        ${data?.eventId ? `<em>${escapeHtml(data.eventId)}</em>` : ''}
      </span>
    `;

    list.append(row);
    return list;
  }

  if (name === 'search_events') {
    const events = Array.isArray(data) ? data : data.events || [];

    if (!events.length) return null;

    const list = document.createElement('div');
    list.className = 'yanta-ai-tool-list';

    for (const ev of events.slice(0, 8)) {
      list.append(renderToolEventRow(ev));
    }

    if (events.length > 8) {
      const more = document.createElement('div');
      more.className = 'yanta-ai-tool-more';
      more.textContent = t('ai.chat.common.more', { count: events.length - 8 });
      list.append(more);
    }

    return list;
  }

  if (name === 'search_notes') {
    const notes = Array.isArray(data) ? data : data.notes || data.results || [];

    if (!notes.length) return null;

    const list = document.createElement('div');
    list.className = 'yanta-ai-tool-list';

    for (const note of notes.slice(0, 8)) {
      list.append(renderToolNoteRow(note));
    }

    if (notes.length > 8) {
      const more = document.createElement('div');
      more.className = 'yanta-ai-tool-more';
      more.textContent = t('ai.chat.common.more', { count: notes.length - 8 });
      list.append(more);
    }

    return list;
  }

  if (name === 'ai_brain_search') {
    const hits = Array.isArray(data) ? data : data.results || [];

    if (!hits.length) return null;

    const list = document.createElement('div');
    list.className = 'yanta-ai-tool-list';

    for (const hit of hits.slice(0, 6)) {
      list.append(renderToolBrainRow(hit));
    }

    return list;
  }

  if (name === 'add_rss_source') {
    const source = data?.source || data?.feed || data;

    if (!source) return null;

    const list = document.createElement('div');
    list.className = 'yanta-ai-tool-list';

    const row = document.createElement('a');
    row.className = 'yanta-ai-tool-row';
    row.href = safeUrl(source.siteUrl || source.feedUrl) || '#';
    row.target = '_blank';
    // eslint-disable-next-line yanta/no-untranslated-literal -- link rel
    row.rel = 'noopener noreferrer';

    row.innerHTML = `
      <span class="yanta-ai-tool-row-icon">${lucide(source.sourceKind === 'youtube' ? 'youtube' : 'rss', 14)}</span>
      <span class="yanta-ai-tool-row-main">
        <strong>${escapeHtml(source.title || t('ai.chat.tool.sourceFallback'))}</strong>
        ${source.description ? `<small>${escapeHtml(String(source.description).slice(0, 220))}</small>` : ''}
        ${source.feedUrl ? `<em>${escapeHtml(source.feedUrl)}</em>` : ''}
      </span>
    `;

    list.append(row);
    return list;
  }

  return null;
}

function renderToolChatRoomRow(room) {
  const row = document.createElement('div');
  row.className = 'yanta-ai-tool-row';

  const title = room.name || room.directUserId || room.roomId || t('ai.chat.tool.chat.fallback');
  const subtitle = [
    room.isDirect ? t('ai.chat.tool.chat.direct') : t('ai.chat.tool.chat.roomLabel'),
    room.unread ? t('ai.chat.tool.chat.unread', { count: Number(room.unread) }) : '',
    room.lastActive ? formatToolDateTime(room.lastActive) : '',
  ].filter(Boolean).join(' · ');

  row.innerHTML = `
    <span class="yanta-ai-tool-row-icon">
      ${lucide(room.isDirect ? 'user-round' : 'messages-square', 14)}
    </span>
    <span class="yanta-ai-tool-row-main">
      <strong>${escapeHtml(title)}</strong>
      ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}
      ${room.roomId ? `<em>${escapeHtml(room.roomId)}</em>` : ''}
      ${room.directUserId ? `<em>${escapeHtml(room.directUserId)}</em>` : ''}
    </span>
  `;

  return row;
}

function renderToolChatMessageRow(message, {
  roomId = '',
} = {}) {
  const row = document.createElement('div');
  row.className = 'yanta-ai-tool-row';

  const text = String(
    message.snippet ||
    message.body ||
    ''
  ).trim();

  const sender = message.sender || t('ai.chat.tool.chat.unknownSender');
  const when = message.ts ? formatToolDateTime(message.ts) : '';
  const targetRoomId = message.roomId || roomId || '';

  row.innerHTML = `
    <span class="yanta-ai-tool-row-icon">
      ${lucide(message.isAiGenerated ? 'sparkles' : 'message-circle', 14)}
    </span>
    <span class="yanta-ai-tool-row-main">
      <strong>${escapeHtml(sender)}</strong>
      ${when ? `<small>${escapeHtml(when)}</small>` : ''}
      ${text ? `<span>${escapeHtml(text.slice(0, 260))}</span>` : ''}
      ${targetRoomId ? `<em>${escapeHtml(targetRoomId)}</em>` : ''}
      ${message.eventId ? `<em>${escapeHtml(message.eventId)}</em>` : ''}
    </span>
  `;

  return row;
}

function renderToolEventRow(ev) {
  const row = document.createElement('button');
  row.type = 'button';
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
  row.className = 'yanta-ai-tool-row yanta-ai-tool-event-row';

  if (ev.id && ev.source !== 'markdown') {
    row.dataset.aiOpenEvent = ev.id;
  }

  const when = formatToolDateTime(ev.start, !!ev.allDay);
  const end = ev.end ? formatToolDateTime(ev.end, !!ev.allDay) : '';

  row.innerHTML = `
    <span class="yanta-ai-tool-row-icon">${lucide(ev.icon || 'calendar-days', 14)}</span>
    <span class="yanta-ai-tool-row-main">
      <strong>${escapeHtml(ev.title || t('ai.chat.common.untitledEvent'))}</strong>
      ${when ? `<small>${escapeHtml(when)}${end ? ` – ${escapeHtml(end)}` : ''}</small>` : ''}
      ${ev.location ? `<span>${escapeHtml(ev.location)}</span>` : ''}
      ${ev.noteId ? `<em>${escapeHtml(t('ai.chat.tool.linkedNote', { id: ev.noteId }))}</em>` : ''}
    </span>
  `;

  return row;
}

function renderToolNoteRow(note) {
  const row = document.createElement('button');
  row.type = 'button';
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
  row.className = 'yanta-ai-tool-row yanta-ai-tool-note-row';

  if (note.id) {
    row.dataset.aiOpenNote = note.id;
  }

  row.innerHTML = `
    <span class="yanta-ai-tool-row-icon">${lucide(note.icon || 'file-text', 14)}</span>
    <span class="yanta-ai-tool-row-main">
      <strong>${escapeHtml(note.title || t('ai.chat.common.untitled'))}</strong>
      ${note.folderPath ? `<small>${escapeHtml(note.folderPath)}</small>` : ''}
      ${note.id ? `<em>${escapeHtml(note.id)}</em>` : ''}
    </span>
  `;

  return row;
}

function renderToolBrainRow(hit) {
  const row = document.createElement('button');
  row.type = 'button';
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
  row.className = 'yanta-ai-tool-row yanta-ai-tool-brain-row';

  if (hit.id) {
    row.dataset.aiOpenNote = hit.id;
  }

  row.innerHTML = `
    <span class="yanta-ai-tool-row-icon">${lucide('brain-circuit', 14)}</span>
    <span class="yanta-ai-tool-row-main">
      <strong>${escapeHtml(hit.title || t('ai.chat.tool.brainNote'))}</strong>
      ${hit.excerpt ? `<small>${escapeHtml(hit.excerpt)}</small>` : ''}
    </span>
  `;

  return row;
}

/*
  Incremental rendering. Every streamed token used to rebuild the whole
  list, so the spinner, the dots and the progress bar restarted their
  animations dozens of times a second (the "nervous" loader), and
  widgets in earlier answers replayed their entrance. Now each message
  keeps its element; only messages whose content changed are rebuilt
  (inside the same outer element), the working indicator is one
  persistent element whose text is updated, and the list is reconciled
  with as few DOM moves as possible.
*/
const messageNodes = new WeakMap(); // message (or first of a tool run) -> { sig, node }
let emptyStateEl = null;

function messageSignature(msg) {
  const c = String(msg.content || '');
  return [
    msg.role,
    c.length,
    c.slice(-32),
    String(msg.reasoning || '').length,
    msg.citeCheck ? `${msg.citeCheck.pending ? 'p' : 'd'}${JSON.stringify(msg.citeCheck).length}` : '',
    msg.covers || 0,
    msg.model || '',
  ].join('|');
}

function messageInner(msg) {
  if (msg.role === 'summary') return [renderSummaryMessageNode(msg)];
  if (msg.role === 'assistant') return [renderAssistantMessageNode(msg)];

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="yanta-ai-msg-role" style="display:none">${escapeHtml(messageRoleLabel(msg))}</div>
    <div class="yanta-ai-msg-content">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
  `;
  return [...wrap.childNodes];
}

function nodeForMessage(msg) {
  const sig = messageSignature(msg);
  const cached = messageNodes.get(msg);

  if (cached && cached.sig === sig) return cached.node;

  const node = cached?.node || document.createElement('div');
  node.className = `yanta-ai-msg ${msg.role}`;
  node.replaceChildren(...messageInner(msg));
  messageNodes.set(msg, { sig, node });

  return node;
}

function nodeForToolRun(run) {
  const sig = `${run.length}|${String(run.at(-1)?.content || '').length}`;
  const cached = messageNodes.get(run[0]);

  if (cached && cached.sig === sig) return cached.node;

  const node = renderToolActivityNode(run);
  messageNodes.set(run[0], { sig, node });

  return node;
}

function renderMessages() {
  if (!messagesEl) return;

  const previousTop = messagesEl.scrollTop;
  const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 64;
  const stick = pinChatToBottom || wasAtBottom;
  pinChatToBottom = false;

  renderContextMeter();

  const desired = [];

  if (!conversation.length) {
    if (!emptyStateEl) {
      emptyStateEl = document.createElement('div');
      emptyStateEl.className = 'yanta-ai-empty';
      emptyStateEl.innerHTML = `
        <strong>${escapeHtml(t('ai.chat.empty.title'))}</strong>
        <p>${escapeHtml(t('ai.chat.empty.hint'))}</p>
      `;
    }
    desired.push(emptyStateEl);
  }

  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];

    // A run of tool calls is one quiet line ("Searched notes · Read note"),
    // expandable to the full results, instead of a card per call.
    if (msg.toolName) {
      const run = [];
      while (i < conversation.length && conversation[i].toolName) run.push(conversation[i++]);
      i--;
      desired.push(nodeForToolRun(run));
      continue;
    }

    desired.push(nodeForMessage(msg));
  }

  if (assistantBusy && conversation.length) {
    desired.push(updateAssistantWorkingNode());
  }

  if (contextMeterEl && conversation.length) {
    desired.push(contextMeterEl);
  }

  // Reconcile: keep nodes that are already in place, insert the rest.
  let ref = messagesEl.firstChild;
  for (const node of desired) {
    if (node === ref) {
      ref = ref.nextSibling;
      continue;
    }
    messagesEl.insertBefore(node, ref);
  }
  while (ref) {
    const next = ref.nextSibling;
    ref.remove();
    ref = next;
  }

  messagesEl.scrollTop = stick ? messagesEl.scrollHeight : previousTop;
}

/** The fold-out marking where older messages stopped being sent. */
function renderSummaryMessageNode(msg) {
  const details = document.createElement('details');
  details.className = 'yanta-ai-summary';

  const summary = document.createElement('summary');
  summary.innerHTML = `${lucide('fold-vertical', 13)}<span>${escapeHtml(
    msg.covers
      ? t('ai.chat.compaction.foldCount', { count: Number(msg.covers) })
      : t('ai.chat.compaction.fold')
  )}</span>`;

  const body = document.createElement('div');
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
  body.className = 'yanta-ai-summary-body yanta-ai-rich';
  body.innerHTML = renderBlocksInlineWithContext(String(msg.content || ''), { remoteMedia: 'link' });

  details.append(summary, body);

  return details;
}

function messageRoleLabel(msg) {
  if (msg.role === 'assistant') {
    return `YANTA AI · ${msg.model || getAiSettings().model || 'LLM'}`;
  }

  if (msg.role === 'user') return t('ai.chat.role.user');
  if (msg.role === 'tool') return t('ai.chat.tool.name.fallback');

  return msg.role || t('ai.chat.role.message');
}

function extractAssistantUiTokens(content) {
  let text = String(content || '');

  const notes = [];
  const events = [];
  const chips = [];

  text = text.replace(/\{\{note:([a-zA-Z0-9_-]+)\}\}/g, (_full, noteId) => {
    notes.push(noteId);
    return '';
  });

  text = text.replace(/\{\{event:([a-zA-Z0-9_-]+)\}\}/g, (_full, eventId) => {
    events.push(eventId);
    return '';
  });

  text = text.replace(/\{\{chip:([^|{}]+)\|([^{}]+)\}\}/g, (_full, label, prompt) => {
    chips.push({
      label: String(label || '').trim(),
      prompt: String(prompt || '').trim(),
    });

    return '';
  });

  return {
    text: text.trim(),
    notes: [...new Set(notes)],
    events: [...new Set(events)],
    chips: chips.filter((c) => c.label && c.prompt),
  };
}

function aiCopyButtonHtml(size = 13) {
  return `
    <span class="yanta-ai-copy-icon copy">${lucide('copy', size)}</span>
    <span class="yanta-ai-copy-icon check">${lucide('copy-check', size)}</span>
  `;
}

function createAiCopyButton(getText, {
  className = '',
  label = t('ai.chat.copy.copy'),
} = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `yanta-ai-copy-btn ${className}`.trim();
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = aiCopyButtonHtml();

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const text = String(getText?.() || '');

    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);

      btn.classList.remove('is-copied');
      // restart animation reliably
      void btn.offsetWidth;
      btn.classList.add('is-copied');

      window.setTimeout(() => {
        btn.classList.remove('is-copied');
      }, 1250);
    } catch {
      toast(t('ai.chat.copy.failed'), 'error');
    }
  });

  return btn;
}

function enhanceAiCodeCopy(rootEl) {
  if (!rootEl) return;

  for (const pre of rootEl.querySelectorAll('pre')) {
    if (pre.dataset.aiCopyEnhanced === '1') continue;

    pre.dataset.aiCopyEnhanced = '1';
    pre.classList.add('yanta-ai-codeblock');

    const code = pre.querySelector('code');
    const btn = createAiCopyButton(
      () => code?.textContent || pre.textContent || '',
      {
        className: 'block',
        label: t('ai.chat.copy.code'),
      }
    );

    pre.append(btn);
  }

  for (const code of rootEl.querySelectorAll('code')) {
    if (code.closest('pre')) continue;
    if (code.closest('.yanta-ai-inline-code-wrap')) continue;

    const wrap = document.createElement('span');
    wrap.className = 'yanta-ai-inline-code-wrap';

    const btn = createAiCopyButton(
      () => code.textContent || '',
      {
        className: 'inline',
        label: t('ai.chat.copy.inlineCode'),
      }
    );

    code.replaceWith(wrap);
    wrap.append(code, btn);
  }
}

function renderAssistantMessageNode(msg) {
  const wrap = document.createElement('div');

  const role = document.createElement('div');
  role.className = 'yanta-ai-msg-role';
  role.textContent = messageRoleLabel(msg);
  wrap.append(role);

  const reasoning = String(msg.reasoning || '').trim();

  if (reasoning) {
    const details = document.createElement('details');
    details.className = 'yanta-ai-thinking';

    const summary = document.createElement('summary');
    summary.innerHTML = `
      ${lucide('brain-circuit', 13)}
      <span>${escapeHtml(t('ai.chat.reasoning.label'))}</span>
    `;

    const pre = document.createElement('pre');
    pre.textContent = reasoning;

    details.append(summary, pre);
    wrap.append(details);
  }

  // Interactive widgets (```yanta-ui blocks) become markers here and are
  // mounted after the markdown is rendered; see ui-widgets.js.
  const { text: withWidgetMarks, widgets } = extractWidgets(stripForDisplay(keepClaimMarkers(String(msg.content || ''))));
  const parsed = extractAssistantUiTokens(withWidgetMarks);

  const content = document.createElement('div');
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
  content.className = 'yanta-ai-msg-content yanta-ai-rich';

  if (parsed.text) {
    content.innerHTML = renderBlocksInlineWithContext(parsed.text, { remoteMedia: 'link' });
    enhanceAiCodeCopy(content);
    markCitations(content, msg.citeCheck);
    mountWidgets(content, widgets, {
      stateFor: (i) => {
        msg.widgetState ||= {};
        msg.widgetState[i] ||= {};
        return msg.widgetState[i];
      },
      save: saveWidgetStateSoon,
      // A "choices" widget answers on the user's behalf when clicked.
      ask: (text) => submitUserText(text),
    });
  } else if (!parsed.notes.length && !parsed.events.length && !parsed.chips.length) {
    content.textContent = t('ai.chat.noResponse');
  }

  wrap.append(content);

  // Right under the text it is about, before note cards and chips.
  if (msg.citeCheck) {
    wrap.append(renderCitationCheckNode(msg.citeCheck));
  }

  if (parsed.notes.length || parsed.events.length) {
    const cards = document.createElement('div');
    cards.className = 'yanta-ai-link-cards';

    const all = [
      ...parsed.notes.map((noteId) => renderAiNoteCard(noteId)),
      ...parsed.events.map((eventId) => renderAiEventCard(eventId)),
    ];

    /*
      One card gets the full preview. Several become compact rows in a
      grid (title and folder/time; the excerpt moves into the tooltip),
      and past six the rest folds behind "Show N more".
    */
    if (all.length > 1) {
      cards.classList.add('is-compact');

      for (const card of all) {
        const excerpt = card.querySelector('.yanta-ai-link-card-excerpt');
        if (excerpt) {
          card.title = excerpt.textContent;
          excerpt.remove();
        }
      }
    }

    const VISIBLE = 6;
    all.slice(0, VISIBLE).forEach((card) => cards.append(card));

    if (all.length > VISIBLE) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'yanta-ai-link-cards-more';
      more.textContent = t('ai.chat.cards.showMore', { count: all.length - VISIBLE });
      more.addEventListener('click', () => {
        more.replaceWith(...all.slice(VISIBLE));
      });
      cards.append(more);
    }

    wrap.append(cards);
  }

  if (parsed.chips.length) {
    const chips = document.createElement('div');
    chips.className = 'yanta-ai-chips';

    for (const chip of parsed.chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'yanta-ai-chip';
      btn.dataset.aiChipPrompt = chip.prompt;
      btn.textContent = chip.label;

      chips.append(btn);
    }

    wrap.append(chips);
  }

  return wrap;
}

/*
  Citation markers in the rendered answer. The model writes "[2]{c3}"
  (source 2 backs claim 3); VeriQuote's display stripping drops the
  claim part, so it is first rewritten to an invisible-to-markdown
  "[2]⟦c3⟧", rendered, and then turned into a coloured marker that
  carries the check's verdict for that claim.
*/
const CLAIM_MARK = /((?:\[\d+\])+)⟦c(\d+)⟧/g;

function keepClaimMarkers(text) {
  return text.replace(/((?:\[\d+\])+)\{c(\d+)\}/g, '$1⟦c$2⟧');
}

/**
 * A citation problem for display. Items store VeriQuote's problem type
 * (citation-check.js); messages saved before that stored English labels,
 * which are shown as they are.
 */
function citationProblemLabel(problem) {
  const code = String(problem || '');

  return CITATION_PROBLEM_TYPES.has(code)
    ? t(`ai.chat.cite.problem.${code}`)
    : code;
}

function citationProblemsText(item) {
  return (item.problems || []).map(citationProblemLabel).join(', ');
}

function markCitations(root, check) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];

  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes('⟦c')) nodes.push(walker.currentNode);
  }

  const byClaim = new Map();
  for (const item of check?.items || []) {
    const list = byClaim.get(item.claimId) || [];
    list.push(item);
    byClaim.set(item.claimId, list);
  }

  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    const text = node.nodeValue;
    let last = 0;

    for (const m of text.matchAll(CLAIM_MARK)) {
      frag.append(text.slice(last, m.index));
      last = m.index + m[0].length;

      const items = byClaim.get(`c${m[2]}`) || [];
      const state = check?.pending
        ? 'pending'
        : !items.length
          ? 'plain'
          : items.every((i) => i.ok) ? 'ok' : items.some((i) => i.problems?.length || !i.matched) ? 'bad' : 'unknown';

      const sup = document.createElement('sup');
      sup.className = `yanta-ai-cite ${state}`;
      sup.textContent = m[1];

      if (items.length) {
        sup.title = items.map((i) => [
          i.ok ? `✓ ${t('ai.chat.cite.backed')}` : `⚠ ${citationProblemsText(i) || t('ai.chat.cite.notConfirmed')}`,
          `“${i.quote}”`,
          i.source?.title ? `— ${i.source.title}` : '',
        ].filter(Boolean).join('\n')).join('\n\n');
      } else if (check?.pending) {
        sup.title = t('ai.chat.cite.checkingOne');
      }

      frag.append(sup);
    }

    frag.append(text.slice(last).replace(/⟦c\d+⟧/g, ''));
    node.replaceWith(frag);
  }
}

// Sliders fire on every pixel; persist what the user set once they pause.
let widgetSaveTimer = 0;
function saveWidgetStateSoon() {
  clearTimeout(widgetSaveTimer);
  widgetSaveTimer = setTimeout(() => {
    saveTransientConversation();
    scheduleAiSessionSave();
  }, 600);
}

/** "3 of 4 citations checked out", with each claim, its quote and source. */
function renderCitationCheckNode(check) {
  const details = document.createElement('details');

  if (check.pending) {
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    details.className = 'yanta-ai-citecheck pending';
    details.innerHTML = `<summary>${lucide('shield', 13)}<span>${escapeHtml(
      check.total
        ? t('ai.chat.cite.checkingCount', { count: Number(check.total) })
        : t('ai.chat.cite.checking')
    )}</span></summary>`;
    return details;
  }

  const bad = check.total - check.passed;
  const tone = check.verdict === 'pass' ? 'ok' : bad ? 'bad' : 'unknown';

  details.className = `yanta-ai-citecheck ${tone}`;

  const headline = check.error
    ? t('ai.chat.cite.failed')
    : check.verdict === 'pass'
      ? t('ai.chat.cite.verified', { count: Number(check.total) })
      : bad
        ? t('ai.chat.cite.notBacked', { count: Number(check.total), bad })
        : t('ai.chat.cite.notJudged');

  const summary = document.createElement('summary');
  summary.title = t('ai.chat.cite.explainer');
  summary.innerHTML = `${lucide(tone === 'ok' ? 'shield-check' : tone === 'bad' ? 'shield-alert' : 'shield-question', 13)}<span>${escapeHtml(headline)}${check.revised ? ` · ${escapeHtml(t('ai.chat.cite.fixedOnce'))}` : ''}</span>${lucide('chevron-down', 12)}`;
  details.append(summary);

  const list = document.createElement('ol');
  list.className = 'yanta-ai-citecheck-list';

  for (const item of check.items || []) {
    const li = document.createElement('li');
    li.className = item.ok ? 'ok' : 'bad';

    const source = item.source
      ? item.source.url
        ? `<a href="${escapeHtml(item.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.source.title)}</a>`
        : escapeHtml(item.source.title)
      : escapeHtml(t('ai.chat.cite.unknownSource'));

    li.innerHTML = `
      <div class="yanta-ai-citecheck-claim">${lucide(item.ok ? 'check' : 'x', 12)} <span>${escapeHtml(item.claim)}</span> <b>[${item.n}]</b></div>
      <blockquote>${escapeHtml(item.quote)}</blockquote>
      <small>${source}${item.problems?.length ? ` · ${escapeHtml(citationProblemsText(item))}` : ''}</small>
    `;

    list.append(li);
  }

  if (check.items?.length) details.append(list);

  const note = document.createElement('p');
  note.className = 'yanta-ai-citecheck-note';
  note.textContent = check.judged === false
    ? t('ai.chat.cite.noteUnjudged')
    : t('ai.chat.cite.noteJudged');
  details.append(note);

  return details;
}

function noteFolderPathForAi(folderId) {
  if (!folderId) return '';

  const parts = [];
  const seen = new Set();
  let f = state.folders.get(folderId);

  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    parts.unshift(f.name || t('ai.chat.common.folder'));
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  return parts.join(' / ');
}

function noteExcerptForAi(noteId) {
  try {
    const md = noteMarkdown(noteId);

    return String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      // Task markers: "- [x] Bread" reads "✓ Bread", "- [ ] Milk" reads "Milk".
      .replace(/^\s*[-*+]\s+\[[xX]\]\s+/gm, '✓ ')
      .replace(/^\s*[-*+]\s+\[ \]\s+/gm, '')
      .replace(/\n+/g, ' · ')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => alias || target)
      .replace(/[#*_>`~\[\]()-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
  } catch {
    return '';
  }
}

function renderAiNoteCard(noteId) {
  const note = state.notes.get(String(noteId || ''));

  const card = document.createElement('button');
  card.type = 'button';
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
  card.className = 'yanta-ai-link-card yanta-ai-note-card';
  card.dataset.aiOpenNote = noteId;

  if (!note) {
    card.innerHTML = `
      <span class="yanta-ai-link-card-icon">${lucide('file-question', 18)}</span>
      <span class="yanta-ai-link-card-main">
        <strong>${escapeHtml(t('ai.chat.cards.noteNotFound'))}</strong>
        <small>${escapeHtml(noteId)}</small>
      </span>
    `;

    return card;
  }

  const icon = note.icon || (note.type === 'list' ? 'list' : 'file-text');
  const color = note.color || 'var(--accent)';
  const folder = noteFolderPathForAi(note.folderId);
  const excerpt = noteExcerptForAi(note.id);

  card.style.setProperty('--ai-card-color', color);

  card.innerHTML = `
    <span class="yanta-ai-link-card-icon">${lucide(icon, 18)}</span>
    <span class="yanta-ai-link-card-main">
      <strong>${escapeHtml(note.title || t('ai.chat.common.untitled'))}</strong>
      ${folder ? `<small>${escapeHtml(folder)}</small>` : `<small class="is-empty">${escapeHtml(t('ai.chat.cards.noFolder'))}</small>`}
      ${excerpt ? `<span class="yanta-ai-link-card-excerpt">${escapeHtml(excerpt)}</span>` : ''}
    </span>
  `;

  return card;
}

function formatAiEventDate(value, allDay = false) {
  if (!value) return '';

  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';

    if (allDay) {
      return d.toLocaleDateString([], {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }

    return d.toLocaleString([], {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function renderAiEventCard(eventId) {
  const card = document.createElement('button');
  card.type = 'button';
  // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
  card.className = 'yanta-ai-link-card yanta-ai-event-card';
  card.dataset.aiOpenEvent = eventId;
  card.style.setProperty('--ai-card-color', 'var(--accent-2)');

  card.innerHTML = `
    <span class="yanta-ai-link-card-icon">${lucide('calendar-days', 18)}</span>
    <span class="yanta-ai-link-card-main">
      <strong>${escapeHtml(t('ai.chat.cards.calendarEvent'))}</strong>
      <small>${escapeHtml(eventId)}</small>
    </span>
  `;

  hydrateAiEventCard(card, eventId);

  return card;
}

async function hydrateAiEventCard(card, eventId) {
  try {
    const calendar = await import('../calendar.js');

    calendar.hydrateCalendarStateFromVault?.({
      silent: true,
    });

    const ev = state.calendarEvents.get(String(eventId || ''));

    if (!ev || !card.isConnected) return;

    const when = formatAiEventDate(ev.start, !!ev.allDay);
    const end = ev.end ? formatAiEventDate(ev.end, !!ev.allDay) : '';

    card.innerHTML = `
      <span class="yanta-ai-link-card-icon">${lucide(ev.icon || 'calendar-days', 18)}</span>
      <span class="yanta-ai-link-card-main">
        <strong>${escapeHtml(ev.title || t('ai.chat.common.untitledEvent'))}</strong>
        ${when ? `<small>${escapeHtml(when)}${end ? ` – ${escapeHtml(end)}` : ''}</small>` : ''}
        ${ev.location ? `<span class="yanta-ai-link-card-excerpt">${escapeHtml(ev.location)}</span>` : ''}
        ${ev.description ? `<span class="yanta-ai-link-card-excerpt">${escapeHtml(ev.description).slice(0, 220)}</span>` : ''}
      </span>
    `;
  } catch {}
}

async function handleAiMessageClick(e) {
  const chip = e.target.closest?.('[data-ai-chip-prompt]');

  if (chip) {
    e.preventDefault();
    e.stopPropagation();

    const prompt = chip.dataset.aiChipPrompt || '';
    if (prompt.trim()) {
      await submitUserText(prompt.trim());
    }

    return;
  }

  const noteCard = e.target.closest?.('[data-ai-open-note]');

  if (noteCard) {
    e.preventDefault();
    e.stopPropagation();

    const noteId = noteCard.dataset.aiOpenNote;

    if (noteId && state.notes.has(noteId)) {
      await openNote(noteId);
    } else {
      toast(t('ai.chat.cards.noteNotFound'), 'error');
    }

    return;
  }

  const eventCard = e.target.closest?.('[data-ai-open-event]');

  if (eventCard) {
    e.preventDefault();
    e.stopPropagation();

    const eventId = String(eventCard.dataset.aiOpenEvent || '').trim();

    if (!eventId) return;

    try {
      const calendar = await import('../calendar.js');

      if (typeof calendar.openCalendarEvent !== 'function') {
        // eslint-disable-next-line yanta/no-untranslated-literal -- internal error, never shown
        throw new Error('Calendar event navigation is not available.');
      }

      calendar.openCalendarEvent(eventId, {
        push: false,
        replace: false,
      });

      pushCalendarEventHistory(eventId);
    } catch {
      toast(t('ai.chat.cards.eventOpenFailed'), 'error');
    }

    return;
  }

  const wiki = e.target.closest?.('a.wiki-link');

  if (wiki) {
    e.preventDefault();
    e.stopPropagation();

    const noteId = wiki.dataset.noteId || '';

    if (noteId && state.notes.has(noteId)) {
      await openNote(noteId);
    } else {
      toast(t('ai.chat.cards.linkedNoteNotFound'), 'error');
    }
  }
}

function renderSettings() {
  if (!settingsPanel) return;

  settingsPanel.hidden = !settingsOpen;
  root?.classList.toggle('settings-open', !!settingsOpen);

  updateCloseButton();

  if (!settingsOpen) return;

  renderAiSettingsPanel(settingsPanel);
}

/*
  After untrusted content entered the chat, every write/delete asks first
  (the user is here, so even creating a note is cheap to confirm), and so
  does opening a web address the model composed itself — a URL with your
  notes appended is how injected text would smuggle them out.
*/
function toolRequiresExternalSourceApproval(toolName, args = {}) {
  if (!chatTaint.tainted) return false;
  if (externalSourceWriteAllowAll) return false;

  const tool = getTool(toolName);

  if (!tool) return false;

  if (tool.risk === 'write' || tool.risk === 'destructive') return true;

  return !!untrustedContentGate(chatTaint, { name: toolName, args, risk: tool.risk });
}

function rememberUserUrls(messages = []) {
  for (const message of messages) {
    if (message?.role === 'user') collectUrls(message.content, chatTaint.knownUrls);
  }
}

/** The approval modal's headline: what the model is about to do. */
function externalApprovalToolLabel(toolName, args = {}) {
  const A = 'ai.chat.approval.action.';

  if (toolName === 'delete_note') {
    return t(`${A}deleteNote`, { id: args.noteId || '' });
  }

  if (toolName === 'append_to_note') {
    return t(`${A}appendToNote`, { id: args.noteId || '' });
  }

  if (toolName === 'replace_in_note') {
    return t(`${A}replaceInNote`, { id: args.noteId || '' });
  }

  if (toolName === 'replace_current_selection') {
    return t(`${A}replaceSelection`);
  }

  if (toolName === 'create_note') {
    return t(`${A}createNote`, { title: args.title || t('ai.chat.common.untitled') });
  }

  if (toolName === 'create_drawing_note') {
    return t(`${A}createDrawing`, { title: args.title || t('ai.chat.tool.result.drawingFallback') });
  }

  if (toolName === 'update_drawing') {
    return t(`${A}updateDrawing`, { id: args.drawingId || '' });
  }

  if (toolName === 'update_event' || toolName === 'update_event_appearance') {
    return t(`${A}updateEvent`, { id: args.eventId || args.id || '' });
  }

  if (toolName === 'create_event') {
    return t(`${A}createEvent`, { title: args.title || t('ai.chat.common.untitledEvent') });
  }

  if (toolName === 'web_read') {
    return args.url
      ? t(`${A}openUrl`, { url: args.url })
      : t(`${A}openPage`);
  }

  return t(`${A}generic`, { tool: toolDisplayName(toolName) });
}

function requestExternalSourceToolApproval({
  toolName,
  args,
} = {}) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    modal.className = 'modal yanta-ai-approval-modal';

    modal.innerHTML = `
      <div class="modal-card yanta-ai-approval-card">
        <header class="modal-head">
          <h3>${escapeHtml(t('ai.chat.approval.title'))}</h3>
        </header>

        <div class="modal-body">
          <div class="yanta-ai-approval-main">
            <div class="yanta-ai-approval-icon">
              ${lucide('shield-alert', 20)}
            </div>

            <div>
              <strong>${escapeHtml(externalApprovalToolLabel(toolName, args))}</strong>
              <p>${escapeHtml(t('ai.chat.approval.body'))}</p>
            </div>
          </div>

          <details class="yanta-ai-approval-details">
            <summary>${escapeHtml(t('ai.chat.approval.details'))}</summary>
            <pre>${escapeHtml(JSON.stringify({ tool: toolName, args }, null, 2))}</pre>
          </details>

          <details class="yanta-ai-approval-details subtle">
            <summary>${escapeHtml(t('ai.chat.approval.whyTitle'))}</summary>
            <p>${escapeHtml(t('ai.chat.approval.why'))}</p>
          </details>

          <div class="compress-actions yanta-ai-approval-actions">
            <button class="btn" data-ai-approval="block">
              ${lucide('ban', 14)}
              ${escapeHtml(t('ai.chat.approval.block'))}
            </button>

            <span class="grow"></span>

            <button class="btn" data-ai-approval="allow-session">
              ${lucide('shield-check', 14)}
              ${escapeHtml(t('ai.chat.approval.allowSession'))}
            </button>

            <button class="btn primary" data-ai-approval="allow">
              ${lucide('check', 14)}
              ${escapeHtml(t('ai.chat.approval.allow'))}
            </button>
          </div>
        </div>
      </div>
    `;

    const cleanup = (value) => {
      modal.remove();
      resolve(value);
    };

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cleanup({
          allowed: false,
          allowAll: false,
        });

        return;
      }

      const btn = e.target.closest?.('[data-ai-approval]');
      if (!btn) return;

      const action = btn.dataset.aiApproval;

      cleanup({
        allowed: action === 'allow' || action === 'allow-session',
        allowAll: action === 'allow-session',
      });
    });

    document.body.append(modal);
  });
}

/**
 * Folds everything but the latest turns into a summary message (see
 * conversation-compaction.js). Returns the summary, or null.
 */
async function compactAssistantConversation({ signal = null } = {}) {
  setAssistantBusy(true, t('ai.chat.busy.compacting'));

  const summary = await compactConversation(conversation, {
    signal,
    complete: ({ messages, signal: s }) => openRouterChatCompletion({ messages, tools: [], signal: s }),
  });

  if (summary) {
    saveTransientConversation();
    scheduleAiSessionSave();
    renderMessages();
  }

  return summary;
}

async function runAssistant(userText) {
  abortController = new AbortController();

  // Long chat: summarise the older part before this turn is sent. If that
  // fails, fitHistory below still keeps the request within limits.
  if (needsCompaction(conversation)) {
    try {
      await compactAssistantConversation({ signal: abortController.signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      // eslint-disable-next-line yanta/no-untranslated-literal -- console
      console.warn('[YANTA AI] compaction failed; sending the newest messages only', err);
    }
  }

  const loadoutKey = JSON.stringify([
    getAiSettings().permissions || null,
    getAiSettings().progressiveTools !== false,
  ]);

  if (!conversationLoadout || conversationLoadoutKey !== loadoutKey) {
    conversationLoadout = createToolLoadout({
      permissions: getAiSettings().permissions,
      enabled: getAiSettings().progressiveTools !== false,
    });
    conversationLoadoutKey = loadoutKey;
  }

  const loadout = conversationLoadout;

  const tools = loadout.specs();

  // eslint-disable-next-line yanta/no-untranslated-literal -- console
  console.info('[YANTA AI] tools offered to model', tools.map((tool) =>
    tool.function?.name || ''
  ));

  window.dispatchEvent(new CustomEvent('yanta-ai-tools-offered', {
    detail: {
      names: tools.map((tool) => tool.function?.name || ''),
      tools,
    },
  }));

  /*
    Stable first, volatile last: system prompt, then the append-only
    history, then this turn's context (time, file tree, current note) right
    before the latest user message. With the context ahead of the history,
    prompt caching could never cover more than the system prompt.
  */
  const sinceSummary = historySinceSummary(conversation);

  // Citation markers and quote appendices of earlier answers are for the
  // checker, not worth resending.
  const history = fitHistory(sinceSummary.messages.map((m) => ({
    role: m.role,
    content: m.role === 'assistant' ? stripForDisplay(String(m.content || '')) : m.content,
  })));

  let lastUserIndex = -1;
  history.forEach((m, i) => { if (m.role === 'user') lastUserIndex = i; });

  const contextMessage = await buildContextMessage({
    attachments: activeContextItems,
  });

  const citationMode = String(getAiSettings().citationCheck || 'check');
  const citeSources = citationMode === 'off' ? null : createSourceRegistry();

  const systemMessage = await buildSystemMessage({
    userText,
    toolIndex: loadout.indexMarkdown(),
  });

  systemMessage.content = [systemMessage.content, WIDGET_INSTRUCTIONS].join('\n\n');

  if (citeSources) {
    systemMessage.content = [
      systemMessage.content,
      YANTA_CITATION_PREAMBLE,
      buildCitationInstructions({ maxCitedClaims: 12 }),
    ].join('\n\n');
  }

  const messages = [
    systemMessage,
    ...summaryMessages(sinceSummary.summary),
    ...(lastUserIndex >= 0
      ? [...history.slice(0, lastUserIndex), contextMessage, ...history.slice(lastUserIndex)]
      : [contextMessage, ...history]),
  ];

  setAssistantBusy(true, t('ai.chat.busy.thinking'));

  const runtimeSettings = getEffectiveAiRuntimeSettings();
  const modelLabel = () => runtimeSettings.includedModel || runtimeSettings.model || getAiSettings().model;

  const maxRounds = Math.max(
    1,
    Math.min(
      isIncludedAiMode(runtimeSettings) ? runtimeSettings.maxToolRounds : 50,
      Number(runtimeSettings.maxToolRounds || 6)
    )
  );

  /*
    One round as the chat sees it: stream the reply into a live message,
    then keep it, drop it (an empty preamble before tool calls) or say
    there was no response. The final wrap-up round is not streamed — its
    text is added once the loop returns.
  */
  const requestRound = async ({ messages: thread, tools: roundTools, round, final, signal }) => {
    streamingReasoning = '';
    rememberUserUrls(thread);

    if (final) {
      setAssistantBusy(true, t('ai.chat.busy.summarizing'));
      return openRouterChatCompletionStream({ messages: thread, tools: roundTools, signal });
    }

    setAssistantBusy(true, round === 0
      ? t('ai.chat.busy.thinking')
      : t('ai.chat.busy.toolRound', { round: round + 1, max: maxRounds }));

    let streamedMsg = null;
    let hasVisibleContent = false;

    const assistantMessage = await openRouterChatCompletionStream({
      messages: thread,
      tools: roundTools,
      signal,
      onDelta: (delta) => {
        if (delta.type === 'reasoning') {
          streamingReasoning = appendUniqueText(streamingReasoning, delta.text || '');

          if (streamedMsg) {
            streamedMsg.reasoning = streamingReasoning;
          }

          scheduleStreamRender();
          return;
        }

        if (delta.type === 'content') {
          const text = delta.text || '';

          if (!text) return;

          if (!streamedMsg) {
            streamedMsg = pushAssistantStreamMessage({
              model: modelLabel(),
              reasoning: streamingReasoning,
            });
          }

          streamedMsg.content = appendUniqueText(streamedMsg.content, text);
          streamedMsg.reasoning = streamingReasoning;
          hasVisibleContent = true;

          setAssistantBusy(true, t('ai.chat.busy.responding'));
          scheduleStreamRender();
        }
      },
    });

    const finalContent = String(assistantMessage.content || '').trim();
    const finalReasoning = String(assistantMessage.reasoning || streamingReasoning || '').trim();

    if (finalContent) {
      if (!streamedMsg) {
        streamedMsg = pushAssistantStreamMessage({ model: modelLabel() });
      }

      streamedMsg.content = finalContent;
      streamedMsg.reasoning = finalReasoning;
      hasVisibleContent = true;
    } else if (streamedMsg) {
      streamedMsg.reasoning = finalReasoning;
    }

    if (streamedMsg && hasVisibleContent) {
      finalizeAssistantStreamMessage(streamedMsg);
    } else if (streamedMsg) {
      removeConversationMessageObject(streamedMsg);
    } else if (!(assistantMessage.tool_calls || []).length) {
      addMessage('assistant', t('ai.chat.noResponse'), { model: modelLabel() });
    }

    streamingReasoning = '';

    return assistantMessage;
  };

  const result = await runAgentLoop({
    messages,
    // Re-read each round: a tools_load call in the previous round
    // widens what the model may call in this one.
    tools: () => loadout.specs(),
    maxRounds,
    signal: abortController.signal,
    source: 'assistant',
    requestRound,
    beforeToolCall: async ({ name, args }) => {
      setAssistantBusy(true, t('ai.chat.busy.usingTool', { tool: toolDisplayName(name) }));

      // Resolves inside the run: it changes what the next round may
      // call, so it never reaches the registry.
      if (loadout.isLoadTool(name)) {
        return { result: loadout.load(args) };
      }

      if (toolRequiresExternalSourceApproval(name, args)) {
        const approval = await requestExternalSourceToolApproval({ toolName: name, args });

        if (approval.allowAll) {
          externalSourceWriteAllowAll = true;
        }

        if (!approval.allowed) {
          return {
            allowed: false,
            // Returned to the model, so it stays English.
            // eslint-disable-next-line yanta/no-untranslated-literal
            reason: 'Blocked by user because external content (web, feeds or messages) is present in this chat.',
            code: 'EAI_HUMAN_BLOCKED_EXTERNAL_SOURCE_WRITE',
          };
        }
      }

      return undefined;
    },
    onToolResult: ({ name, args, result: toolResult, ran }) => {
      if (ran) noteToolResult(chatTaint, name, toolResult);

      addMessage('tool', JSON.stringify({ args, result: toolResult }, null, 2), {
        toolName: name,
      });

      // Numbered for citing; the model sees the result with `cite` fields.
      return ran && citeSources ? citeSources.register(name, toolResult) : undefined;
    },
  });

  // Round budget spent, or stopped going in circles: the wrap-up round's
  // text is the user's summary.
  if (result.stop === AGENT_STOP.MAX_ROUNDS || result.stop === AGENT_STOP.LOOP) {
    const fallback = result.stop === AGENT_STOP.LOOP
      ? t('ai.chat.stop.loop')
      : t('ai.chat.stop.maxRounds', { count: maxRounds });

    addMessage('assistant', result.finalText || fallback, {
      model: modelLabel(),
    });
  }

  if (citeSources?.size) {
    await checkAnswerCitations({
      sources: citeSources,
      thread: result.thread,
      mode: citationMode,
      signal: abortController?.signal,
    });
  }
}

/**
 * Checks the quotes of the turn's final answer (citation-check.js) and,
 * in "revise" mode, sends failed citations back to the model once.
 */
async function checkAnswerCitations({ sources, thread, mode, signal }) {
  const msg = [...conversation].reverse().find((m) => m.role === 'assistant');
  if (!msg || !hasCitations(msg.content)) return;

  setAssistantBusy(true, t('ai.chat.busy.checkingCitations'));

  // Shown at once: the badge and the markers say "checking" until the
  // verdicts arrive.
  msg.citeCheck = { pending: true, total: (String(msg.content).match(/\{c\d+\}/g) || []).length };
  renderMessages();

  try {
    let check = await checkCitations(msg.content, sources, { signal });

    if (check?.verdict === 'revise' && mode === 'revise' && check.instructionsForModel) {
      setAssistantBusy(true, t('ai.chat.busy.fixingCitations'));

      const revised = await openRouterChatCompletion({
        messages: [
          ...thread,
          { role: 'assistant', content: msg.content },
          { role: 'user', content: check.instructionsForModel },
        ],
        tools: [],
        signal,
      });

      const text = String(revised?.content || '').trim();

      if (text) {
        msg.content = text;
        check = await checkCitations(text, sources, { signal });
        if (check) check.revised = true;
      }
    }

    if (check) {
      const { instructionsForModel, ...stored } = check;
      msg.citeCheck = stored;
    } else {
      delete msg.citeCheck;
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // eslint-disable-next-line yanta/no-untranslated-literal -- console
    console.warn('[YANTA AI] citation check failed', err);
    msg.citeCheck = { verdict: 'unverified', error: String(err?.message || err).slice(0, 160), items: [], passed: 0, total: 0 };
  }

  saveTransientConversation();
  scheduleAiSessionSave();
  renderMessages();
}

async function maybeHandleAssistantSlashCommand(text) {
  const raw = String(text || '').trim();

  if (!raw.startsWith('/')) return false;

  const [commandRaw, ...restParts] = raw.slice(1).split(/\s+/);
  const command = commandRaw.trim().toLowerCase();
  const rest = restParts.join(' ').trim();

  if (!command) return false;

  if (command === 'tools') {
    const permissions = getAiSettings().permissions;

    const tools = openAiToolsForModel({ permissions })
      .map((tool) => ({
        name: tool.function?.name || '',
        description: String(tool.function?.description || '').trim(),
      }))
      .filter((tool) => tool.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    const blocked = openAiToolsForModel()
      .map((tool) => tool.function?.name || '')
      .filter((name) => name && !tools.some((tool) => tool.name === name));

    addMessage(
      'assistant',
      [
        `## ${t('ai.chat.slash.tools.title')}`,
        '',
        t('ai.chat.slash.tools.count', { count: tools.length }),
        blocked.length
          ? t('ai.chat.slash.tools.blocked', { tools: blocked.join(', ') })
          : '',
        '',
        `| ${t('ai.chat.slash.tools.colTool')} | ${t('ai.chat.slash.tools.colDescription')} |`,
        '|---|---|',
        ...tools.map((tool) =>
          `| \`${tool.name}\` | ${tool.description.replace(/\n+/g, ' ').slice(0, 180)} |`
        ),
      ].join('\n'),
      {
        model: 'YANTA',
      }
    );

    return true;
  }

  if (command === 'compact') {
    if (abortController) {
      toast(t('ai.chat.toast.busy'), 'error');
      return true;
    }

    abortController = new AbortController();

    try {
      const summary = await compactAssistantConversation({ signal: abortController.signal });
      if (!summary) toast(t('ai.chat.slash.compact.nothing'));
    } catch (err) {
      toast(t('ai.chat.slash.compact.failed', { error: err?.message || String(err) }), 'error');
    } finally {
      abortController = null;
      setAssistantBusy(false);
    }

    return true;
  }

  if (command === 'skills') {
    const {
      skillsListAction,
      skillViewAction,
    } = await import('./skills.js');

    if (!rest || rest === 'list') {
      const result = await skillsListAction();

      addMessage(
        'assistant',
        [
          `## ${t('ai.chat.slash.skills.title')}`,
          '',
          result.skills.length
            ? result.skills.map((s) =>
                `- **${s.name}** — ${s.description || t('ai.chat.slash.skills.noDescription')}`
              ).join('\n')
            : t('ai.chat.slash.skills.none'),
        ].join('\n'),
        {
          model: 'YANTA',
        }
      );

      return true;
    }

    const showMatch = /^show\s+(.+)$/.exec(rest) || /^view\s+(.+)$/.exec(rest);

    if (showMatch) {
      const skill = await skillViewAction({
        name: showMatch[1],
      });

      addMessage(
        'assistant',
        [
          `## ${t('ai.chat.slash.skills.skill', { name: skill.name })}`,
          '',
          '```markdown',
          skill.text,
          '```',
        ].join('\n'),
        {
          model: 'YANTA',
        }
      );

      return true;
    }
  }

  /*
    /skill-name request
    Load the skill content and run a normal AI turn with it attached.
  */
  try {
    const {
      skillViewAction,
    } = await import('./skills.js');

    const skill = await skillViewAction({
      name: command,
    });

    const prompt = [
      `Use this YANTA skill for the following request.`,
      '',
      `<YANTA_SKILL name="${skill.name}">`,
      skill.text,
      '</YANTA_SKILL>',
      '',
      // The prompt goes to the model, so it stays English.
      // eslint-disable-next-line yanta/no-untranslated-literal
      'User request:',
      rest || `Use the ${skill.name} skill.`,
    ].join('\n');

    await submitUserText(prompt);
    return true;
  } catch {
    return false;
  }
}

async function submitUserText(text) {
  const clean = String(text || '').trim();

  if (!clean) return;

  if (clean.startsWith('/')) {
    const handled = await maybeHandleAssistantSlashCommand(clean);

    if (handled) return;
  }

  if (abortController) {
    toast(t('ai.chat.toast.busy'), 'error');
    return;
  }

  const aiSettings = getAiSettings();

  if (aiSettings.billingMode === 'included') {
    const check = await canUseIncludedAi();

    if (!check.ok) {
      settingsOpen = true;
      renderSettings();
      toast(check.reason, 'error');
      return;
    }
  } else if (!getAiApiKey()) {
    settingsOpen = true;
    renderSettings();
    toast(t('ai.chat.toast.needApiKey'), 'error');
    return;
  }

  addMessage('user', clean);

  setAssistantBusy(true, t('ai.chat.busy.thinking'));

  sendBtn.disabled = false;
  sendBtn.classList.add('is-working');
  sendBtn.title = t('ai.chat.input.stop');
  sendBtn.setAttribute('aria-label', t('ai.chat.input.stop'));
  sendBtn.innerHTML = lucide('square', 16);

  try {
    await runAssistant(clean);
  } catch (err) {
    if (err?.name === 'AbortError') {
      // User clicked stop — no error toast needed
    } else {
      console.error(err);
      addMessage('assistant', t('ai.chat.error', { message: err?.message || String(err) }), {
        model: getAiSettings().model,
      });
    }
  } finally {
    streamingReasoning = '';
    setAssistantBusy(false);

    sendBtn.classList.remove('is-working');
    sendBtn.title = t('ai.chat.input.send');
    sendBtn.setAttribute('aria-label', t('ai.chat.input.sendMessage'));
    sendBtn.innerHTML = lucide('arrow-up', 18);
    updateSendButtonState();
    abortController = null;
  }
}

let singleLineHeight = 36; // Fallback, wird dynamisch gemessen

function autoResizeInput() {
  if (!inputEl) return;

  inputEl.style.height = 'auto';

  const cssMax = parseInt(getComputedStyle(inputEl).maxHeight, 10) || 220;

  // Wenn das Feld leer ist, setze alles auf eine Zeile zurück
  if (inputEl.value === '') {
    // Fange die echte Höhe einer einzelnen Zeile ab
    singleLineHeight = inputEl.scrollHeight;
    inputEl.style.height = singleLineHeight + 'px';
    
    if (inputShellEl) {
      inputShellEl.classList.remove('is-multiline');
    }
    return;
  }

  // Berechne die aktuell benötigte Höhe basierend auf der AKTUELLEN Breite
  let needed = inputEl.scrollHeight;

  // Layout-Wechsel steuern
  if (inputShellEl) {
    const isCurrentlyMultiline = inputShellEl.classList.contains('is-multiline');
    
    // Nur in den Multiline-Modus wechseln, wenn die benötigte Höhe 
    // signifikant größer ist als EINE Zeile (+5px Toleranz)
    if (!isCurrentlyMultiline && needed > singleLineHeight + 5) {
      inputShellEl.classList.add('is-multiline');
      
      // DURCHBRUCH: Da das Textarea durch den Layout-Wechsel jetzt die volle 
      // Breite hat, passt der Text evtl. wieder in weniger Zeilen. 
      // Wir müssen die benötigte Höhe hier NEU berechnen!
      needed = inputEl.scrollHeight;
    }
  }

  // Setze die finale Höhe (schrumpft und wächst ab jetzt Zeile für Zeile mit)
  inputEl.style.height = Math.min(needed, cssMax) + 'px';
}

function updateSendButtonState() {
  if (!sendBtn || !inputEl || assistantBusy) return;
  sendBtn.disabled = !inputEl.value.trim();
}

async function sendCurrentInput() {
  const text = inputEl?.value?.trim();

  if (!text) return;

  inputEl.value = '';
  autoResizeInput(); // <-- Setzt Höhe und Multiline-Klasse automatisch zurück
  updateSendButtonState();

  await submitUserText(text);
}

export function setupAssistant() {
  if (initialized) return;
  initialized = true;

  registerAiOverlayRoute();

  ensureRoot();
  createFloatingShell();
  setupAgentBridge();

  window.yantaAiTools = () => {
    const tools = openAiToolsForModel();

    return tools.map((tool) => ({
      name: tool.function?.name || '',
      description: tool.function?.description || '',
      parameters: tool.function?.parameters || null,
    }));
  };

  window.yantaAiToolNames = () =>
    openAiToolsForModel().map((tool) => tool.function?.name || '');

  window.yantaAiToolDump = () => {
    const rows = window.yantaAiTools();
    console.table(rows.map((tool) => ({
      name: tool.name,
      description: String(tool.description || '').slice(0, 90),
    })));
    return rows;
  };

    if (!conversation.length) {
        conversation = loadTransientConversation();
        renderMessages();
    }

  window.addEventListener('yanta-open-ai-assistant', (e) => {
    openAssistantSmart();

    // A share-target "AI" route seeds the composer with the shared text/link
    // so the user can immediately ask about it. Defer a frame so the panel's
    // input is mounted first.
    const seed = String(e?.detail?.attachment || '').trim();
    if (seed) {
      requestAnimationFrame(() => {
        if (!inputEl) return;
        inputEl.value = seed;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.focus();
      });
    }
  });
  window.addEventListener('yanta-open-ai-floating', () => openAssistantFloating());

  window.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;

    if (meta && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      openAssistantSmart();
    }

    if (e.key === 'Escape' && mode === 'floating' && floatingShell && !floatingShell.hidden) {
      if (overlayIdFromState()) {
        closeTopOverlay();
      } else {
        closeAssistant();
      }
    }
  });
}

function injectCss() {
  if (document.getElementById('yanta-ai-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-ai-css';
  style.textContent = `
.yanta-ai-root {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--text);
  background: var(--bg-elev);
}

.yanta-ai-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 46px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev-2);
  user-select: none;
}

.yanta-ai-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.yanta-ai-title svg {
  color: var(--accent);
}

.yanta-ai-settings {
  flex: 0 0 auto;
  max-height: min(62vh, 720px);
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}

/* When AI settings are open, they become the active assistant view.
   This prevents messages/footer from being visible underneath. */
.yanta-ai-settings:not([hidden]) {
  flex: 1 1 auto;
  max-height: none;
  min-height: 0;
  overflow: auto;
}

.yanta-ai-settings:not([hidden]) ~ .yanta-ai-messages,
.yanta-ai-settings:not([hidden]) ~ .yanta-ai-foot {
  display: none !important;
}

.yanta-ai-settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.yanta-ai-settings-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.yanta-ai-settings-grid .wide {
  grid-column: 1 / -1;
}

.yanta-ai-settings-section {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.yanta-ai-settings-section h4 {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text);
}

.yanta-ai-permission {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev-2);
  margin-bottom: 6px;
  cursor: pointer;
}

.yanta-ai-permission input {
  margin-top: 2px;
  accent-color: var(--accent);
}

.yanta-ai-permission span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-ai-permission strong {
  font-size: 12px;
  color: var(--text);
}

.yanta-ai-permission small {
  font-size: 11px;
}

.yanta-ai-permission small.good {
  color: var(--green);
}

.yanta-ai-permission small.warn {
  color: var(--yellow);
}

.yanta-ai-prompt-editor {
  font-family: var(--font-mono);
  font-size: 12px;
  resize: vertical;
}

.yanta-ai-warning {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--yellow) 40%, var(--border));
  background: color-mix(in srgb, var(--yellow) 8%, transparent);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-ai-messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.yanta-ai-empty {
  margin: auto;
  max-width: 420px;
  color: var(--text-dim);
  text-align: center;
}

.yanta-ai-empty strong {
  display: block;
  color: var(--text);
  margin-bottom: 6px;
}

.yanta-ai-msg {
  border-radius: 12px;
  padding: 10px 12px;
  /* background: var(--bg-elev-2); */
}

.yanta-ai-msg.user {
    border-color: 
      color-mix(in srgb, var(--accent) 38%, var(--border));
    background: 
      color-mix(in srgb, var(--accent) 8%, var(--bg-elev-2));
    width: -moz-fit-content;
    width: fit-content;
    /* align-self: flex-end; */
    margin-left: auto;
    border-radius: 24px 4px 24px 24px;
}

.yanta-ai-msg.assistant {
    width: -moz-fit-content;
    width: fit-content;
    margin-right: auto;
    /* border: 1px solid var(--border); */
    border-radius: 4px 24px 24px 24px;
}

.yanta-ai-msg.tool {
  background: var(--bg);
  background: transparent;
  color: var(--text-dim);
  padding: 0px 12px 0 0;
}

.yanta-ai-citecheck {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-faint);
}

.yanta-ai-citecheck > summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, currentColor 8%, transparent);
  font-weight: 550;
}

.yanta-ai-citecheck[open] > summary > svg:last-child {
  transform: rotate(180deg);
}

.yanta-ai-citecheck.pending > summary {
  cursor: default;
  animation: yanta-cite-pulse 1.4s ease-in-out infinite;
}

@keyframes yanta-cite-pulse {
  50% { opacity: 0.45; }
}

.yanta-ai-cite {
  font-size: 0.72em;
  font-weight: 650;
  padding: 0 2px;
  border-radius: 4px;
  cursor: help;
}

.yanta-ai-cite.ok { color: var(--success, #3fb950); }
.yanta-ai-cite.bad {
  color: var(--warning, #d29922);
  background: color-mix(in srgb, var(--warning, #d29922) 14%, transparent);
}
.yanta-ai-cite.pending { color: var(--text-faint); animation: yanta-cite-pulse 1.4s ease-in-out infinite; }
.yanta-ai-cite.unknown, .yanta-ai-cite.plain { color: var(--text-faint); }

.yanta-ai-citecheck > summary::-webkit-details-marker {
  display: none;
}

.yanta-ai-citecheck.ok > summary { color: var(--success, #3fb950); }
.yanta-ai-citecheck.bad > summary { color: var(--warning, #d29922); }
.yanta-ai-citecheck.pending > summary,
.yanta-ai-citecheck.unknown > summary { color: var(--text-dim); }

.yanta-ai-citecheck-list {
  margin: 8px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
}

.yanta-ai-citecheck-claim {
  display: flex;
  gap: 6px;
  align-items: baseline;
  color: var(--text-dim);
}

.yanta-ai-citecheck-list li.bad .yanta-ai-citecheck-claim svg { color: var(--warning, #d29922); }
.yanta-ai-citecheck-list li.ok .yanta-ai-citecheck-claim svg { color: var(--success, #3fb950); }

.yanta-ai-citecheck blockquote {
  margin: 4px 0;
  padding-left: 8px;
  border-left: 2px solid var(--border);
  font-style: italic;
}

.yanta-ai-citecheck-note {
  margin: 8px 0 0;
  font-size: 11px;
}

.yanta-ai-msg.tool.yanta-ai-activity {
  padding: 0;
  font-size: 12.5px;
  color: var(--text-faint);
}

.yanta-ai-activity > summary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  list-style: none;
  padding: 4px 10px 4px 6px;
  border-radius: 999px;
  max-width: 100%;
}

.yanta-ai-activity > summary::-webkit-details-marker {
  display: none;
}

.yanta-ai-activity > summary:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text-dim);
}

.yanta-ai-activity-icon {
  display: inline-flex;
  color: var(--accent);
}

.yanta-ai-activity.has-error .yanta-ai-activity-icon,
.yanta-ai-activity-err {
  color: var(--warning, #d29922);
}

.yanta-ai-activity-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanta-ai-activity-count {
  opacity: 0.7;
  white-space: nowrap;
}

.yanta-ai-activity[open] > summary > svg:last-child {
  transform: rotate(180deg);
}

.yanta-ai-activity-body {
  display: grid;
  gap: 8px;
  margin-top: 6px;
}

.yanta-ai-msg.summary {
  background: transparent;
  padding: 0;
  width: 100%;
}

.yanta-ai-summary {
  border-top: 1px dashed var(--border);
  border-bottom: 1px dashed var(--border);
  padding: 6px 2px;
  color: var(--text-faint);
  font-size: 12px;
}

.yanta-ai-summary > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
}

.yanta-ai-summary > summary::-webkit-details-marker {
  display: none;
}

.yanta-ai-summary-body {
  margin-top: 8px;
  color: var(--text-dim);
  font-size: 13px;
}

.yanta-ai-msg-role {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  margin-bottom: 6px;
}

.yanta-ai-msg-content {
  font-size: 14px;
  line-height: 1.55;
}

.yanta-ai-msg pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 11px;
  margin: 0;
  color: var(--text-dim);
}

.yanta-ai-foot {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yanta-ai-floating {
  position: fixed;
  z-index: 260;
  width: min(680px, calc(100vw - 20px));
  height: min(760px, calc(100dvh - 20px));
  min-width: min(360px, calc(100vw - 20px));
  min-height: min(420px, calc(100dvh - 20px));
  resize: both;
  overflow: hidden;

  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--bg-elev);
  box-shadow: 0 24px 90px rgba(0,0,0,0.48);
}

.yanta-ai-floating[hidden] {
  display: none !important;
}

.yanta-ai-floating-body {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.yanta-ai-floating.is-dragging {
  user-select: none;
}

.yanta-ai-floating .yanta-ai-head {
  cursor: move;
}

.yanta-ai-side-pane .yanta-side-pane-body {
  padding: 0 !important;
}

.yanta-ai-side-pane .yanta-ai-root {
  border-radius: 0;
}

::view-transition-old(yanta-ai-assistant),
::view-transition-new(yanta-ai-assistant) {
  animation-duration: 210ms;
  animation-timing-function: cubic-bezier(.2,.8,.2,1);
}

@media (max-width: 880px) {
  .yanta-ai-root {
    height: 100%;
    max-height: 100%;
    min-height: 0;
  }

  .yanta-ai-head {
    min-height: 48px;
    padding:
      max(8px, env(safe-area-inset-top))
      max(10px, env(safe-area-inset-right))
      8px
      max(10px, env(safe-area-inset-left));
  }

  .yanta-ai-settings-grid {
    grid-template-columns: 1fr;
  }

  .yanta-ai-settings-grid .wide {
    grid-column: auto;
  }

  .yanta-ai-foot {
    padding:
      10px
      max(10px, env(safe-area-inset-right))
      max(10px, env(safe-area-inset-bottom))
      max(10px, env(safe-area-inset-left));
  }

  .yanta-ai-input {
    max-height: 32dvh;
  }

  .yanta-ai-floating {
    left: 0 !important;
    top: 0 !important;
    right: auto !important;
    bottom: auto !important;

    width: 100vw !important;
    height: 100dvh !important;
    max-width: 100vw !important;
    max-height: 100dvh !important;

    min-width: 0 !important;
    min-height: 0 !important;

    resize: none !important;

    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }

  @supports (height: 100svh) {
    .yanta-ai-floating {
      height: 100svh !important;
      max-height: 100svh !important;
    }
  }

  .yanta-ai-floating-body {
    height: 100%;
    min-height: 0;
  }
}

.yanta-ai-settings-section-sub {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.yanta-ai-permission.compact {
  padding: 7px 9px;
  margin-bottom: 0;
}

.yanta-ai-agent-status {
  margin: 8px 0;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 12px;
}

.yanta-ai-agent-status.connected {
  border-color: color-mix(in srgb, var(--green) 45%, var(--border));
  color: var(--green);
}

.yanta-ai-agent-readme {
  margin-top: 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  resize: vertical;
}

.yanta-ai-rich {
  font-size: 14px;
  line-height: 1.55;
}

.yanta-ai-rich p {
  margin: 0.35em 0;
}

.yanta-ai-rich h1,
.yanta-ai-rich h2,
.yanta-ai-rich h3,
.yanta-ai-rich h4 {
  margin: 0.8em 0 0.35em;
  line-height: 1.25;
}

.yanta-ai-rich h1 {
  font-size: 1.35em;
}

.yanta-ai-rich h2 {
  font-size: 1.2em;
}

.yanta-ai-rich h3 {
  font-size: 1.08em;
}

.yanta-ai-rich ul,
.yanta-ai-rich ol {
  margin: 0.45em 0 0.45em 1.35em;
  padding: 0;
}

.yanta-ai-rich li {
  margin: 0.25em 0;
}

.yanta-ai-rich code {
  font-family: var(--font-mono);
  font-size: 0.92em;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0.08em 0.32em;
}

.yanta-ai-rich pre {
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--bg);
  overflow: auto;
}

.yanta-ai-rich pre code {
  border: 0;
  background: transparent;
  padding: 0;
}

.yanta-ai-rich strong {
  color: var(--text);
}

.yanta-ai-rich a {
  color: var(--accent);
  cursor: pointer;
}

.yanta-ai-rich .wiki-link {
  display: inline-flex;
  align-items: center;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 5px;
  padding: 0 4px;
  text-decoration: none;
}

.yanta-ai-rich .wiki-link.missing {
  color: var(--text-dim);
  background: color-mix(in srgb, var(--text-faint) 10%, transparent);
  text-decoration: underline dotted;
}

.yanta-ai-link-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.yanta-ai-link-card {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 11px;

  border: 1px solid color-mix(in srgb, var(--ai-card-color, var(--accent)) 35%, var(--border));
  border-radius: 11px;

  background: color-mix(in srgb, var(--ai-card-color, var(--accent)) 8%, var(--bg-elev-2));
  color: var(--text);

  cursor: pointer;
  text-align: left;

  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    transform 120ms ease;
}

.yanta-ai-link-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--ai-card-color, var(--accent)) 65%, var(--border));
  background: color-mix(in srgb, var(--ai-card-color, var(--accent)) 13%, var(--bg-elev-2));
}

.yanta-ai-link-card-icon {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  color: var(--ai-card-color, var(--accent));
  background: color-mix(in srgb, var(--ai-card-color, var(--accent)) 14%, transparent);
}

.yanta-ai-link-card-main {
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yanta-ai-link-card-main strong {
  color: var(--text);
  font-size: 13px;
  line-height: 1.25;
}

.yanta-ai-link-card-main small {
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.3;
}

.yanta-ai-link-card-excerpt {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Several cards: compact rows, two columns where there is room. */
.yanta-ai-msg.assistant:has(.yanta-ai-link-cards.is-compact) {
  width: 100%;
}

.yanta-ai-link-cards.is-compact small.is-empty {
  display: none;
}

.yanta-ai-link-cards.is-compact {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 6px;
}

.yanta-ai-link-cards.is-compact .yanta-ai-link-card {
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border-radius: 9px;
}

.yanta-ai-link-cards.is-compact .yanta-ai-link-card:hover {
  transform: none;
}

.yanta-ai-link-cards.is-compact .yanta-ai-link-card-icon {
  width: 24px;
  height: 24px;
  flex-basis: 24px;
}

.yanta-ai-link-cards.is-compact .yanta-ai-link-card-icon svg {
  width: 14px;
  height: 14px;
}

.yanta-ai-link-cards.is-compact .yanta-ai-link-card-main {
  gap: 1px;
}

.yanta-ai-link-cards.is-compact .yanta-ai-link-card-main strong,
.yanta-ai-link-cards.is-compact .yanta-ai-link-card-main small {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yanta-ai-link-cards.is-compact .yanta-ai-link-card-main strong {
  font-size: 12.5px;
}

.yanta-ai-link-cards-more {
  border: 1px dashed var(--border);
  border-radius: 9px;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  padding: 6px 9px;
  cursor: pointer;
}

.yanta-ai-link-cards-more:hover {
  color: var(--text);
  border-color: var(--text-faint);
}

.yanta-ai-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 10px;
}

.yanta-ai-chip {
  border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border));
  border-radius: 999px;

  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
  color: var(--accent);

  padding: 6px 10px;

  font-size: 12px;
  font-weight: 650;

  cursor: pointer;

  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    transform 120ms ease;
}

.yanta-ai-chip:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-elev-2));
  border-color: color-mix(in srgb, var(--accent) 65%, var(--border));
}

@keyframes yanta-ai-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes yanta-ai-dot {
  0%, 80%, 100% {
    opacity: 0.25;
    transform: translateY(0);
  }

  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@keyframes yanta-ai-bar {
  0% {
    transform: translateX(-100%);
  }

  55% {
    transform: translateX(35%);
  }

  100% {
    transform: translateX(130%);
  }
}

.yanta-ai-spinner {
  width: 18px;
  height: 18px;

  display: inline-block;
  flex: 0 0 auto;

  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
  border-top-color: var(--accent);

  animation: yanta-ai-spin 0.75s linear infinite;
}

.yanta-ai-spinner.small {
  width: 14px;
  height: 14px;
  border-width: 2px;
}

.yanta-ai-working-msg {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
}

.yanta-ai-working {
  display: flex;
  align-items: center;
  gap: 9px;

  color: var(--text);
  font-size: 13px;
  font-weight: 650;
}

.yanta-ai-working-text {
  min-width: 0;
}

.yanta-ai-working-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 1px;
}

.yanta-ai-working-dots span {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--accent);
  opacity: 0.4;

  animation: yanta-ai-dot 1.05s ease-in-out infinite;
}

.yanta-ai-working-dots span:nth-child(2) {
  animation-delay: 0.14s;
}

.yanta-ai-working-dots span:nth-child(3) {
  animation-delay: 0.28s;
}

.yanta-ai-working-bar {
  position: relative;
  height: 3px;
  margin-top: 10px;

  overflow: hidden;
  border-radius: 999px;

  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.yanta-ai-working-bar span {
  position: absolute;
  inset: 0 auto 0 0;
  width: 52%;

  border-radius: inherit;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--accent) 80%, white),
    transparent
  );

  animation: yanta-ai-bar 1.35s cubic-bezier(.2,.8,.2,1) infinite;
}


.yanta-ai-tool-box {
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;

  background: var(--bg);
}

.yanta-ai-tool-box.is-ok {
  border-color: color-mix(in srgb, var(--green) 28%, var(--border));
}

.yanta-ai-tool-box.is-error {
  border-color: color-mix(in srgb, var(--red) 45%, var(--border));
  background: color-mix(in srgb, var(--red) 5%, var(--bg));
}

.yanta-ai-tool-head {
  display: flex;
  align-items: center;
  gap: 8px;

  min-height: 38px;
  padding: 8px 10px;

  background: var(--bg-elev-2);
  border-bottom: 1px solid var(--border);
}

.yanta-ai-tool-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.yanta-ai-tool-box.is-error .yanta-ai-tool-icon {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 14%, transparent);
}

.yanta-ai-tool-title {
  flex: 1;
  min-width: 0;

  color: var(--text);
  font-size: 12px;
  font-weight: 800;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-ai-tool-status {
  flex: 0 0 auto;

  padding: 2px 7px;
  border-radius: 999px;

  color: var(--green);
  background: color-mix(in srgb, var(--green) 12%, transparent);

  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.yanta-ai-tool-box.is-error .yanta-ai-tool-status {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 13%, transparent);
}

.yanta-ai-tool-summary {
  padding: 10px 11px;

  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-ai-tool-list {
  display: flex;
  flex-direction: column;
  gap: 5px;

  padding: 0 9px 9px;
}

.yanta-ai-tool-row {
  width: 100%;

  display: flex;
  align-items: flex-start;
  gap: 8px;

  padding: 8px 9px;

  border: 1px solid var(--border);
  border-radius: 9px;

  background: var(--bg-elev);
  color: var(--text);

  cursor: pointer;
  text-align: left;

  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    transform 120ms ease;
}

.yanta-ai-tool-row:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
  background: var(--bg-elev-2);
}

.yanta-ai-tool-row-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  color: var(--accent);
}

.yanta-ai-tool-row-main {
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-ai-tool-row-main strong {
  color: var(--text);
  font-size: 12px;
  line-height: 1.25;
}

.yanta-ai-tool-row-main small,
.yanta-ai-tool-row-main span,
.yanta-ai-tool-row-main em {
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.35;
  font-style: normal;
  overflow-wrap: anywhere;
}

.yanta-ai-tool-row-main em {
  color: var(--text-faint);
  font-family: var(--font-mono);
}

.yanta-ai-tool-more {
  padding: 5px 9px;

  color: var(--text-faint);
  font-size: 11px;
  font-style: italic;
}

.yanta-ai-tool-details {
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
}

.yanta-ai-tool-details summary {
  padding: 8px 11px;

  color: var(--text-faint);
  font-size: 11px;

  cursor: pointer;
  user-select: none;
}

.yanta-ai-tool-details summary:hover {
  color: var(--text-dim);
}

.yanta-ai-tool-details pre {
  max-height: 320px;
  overflow: auto;

  margin: 0;
  padding: 10px 11px;

  border-top: 1px solid var(--border);

  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;

  white-space: pre-wrap;
  overflow-wrap: anywhere;

  background: var(--bg);
}

@media (prefers-reduced-motion: reduce) {
  .yanta-ai-spinner,
  .yanta-ai-working-dots span,
  .yanta-ai-working-bar span {
    animation: none !important;
  }
}

.yanta-ai-location-grid {
  display: grid;
  grid-template-columns: 1fr 150px;
  gap: 10px;
  margin-top: 10px;
}

.yanta-ai-location-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.yanta-ai-location-grid .wide {
  min-width: 0;
}

.yanta-ai-location-state {
  margin-top: 10px;
  padding: 8px 10px;

  display: flex;
  align-items: center;
  gap: 8px;

  border: 1px solid var(--border);
  border-radius: 8px;

  background: var(--bg-elev-2);
  color: var(--text-dim);

  font-size: 12px;
}

.yanta-ai-location-state.error {
  border-color: color-mix(in srgb, var(--red) 45%, var(--border));
  color: var(--red);
  background: color-mix(in srgb, var(--red) 8%, transparent);
}

.yanta-ai-location-results {
  display: flex;
  flex-direction: column;
  gap: 6px;

  margin-top: 10px;
}

.yanta-ai-location-result {
  width: 100%;

  display: flex;
  align-items: center;
  gap: 10px;

  padding: 9px 10px;

  border: 1px solid var(--border);
  border-radius: 9px;

  background: var(--bg-elev-2);
  color: var(--text);

  text-align: left;
  cursor: pointer;
}

.yanta-ai-location-result:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
}

.yanta-ai-location-result-main {
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-ai-location-result-main strong {
  font-size: 12px;
  color: var(--text);
}

.yanta-ai-location-result-main small {
  font-size: 11px;
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

@media (max-width: 880px) {
  .yanta-ai-location-grid {
    grid-template-columns: 1fr;
  }
}

.yanta-ai-root.is-ai-context-dragover {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.yanta-ai-root.is-ai-context-dragover::after {
  content: attr(data-ai-drop-label);

  position: absolute;
  inset: 54px 12px 86px;
  z-index: 20;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 2px dashed var(--accent);
  border-radius: 16px;

  background: color-mix(in srgb, var(--accent) 12%, var(--bg-elev));
  color: var(--accent);

  font-size: 14px;
  font-weight: 850;

  pointer-events: none;
}

.yanta-ai-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-ai-input-shell {
  display: grid;
  align-items: end;
  gap: 4px;

  /* Standard: 1-Zeilen Modus (Buttons links/rechts, Text in der Mitte) */
  grid-template: 
    "leading-actions text-input trailing-actions" 1fr 
    / auto 1fr auto;

  border: 1px solid var(--border);
  border-radius: 26px;
  background: var(--bg-elev);
  padding: 6px;

  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

/* Multiline: Text nimmt die erste Row komplett ein, Buttons in der zweiten Row */
.yanta-ai-input-shell.is-multiline {
  grid-template: 
    "text-input text-input text-input" auto 
    "leading-actions leading-actions trailing-actions" 1fr 
    / 1fr 1fr auto;
}

.yanta-ai-input-shell:focus-within {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
}

.yanta-ai-input-btn {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);

  cursor: pointer;
  user-select: none;

  transition:
    background-color 120ms ease,
    color 120ms ease,
    transform 120ms ease,
    box-shadow 120ms ease;
}

.yanta-ai-plus {
  grid-area: leading-actions;
  justify-self: start;
}

.yanta-ai-plus:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}

.yanta-ai-plus:active {
  transform: scale(0.94);
}

.yanta-ai-send {
  grid-area: trailing-actions;
  justify-self: end;
  background: var(--accent);
  color: #fff;
}

.yanta-ai-send:hover:not(:disabled):not(.is-working) {
  background: color-mix(in srgb, var(--accent) 88%, white);
  transform: scale(1.04);
}

.yanta-ai-send:active:not(:disabled) {
  transform: scale(0.96);
}

.yanta-ai-send:disabled {
  background: color-mix(in srgb, var(--text-faint) 22%, transparent);
  color: var(--text-faint);
  cursor: default;
}

.yanta-ai-send.is-working {
  background: var(--bg-elev-2);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--border);
}

.yanta-ai-send.is-working:hover {
  background: color-mix(in srgb, var(--red) 14%, var(--bg-elev-2));
  color: var(--red);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--red) 40%, var(--border));
}

.yanta-ai-input {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  line-height: 1.5;

  padding: 6px 6px;
  resize: none;
  outline: none;

  min-height: 36px;
  max-height: 220px;
  overflow-y: auto;

  grid-area: text-input;
  align-content: center;
}

.yanta-ai-input::placeholder {
  color: var(--text-faint);
}

.yanta-ai-context-tray {
  display: flex;
  flex-direction: column;
  gap: 7px;

  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 11px;

  background: var(--bg-elev);
}

.yanta-ai-context-tray[hidden] {
  display: none !important;
}

.yanta-ai-context-tray-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  color: var(--text-dim);
  font-size: 11px;
}

.yanta-ai-context-tray-head span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.yanta-ai-context-tray-head strong {
  color: var(--text);
}

.yanta-ai-context-clear {
  border: 0;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 11px;
}

.yanta-ai-context-clear:hover {
  color: var(--red);
}

.yanta-ai-context-warning {
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--yellow) 40%, var(--border));
  background: color-mix(in srgb, var(--yellow) 8%, transparent);
  color: var(--yellow);
  font-size: 11px;
  line-height: 1.35;
}

.yanta-ai-context-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.yanta-ai-context-chip {
  min-width: min(220px, 100%);
  max-width: 100%;
  max-width: 24em;

  display: inline-grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;

  padding: 6px 6px 6px 8px;

  border: 1px solid var(--border);
  border-radius: 999px;

  background: var(--bg-elev-2);
  color: var(--text);
}

.yanta-ai-context-chip.is-error {
  border-color: color-mix(in srgb, var(--red) 45%, var(--border));
}

.yanta-ai-context-chip.is-warn {
  border-color: color-mix(in srgb, var(--yellow) 45%, var(--border));
}

.yanta-ai-context-chip-icon {
  display: inline-flex;
  color: var(--accent);
}

.yanta-ai-context-chip-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.yanta-ai-context-chip-main strong {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  font-size: 11px;
  line-height: 1.1;
}

.yanta-ai-context-chip-main small {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  color: var(--text-faint);
  font-size: 10px;
  line-height: 1.1;
}

.yanta-ai-context-meter {
  min-height: 15px;
  padding: 0 8px 1px;
  margin-top: auto;

  color: var(--text-faint);
  font-size: 10.5px;
  line-height: 1.35;
  text-align: end;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  user-select: none;
}

.yanta-ai-context-meter[hidden] {
  display: none !important;
}

.yanta-ai-context-meter:hover {
  color: var(--text-dim);
}


/* Markdown tables inside AI chat */
.yanta-ai-rich .md-table-wrap {
  max-width: min(100%, calc(100vw - 48px));
}

.yanta-ai-rich .md-table {
  font-size: 12px;
}

.yanta-ai-thinking {
  margin: 0 0 7px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  overflow: hidden;
}

.yanta-ai-thinking summary {
  width: fit-content;
  min-height: 24px;
  padding: 3px 7px;

  display: inline-flex;
  align-items: center;
  gap: 5px;

  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  color: var(--text-faint);

  font-size: 10.5px;
  font-weight: 750;
  cursor: pointer;
  user-select: none;
}

.yanta-ai-thinking summary:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.yanta-ai-thinking pre {
  max-height: 220px;
  overflow: auto;
  margin: 6px 0 0;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.yanta-ai-working-thinking {
  margin-top: 8px;
  border: 0;
}

.yanta-ai-working-thinking summary {
  width: fit-content;
  min-height: 24px;
  padding: 3px 7px;

  display: inline-flex;
  align-items: center;
  gap: 5px;

  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text-faint);

  font-size: 10.5px;
  font-weight: 750;
  cursor: pointer;
  user-select: none;
}

.yanta-ai-working-thinking summary:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}

.yanta-ai-working-thinking pre {
  max-height: 190px;
  overflow: auto;
  margin: 6px 0 0;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.yanta-ai-approval-card {
  width: min(560px, 94vw);
}

.yanta-ai-approval-main {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: start;
}

.yanta-ai-approval-icon {
  width: 38px;
  height: 38px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;
  color: var(--yellow);
  background: color-mix(in srgb, var(--yellow) 14%, transparent);
}

.yanta-ai-approval-main strong {
  color: var(--text);
  font-size: 14px;
}

.yanta-ai-approval-main p {
  margin: 6px 0 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-ai-approval-details {
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
  overflow: hidden;
}

.yanta-ai-approval-details summary {
  padding: 8px 10px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 750;
}

.yanta-ai-approval-details pre,
.yanta-ai-approval-details p {
  margin: 0;
  padding: 10px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.yanta-ai-approval-actions {
  margin-top: 14px;
}

/* Compact expandable web/search results */
.yanta-ai-tool-expandable-results {
  margin: 0 9px 9px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev);
  overflow: hidden;
}

.yanta-ai-tool-expandable-results summary {
  min-height: 38px;
  padding: 7px 9px;

  display: flex;
  align-items: center;
  gap: 8px;

  cursor: pointer;
  user-select: none;
  list-style: none;

  mask-image: linear-gradient(to right, black 90%, transparent);
  -webkit-mask-image: linear-gradient(to right, black 90%, transparent);
}

.yanta-ai-tool-expandable-results summary::-webkit-details-marker {
  display: none;
}

.yanta-ai-tool-expandable-results summary:hover {
  background: var(--bg-elev-2);
}

.yanta-ai-results-summary-label {
  flex: 0 0 auto;

  display: inline-flex;
  align-items: center;
  gap: 5px;

  color: var(--text-dim);
  font-size: 11px;
  font-weight: 800;
}

.yanta-ai-result-chips {
  flex: 1;
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 6px;

  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.yanta-ai-result-chips::-webkit-scrollbar {
  display: none;
}

.yanta-ai-result-chip {
  max-width: 220px;
  flex: 0 0 auto;

  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: 999px;

  background: color-mix(in srgb, var(--accent) 7%, transparent);
  color: var(--text-dim);

  font-size: 11px;
  line-height: 1.25;

  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-ai-tool-expandable-results[open] summary {
  border-bottom: 1px solid var(--border);
}

.yanta-ai-expanded-result-list {
  padding-top: 9px;
}

/* AI code copy UX */
.yanta-ai-codeblock {
  position: relative;
}

.yanta-ai-copy-btn {
  position: relative;

  width: 26px;
  height: 26px;
  flex: 0 0 26px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 1px solid var(--border);
  border-radius: 8px;

  background: color-mix(in srgb, var(--bg-elev-2) 92%, transparent);
  color: var(--text-faint);

  cursor: pointer;

  transition:
    transform 140ms ease,
    color 140ms ease,
    border-color 140ms ease,
    background-color 140ms ease;
}

.yanta-ai-copy-btn:hover {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
  transform: translateY(-1px);
}

.yanta-ai-copy-btn:active {
  transform: scale(0.94);
}

.yanta-ai-copy-btn.block {
  position: absolute;
  top: 7px;
  right: 7px;
  z-index: 2;

  opacity: 0;
  transform: translateY(-2px) scale(0.98);
}

.yanta-ai-codeblock:hover .yanta-ai-copy-btn.block,
.yanta-ai-codeblock:focus-within .yanta-ai-copy-btn.block,
.yanta-ai-copy-btn.block.is-copied {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.yanta-ai-inline-code-wrap {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  vertical-align: baseline;
}

.yanta-ai-copy-btn.inline {
  width: 20px;
  height: 20px;
  border-radius: 6px;

  opacity: 0;
  transform: scale(0.88);
}

.yanta-ai-copy-icon {
  position: absolute;
  inset: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  transition:
    opacity 140ms ease,
    transform 180ms cubic-bezier(.2,.9,.2,1);
}

.yanta-ai-copy-icon.check {
  opacity: 0;
  color: var(--green);
  transform: scale(0.45) rotate(-18deg);
}

.yanta-ai-copy-btn.is-copied {
  color: var(--green);
  border-color: color-mix(in srgb, var(--green) 55%, var(--border));
  background: color-mix(in srgb, var(--green) 11%, var(--bg-elev-2));
}

.yanta-ai-copy-btn.is-copied .yanta-ai-copy-icon.copy {
  opacity: 0;
  transform: scale(0.5) rotate(18deg);
}

.yanta-ai-copy-btn.is-copied .yanta-ai-copy-icon.check {
  opacity: 1;
  transform: scale(1) rotate(0deg);
}

@media (hover: none) {
  .yanta-ai-copy-btn.block,
  .yanta-ai-copy-btn.inline {
    opacity: 1;
    transform: none;
  }
}

/* ============================================================
   AI inline code copy — overlay, no text reflow
   ============================================================ */

/* Code should not be visually smaller than surrounding answer text. */
.yanta-ai-rich code {
  font-size: 1em;
  line-height: inherit;
}

/*
  Override previous inline-flex behavior:
  The copy button is now an overlay pinned to the end of the code span.
  It does not participate in text layout and therefore does not push text.
*/
.yanta-ai-inline-code-wrap {
  position: relative;
  display: inline;
  vertical-align: baseline;
}

/* Make the wrapped inline code a stable positioning surface. */
.yanta-ai-inline-code-wrap > code {
  position: relative;
  display: inline;
}

/* The inline copy button floats over the end of the code token. */
.yanta-ai-copy-btn.inline {
  position: absolute;
  right: -7px;
  top: 50%;
  z-index: 3;

  width: 20px;
  height: 20px;
  min-width: 20px;

  padding: 0;
  margin: 0;

  border-radius: 999px;

  opacity: 0;
  transform: translateY(-50%) scale(0.82);

  box-shadow:
    0 4px 14px rgba(0,0,0,0.28),
    0 0 0 1px rgba(255,255,255,0.03) inset;

  backdrop-filter: blur(7px);
  -webkit-backdrop-filter: blur(7px);
}

/*
  No layout shift:
  hover/focus changes only opacity/transform, not dimensions or display.
*/
.yanta-ai-inline-code-wrap:hover .yanta-ai-copy-btn.inline,
.yanta-ai-inline-code-wrap:focus-within .yanta-ai-copy-btn.inline,
.yanta-ai-copy-btn.inline.is-copied {
  opacity: 1;
  translateY(-50%) translateX(40%) scale(1)
}

/* Avoid the button being visually buried by following text. */
.yanta-ai-inline-code-wrap:hover,
.yanta-ai-inline-code-wrap:focus-within {
  z-index: 4;
}

/* On touch devices the button is visible but still overlay-only. */
@media (hover: none) {
  .yanta-ai-copy-btn.inline {
    opacity: 0.9;
    transform: translateY(-50%) scale(1);
    display: none;
  }
}

.yanta-ai-copy-btn.block {
  opacity: 0;
}

.yanta-ai-codeblock:hover .yanta-ai-copy-btn.block,
.yanta-ai-codeblock:focus-within .yanta-ai-copy-btn.block,
.yanta-ai-copy-btn.block.is-copied {
  opacity: 1;
}
`;

  document.head.append(style);
}
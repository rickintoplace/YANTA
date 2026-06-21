// ============================================================
// YANTA AI — Assistant UI
//
// Modes:
// - side pane
// - detached movable floating window
//
// Uses View Transition API for dock/undock when available.
// ============================================================

import {
  escapeHtml,
  toast,
  lucide,
  state,
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
} from './openrouter-client.js';

import {
  openAiToolsForModel,
  executeToolCall,
} from './tool-registry.js';

import {
  buildSystemMessage,
  buildContextMessage,
} from './context-builder.js';

import {
  renderBlocksInline,
} from '../markdown.js';

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
let activeContextItems = [];
let contextTrayEl = null;
let currentSessionId = '';
let sessionSaveTimer = 0;

let abortController = null;
let settingsOpen = false;

let assistantBusy = false;
let assistantBusyLabel = 'Thinking…';
let assistantBusySince = 0;

const VT_NAME = 'yanta-ai-assistant';

const AI_FULLSCREEN_OVERLAY_ID = 'ai-fullscreen';
const AI_SETTINGS_OVERLAY_ID = 'ai-settings';

const AI_CHAT_TRANSIENT_KEY = 'yanta.ai.chat.transient.v1';
const AI_CHAT_TRANSIENT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const AI_CHAT_MAX_MESSAGES = 120;
const AI_CHAT_MAX_CHARS = 240000;

function supportsViewTransition() {
  return !!document.startViewTransition &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function isMobileAssistantViewport() {
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

  if (!['user', 'assistant', 'tool'].includes(role)) return null;

  return {
    role,
    content: String(msg.content || ''),
    toolName: msg.toolName || undefined,
    model: msg.model || undefined,
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

  root.innerHTML = `
    <header class="yanta-ai-head" data-ai-drag-handle>
      <div class="yanta-ai-title">
        ${lucide('bot', 17)}
        <strong>YANTA AI</strong>
      </div>

      <button class="icon-btn" data-ai-settings title="AI settings">
        ${lucide('settings', 16)}
      </button>

      <button class="icon-btn" data-ai-detach title="Detach assistant">
        ${lucide('picture-in-picture-2', 16)}
      </button>

      <button class="icon-btn" data-ai-clear title="Clear chat">
        ${lucide('trash', 16)}
      </button>

      <button class="icon-btn" data-ai-close title="Close assistant">
        ${lucide('x', 16)}
      </button>
    </header>

    <section class="yanta-ai-settings" data-ai-settings-panel hidden></section>

    <main class="yanta-ai-messages" data-ai-messages></main>

    <footer class="yanta-ai-foot">
      <div class="yanta-ai-context-tray" data-ai-context-tray hidden></div>

      <div class="yanta-ai-input-shell" data-ai-input-shell>
        <button class="yanta-ai-input-btn yanta-ai-plus" data-ai-add-context title="Add context" aria-label="Add context">
          ${lucide('plus', 18)}
        </button>

        <textarea
          class="yanta-ai-input"
          data-ai-input
          rows="1"
          placeholder="Ask about your notes, files, drawings or calendar…"
          enterkeyhint="send"></textarea>

        <button class="yanta-ai-input-btn yanta-ai-send" data-ai-send title="Send" aria-label="Send message" disabled>
          ${lucide('arrow-up', 18)}
        </button>
      </div>
    </footer>
  `;

  messagesEl = root.querySelector('[data-ai-messages]');
  contextTrayEl = root.querySelector('[data-ai-context-tray]');
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
    conversation = [];
    currentSessionId = '';
    activeContextItems = [];
    clearTransientConversation();
    renderMessages();
    renderContextTray();
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
      toast('AI chat action failed', 'error');
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
    btn.title = 'Dock assistant to side pane';
    btn.innerHTML = lucide('panel-right', 16);
  } else {
    btn.title = 'Detach assistant';
    btn.innerHTML = lucide('picture-in-picture-2', 16);
  }
}

function updateCloseButton() {
  const btn = root?.querySelector('[data-ai-close]');
  if (!btn) return;

  if (settingsOpen) {
    btn.title = 'Back to chat';
    btn.setAttribute('aria-label', 'Back to chat');
    btn.innerHTML = lucide('arrow-left', 16);
  } else {
    btn.title = 'Close assistant';
    btn.setAttribute('aria-label', 'Close assistant');
    btn.innerHTML = lucide('x', 16);
  }
}

function createFloatingShell() {
  if (floatingShell) return floatingShell;

  floatingShell = document.createElement('div');
  floatingShell.className = 'yanta-ai-floating';
  floatingShell.hidden = true;
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
      title: 'Assistant',
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

function scheduleAiSessionSave() {
  clearTimeout(sessionSaveTimer);

  sessionSaveTimer = window.setTimeout(() => {
    saveCurrentAiSession().catch((err) => {
      console.warn('[YANTA AI] session save failed', err);
    });
  }, 700);
}

async function saveCurrentAiSession() {
  if (!conversation.length && !activeContextItems.length) return;

  const model = getAiSettings().model || '';

  if (!currentSessionId) {
    currentSessionId = await createAiSession({
      messages: conversation,
      contextItems: activeContextItems,
      model,
    });
  }

  await saveAiSession(currentSessionId, {
    messages: conversation,
    contextItems: activeContextItems,
    model,
  });
}

async function openAiSession(sessionId) {
  const session = await loadAiSession(sessionId);

  currentSessionId = session.id;
  conversation = session.messages || [];
  activeContextItems = session.contextItems || [];

  await openAssistantSmart();

  renderMessages();
  renderContextTray();

  toast('AI session opened', 'success');
}

async function addAiContextRefs(refs = []) {
  const items = await createAiContextItemsFromRefs(refs);

  activeContextItems = mergeContextItems(activeContextItems, items);

  renderContextTray();
  scheduleAiSessionSave();

  const totals = aiContextTotals(items);
  toast(
    `Added ${items.length} context item${items.length === 1 ? '' : 's'} · ${totals.words.toLocaleString()} words`,
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
    `Added ${items.length} upload${items.length === 1 ? '' : 's'} · ${totals.words.toLocaleString()} words`,
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

function renderContextTray() {
  if (!contextTrayEl) return;

  const totals = aiContextTotals(activeContextItems);

  contextTrayEl.hidden = !activeContextItems.length;
  contextTrayEl.replaceChildren();

  if (!activeContextItems.length) return;

  const head = document.createElement('div');
  head.className = 'yanta-ai-context-tray-head';

  const nonMultimodalImages =
    totals.images > 0 && !modelSupportsImages(getEffectiveAiRuntimeSettings().model);

  head.innerHTML = `
    <span>
      ${lucide('paperclip', 13)}
      <strong>${totals.items}</strong> item${totals.items === 1 ? '' : 's'}
      · ${totals.words.toLocaleString()} words
      · ${totals.chars.toLocaleString()} chars
    </span>

    <button type="button" class="yanta-ai-context-clear" data-ai-clear-context>
      Clear
    </button>
  `;

  contextTrayEl.append(head);

  if (nonMultimodalImages) {
    const warn = document.createElement('div');
    warn.className = 'yanta-ai-context-warning';
    warn.textContent = 'Images are attached, but the selected model may not be multimodal. Non-multimodal models may ignore images.';
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
        <strong>${escapeHtml(item.title || 'Context item')}</strong>
        <small>${escapeHtml(contextItemStatsLabel(item))}</small>
      </span>

      <button type="button" class="icon-btn" data-ai-remove-context="${escapeHtml(item.id)}" title="Remove">
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
      return `${count.toLocaleString()} note${count === 1 ? '' : 's'} · ${base}`;
    }
  }

  return base;
}

function addMessage(role, content, extra = {}) {
  conversation.push({
    role,
    content: String(content || ''),
    ts: Date.now(),
    ...extra,
  });

  saveTransientConversation();
  scheduleAiSessionSave();
  renderMessages();
}

function setAssistantBusy(next, label = 'Thinking…') {
  assistantBusy = !!next;
  assistantBusyLabel = String(label || 'Thinking…');

  if (assistantBusy && !assistantBusySince) {
    assistantBusySince = Date.now();
  }

  if (!assistantBusy) {
    assistantBusySince = 0;
  }

  renderMessages();
}

function renderAssistantWorkingNode() {
  const node = document.createElement('div');
  node.className = 'yanta-ai-msg assistant yanta-ai-working-msg';

  node.innerHTML = `
    <div class="yanta-ai-msg-role">
      YANTA AI · ${escapeHtml(getAiSettings().model || 'LLM')}
    </div>

    <div class="yanta-ai-working">
      <span class="yanta-ai-spinner"></span>

      <span class="yanta-ai-working-text">
        ${escapeHtml(assistantBusyLabel || 'Thinking…')}
      </span>

      <span class="yanta-ai-working-dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
    </div>

    <div class="yanta-ai-working-bar">
      <span></span>
    </div>
  `;

  return node;
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
    search_notes: 'Search notes',
    read_note: 'Read note',
    read_notes: 'Read notes',
    create_note: 'Create note',
    update_note_appearance: 'Update note appearance',
    append_to_note: 'Append to note',
    replace_current_selection: 'Replace selection',
    delete_note: 'Delete note',

    search_events: 'Search calendar',
    create_event: 'Create event',
    update_event: 'Update event',
    update_event_appearance: 'Update event appearance',
    link_event_to_note: 'Link event to note',

    ai_brain_list: 'List AI Brain',
    ai_brain_read: 'Read AI Brain',
    ai_brain_search: 'Search AI Brain',
    ai_brain_write: 'Write AI Brain',

    get_weather: 'Weather',

  };

  return map[name] || name || 'Tool';
}

function summarizeToolResult(name, data, rawContent = '') {
  if (!data) {
    const text = String(rawContent || '').trim();

    return text
      ? text.slice(0, 160)
      : 'Tool returned no structured result.';
  }

  if (toolResultIsError(data)) {
    return data.error || data.message || 'Tool failed.';
  }

  if (name === 'search_events') {
    const events = Array.isArray(data) ? data : data.events || [];
    const range = data?.range;

    const rangeText = range?.start && range?.end
      ? ` · ${formatToolDate(range.start)} – ${formatToolDate(range.end)}`
      : '';

    return `${events.length} calendar item${events.length === 1 ? '' : 's'} found${rangeText}.`;
  }

  if (name === 'search_notes') {
    const notes = Array.isArray(data) ? data : data.notes || data.results || [];
    return `${notes.length} note${notes.length === 1 ? '' : 's'} found.`;
  }

  if (name === 'read_note') {
    return `Read note: ${data.title || data.id || 'Untitled'}.`;
  }

  if (name === 'read_notes') {
    const count = Array.isArray(data) ? data.length : toolResultCount(data);
    return `Read ${count || 0} note${count === 1 ? '' : 's'}.`;
  }

  if (name === 'create_note') {
    return `Created note: ${data.title || data.id || 'Untitled'}.`;
  }

  if (name === 'update_note_appearance') {
    const note = data.note || data;
    return `Updated note appearance: ${note.title || note.id || 'Untitled'}.`;
  }

  if (name === 'append_to_note') {
    return `Appended ${data.appendedChars || 0} characters to note.`;
  }

  if (name === 'replace_current_selection') {
    return `Replaced selection with ${data.insertedChars || 0} characters.`;
  }

  if (name === 'delete_note') {
    return `Moved note to Trash: ${data.title || data.trashedNoteId || 'Untitled'}.`;
  }

  if (name === 'create_event') {
    return `Created event: ${data.title || data.id || 'Untitled event'}.`;
  }

  if (name === 'update_event') {
    return `Updated event: ${data.title || data.id || 'event'}.`;
  }

  if (name === 'update_event_appearance') {
    const ev = data.event || data;
    const linked = data.linkedNoteUpdated
      ? ' Linked note appearance updated too.'
      : '';

    return `Updated event appearance: ${ev.title || ev.id || 'event'}.${linked}`;
  }

  if (name === 'link_event_to_note') {
    return data.ok
      ? 'Linked calendar event to note.'
      : 'Could not link calendar event to note.';
  }

  if (name === 'ai_brain_write') {
    return `Updated AI Brain: ${data.title || data.id || 'note'}.`;
  }

  if (name === 'ai_brain_search') {
    const count = Array.isArray(data) ? data.length : toolResultCount(data);
    return `${count || 0} AI Brain result${count === 1 ? '' : 's'} found.`;
  }

  if (name === 'ai_brain_list') {
    const noteCount = data.notes?.length || 0;
    const folderCount = data.folders?.length || 0;
    return `AI Brain contains ${noteCount} note${noteCount === 1 ? '' : 's'} and ${folderCount} folder${folderCount === 1 ? '' : 's'}.`;
  }

  if (name === 'get_weather') {
    const loc = data.location?.label || 'location';
    const temp = data.current?.temperatureC;
    const weather = data.current?.weather || 'weather';

    return `${weather} in ${loc}${temp != null ? ` · ${temp} °C` : ''}.`;
  }

  const count = toolResultCount(data);

  if (count != null) {
    return `${count} result${count === 1 ? '' : 's'}.`;
  }

  if (data.ok === true) return 'Completed successfully.';
  if (data.success === true) return 'Completed successfully.';

  return 'Tool completed.';
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

function renderToolMessageNode(msg) {
  const data = safeJsonForTool(msg.content);
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
        ${isError ? 'Failed' : 'Done'}
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
  summaryEl.textContent = 'Show raw result';

  const pre = document.createElement('pre');
  pre.textContent = data
    ? JSON.stringify(data, null, 2)
    : String(msg.content || '');

  details.append(summaryEl, pre);
  wrap.append(details);

  return wrap;
}

function renderToolRichContent(name, data) {
  if (!data) return null;

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
      more.textContent = `+ ${events.length - 8} more`;
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
      more.textContent = `+ ${notes.length - 8} more`;
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

  return null;
}

function renderToolEventRow(ev) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'yanta-ai-tool-row yanta-ai-tool-event-row';

  if (ev.id && ev.source !== 'markdown') {
    row.dataset.aiOpenEvent = ev.id;
  }

  const when = formatToolDateTime(ev.start, !!ev.allDay);
  const end = ev.end ? formatToolDateTime(ev.end, !!ev.allDay) : '';

  row.innerHTML = `
    <span class="yanta-ai-tool-row-icon">${lucide(ev.icon || 'calendar-days', 14)}</span>
    <span class="yanta-ai-tool-row-main">
      <strong>${escapeHtml(ev.title || 'Untitled event')}</strong>
      ${when ? `<small>${escapeHtml(when)}${end ? ` – ${escapeHtml(end)}` : ''}</small>` : ''}
      ${ev.location ? `<span>${escapeHtml(ev.location)}</span>` : ''}
      ${ev.noteId ? `<em>Linked note: ${escapeHtml(ev.noteId)}</em>` : ''}
    </span>
  `;

  return row;
}

function renderToolNoteRow(note) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'yanta-ai-tool-row yanta-ai-tool-note-row';

  if (note.id) {
    row.dataset.aiOpenNote = note.id;
  }

  row.innerHTML = `
    <span class="yanta-ai-tool-row-icon">${lucide(note.icon || 'file-text', 14)}</span>
    <span class="yanta-ai-tool-row-main">
      <strong>${escapeHtml(note.title || 'Untitled')}</strong>
      ${note.folderPath ? `<small>${escapeHtml(note.folderPath)}</small>` : ''}
      ${note.id ? `<em>${escapeHtml(note.id)}</em>` : ''}
    </span>
  `;

  return row;
}

function renderToolBrainRow(hit) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'yanta-ai-tool-row yanta-ai-tool-brain-row';

  if (hit.id) {
    row.dataset.aiOpenNote = hit.id;
  }

  row.innerHTML = `
    <span class="yanta-ai-tool-row-icon">${lucide('brain-circuit', 14)}</span>
    <span class="yanta-ai-tool-row-main">
      <strong>${escapeHtml(hit.title || 'AI Brain note')}</strong>
      ${hit.excerpt ? `<small>${escapeHtml(hit.excerpt)}</small>` : ''}
    </span>
  `;

  return row;
}

function renderMessages() {
  if (!messagesEl) return;

  messagesEl.replaceChildren();

  if (!conversation.length) {
    const empty = document.createElement('div');
    empty.className = 'yanta-ai-empty';
    empty.innerHTML = `
      <strong>Ask YANTA AI</strong>
      <p>Try: “Summarize this note”, “Look into these files”, “Create a project note”, or “Create an event tomorrow at 14:00”.</p>
    `;
    messagesEl.append(empty);
    return;
  }

  for (const msg of conversation) {
    const node = document.createElement('div');
    node.className = `yanta-ai-msg ${msg.role}`;

    const roleLabel = messageRoleLabel(msg);

    if (msg.toolName) {
      node.append(renderToolMessageNode(msg));
    } else if (msg.role === 'assistant') {
      node.append(renderAssistantMessageNode(msg));
    } else {
      node.innerHTML = `
        <div class="yanta-ai-msg-role">${escapeHtml(roleLabel)}</div>
        <div class="yanta-ai-msg-content">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
      `;
    }

    messagesEl.append(node);
  }

  if (assistantBusy) {
    messagesEl.append(renderAssistantWorkingNode());
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function messageRoleLabel(msg) {
  if (msg.role === 'assistant') {
    return `YANTA AI · ${msg.model || getAiSettings().model || 'LLM'}`;
  }

  if (msg.role === 'user') return 'You';
  if (msg.role === 'tool') return 'Tool';

  return msg.role || 'Message';
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

function renderAssistantMessageNode(msg) {
  const wrap = document.createElement('div');

  const role = document.createElement('div');
  role.className = 'yanta-ai-msg-role';
  role.textContent = messageRoleLabel(msg);
  wrap.append(role);

  const parsed = extractAssistantUiTokens(msg.content);

  const content = document.createElement('div');
  content.className = 'yanta-ai-msg-content yanta-ai-rich';

  if (parsed.text) {
    content.innerHTML = renderBlocksInline(parsed.text);
  } else if (!parsed.notes.length && !parsed.events.length && !parsed.chips.length) {
    content.textContent = '[No response]';
  }

  wrap.append(content);

  if (parsed.notes.length || parsed.events.length) {
    const cards = document.createElement('div');
    cards.className = 'yanta-ai-link-cards';

    for (const noteId of parsed.notes) {
      cards.append(renderAiNoteCard(noteId));
    }

    for (const eventId of parsed.events) {
      cards.append(renderAiEventCard(eventId));
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

function noteFolderPathForAi(folderId) {
  if (!folderId) return '';

  const parts = [];
  const seen = new Set();
  let f = state.folders.get(folderId);

  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    parts.unshift(f.name || 'Folder');
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  return parts.join(' / ');
}

function noteExcerptForAi(noteId) {
  try {
    const md = noteMarkdown(noteId);

    return String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
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
  card.className = 'yanta-ai-link-card yanta-ai-note-card';
  card.dataset.aiOpenNote = noteId;

  if (!note) {
    card.innerHTML = `
      <span class="yanta-ai-link-card-icon">${lucide('file-question', 18)}</span>
      <span class="yanta-ai-link-card-main">
        <strong>Note not found</strong>
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
      <strong>${escapeHtml(note.title || 'Untitled')}</strong>
      ${folder ? `<small>${escapeHtml(folder)}</small>` : `<small>No folder</small>`}
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
  card.className = 'yanta-ai-link-card yanta-ai-event-card';
  card.dataset.aiOpenEvent = eventId;
  card.style.setProperty('--ai-card-color', 'var(--accent-2)');

  card.innerHTML = `
    <span class="yanta-ai-link-card-icon">${lucide('calendar-days', 18)}</span>
    <span class="yanta-ai-link-card-main">
      <strong>Calendar event</strong>
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
        <strong>${escapeHtml(ev.title || 'Untitled event')}</strong>
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
      toast('Note not found', 'error');
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
        throw new Error('Calendar event navigation is not available.');
      }

      calendar.openCalendarEvent(eventId, {
        push: false,
        replace: false,
      });

      pushCalendarEventHistory(eventId);
    } catch {
      toast('Could not open calendar event', 'error');
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
      toast('Linked note not found', 'error');
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

async function runAssistant(userText) {
  const tools = openAiToolsForModel();

  const messages = [
    await buildSystemMessage(),
    await buildContextMessage({
      attachments: activeContextItems,
    }),
    ...conversation
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: m.content,
      })),
  ];

  abortController = new AbortController();

  setAssistantBusy(true, 'Thinking…');

  const runtimeSettings = getEffectiveAiRuntimeSettings();

  const maxRounds = Math.max(
    1,
    Math.min(
      isIncludedAiMode(runtimeSettings) ? runtimeSettings.maxToolRounds : 50,
      Number(runtimeSettings.maxToolRounds || 6)
    )
  );

  for (let round = 0; round < maxRounds; round++) {
    setAssistantBusy(true, round === 0 ? 'Thinking…' : 'Reading tool results…');
    const assistantMessage = await openRouterChatCompletion({
      messages,
      tools,
      signal: abortController.signal,
    });

    const toolCalls = assistantMessage.tool_calls || [];

    if (!toolCalls.length) {
      const content = assistantMessage.content || '';
      addMessage('assistant', content || '[No response]', {
        model: getAiSettings().model,
      });
      return;
    }

    messages.push({
      role: 'assistant',
      content: assistantMessage.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const toolName = call?.function?.name || '';

      setAssistantBusy(true, `Using ${toolDisplayName(toolName)}…`);

      try {
        const executed = await executeToolCall(call);

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: executed.name,
          content: JSON.stringify(executed.result),
        });

        addMessage('tool', JSON.stringify({
          args: executed.args,
          result: executed.result,
        }, null, 2), {
          toolName: executed.name,
        });
      } catch (err) {
        const result = {
          error: err?.message || String(err),
          code: err?.code || null,
          permission: err?.permission || null,
        };

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: toolName,
          content: JSON.stringify(result),
        });

        addMessage('tool', JSON.stringify(result, null, 2), {
          toolName,
        });
      }
    }
  }

  addMessage('assistant', 'I stopped after the maximum number of tool rounds. Ask me to continue if needed.');
}

async function submitUserText(text) {
  const clean = String(text || '').trim();

  if (!clean) return;

  if (abortController) {
    toast('YANTA AI is already working', 'error');
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
    toast('Add your OpenRouter API key first', 'error');
    return;
  }

  addMessage('user', clean);

  setAssistantBusy(true, 'Thinking…');

  sendBtn.disabled = false;
  sendBtn.classList.add('is-working');
  sendBtn.title = 'Stop generating';
  sendBtn.setAttribute('aria-label', 'Stop generating');
  sendBtn.innerHTML = lucide('square', 16);

  try {
    await runAssistant(clean);
  } catch (err) {
    if (err?.name === 'AbortError') {
      // User clicked stop — no error toast needed
    } else {
      console.error(err);
      addMessage('assistant', `Error: ${err?.message || String(err)}`, {
        model: getAiSettings().model,
      });
    }
  } finally {
    setAssistantBusy(false);

    sendBtn.classList.remove('is-working');
    sendBtn.title = 'Send';
    sendBtn.setAttribute('aria-label', 'Send message');
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

    if (!conversation.length) {
        conversation = loadTransientConversation();
        renderMessages();
    }

  window.addEventListener('yanta-open-ai-assistant', () => openAssistantSmart());
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
  overflow: auto;
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
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--bg-elev-2);
}

.yanta-ai-msg.user {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev-2));
}

.yanta-ai-msg.tool {
  background: var(--bg);
  color: var(--text-dim);
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
  content: "Drop to add as AI context";

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

  padding: 8px 6px;
  resize: none;
  outline: none;

  min-height: 36px;
  max-height: 220px;
  overflow-y: auto;

  grid-area: text-input;
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
`;

  document.head.append(style);
}
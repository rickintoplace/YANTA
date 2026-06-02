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
  saveAiSettings,
  getAiApiKey,
  setAiApiKey,
  clearAiApiKey,
  resetAssistantPrompt,
  DEFAULT_ASSISTANT_PROMPT,
} from './ai-settings.js';

import {
  getExternalAgentSettings,
  saveExternalAgentSettings,
  regenerateExternalAgentToken,
} from '../agent/agent-settings.js';

import {
  setupAgentBridge,
  connectAgentBridge,
  disconnectAgentBridge,
  getAgentBridgeStatus,
  buildAgentReadmeText,
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
  getApproxUserLocation,
  clearApproxUserLocation,
  setApproxUserLocationFromPlace,
  searchApproxLocations,
  setApproxUserLocationFromCandidate,
} from './location.js';

let initialized = false;

let mode = 'pane'; // pane | floating
let root = null;
let messagesEl = null;
let inputEl = null;
let sendBtn = null;
let settingsPanel = null;

let floatingShell = null;
let floatingBody = null;

let conversation = [];
let abortController = null;
let settingsOpen = false;

let assistantBusy = false;
let assistantBusyLabel = 'Thinking…';
let assistantBusySince = 0;

let locationSearchResults = [];
let locationSearchBusy = false;
let locationSearchError = '';

const VT_NAME = 'yanta-ai-assistant';

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

  root.innerHTML = `
    <header class="yanta-ai-head" data-ai-drag-handle>
      <div class="yanta-ai-title">
        ${lucide('sparkles', 17)}
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
      <textarea
        class="text-input"
        data-ai-input
        rows="3"
        placeholder="Ask about your notes, files, drawings or calendar…"></textarea>

      <button class="btn primary" data-ai-send>
        ${lucide('send', 14)}
        Send
      </button>
    </footer>
  `;

  messagesEl = root.querySelector('[data-ai-messages]');
  inputEl = root.querySelector('[data-ai-input]');
  sendBtn = root.querySelector('[data-ai-send]');
  sendBtn?.classList.add('yanta-ai-send');
  settingsPanel = root.querySelector('[data-ai-settings-panel]');

  root.querySelector('[data-ai-settings]')?.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    renderSettings();
  });

  root.querySelector('[data-ai-clear]')?.addEventListener('click', () => {
    conversation = [];
    clearTransientConversation();
    renderMessages();
  });

  root.querySelector('[data-ai-close]')?.addEventListener('click', () => {
    closeAssistant();
  });

  root.querySelector('[data-ai-detach]')?.addEventListener('click', () => {
    if (mode === 'floating') {
      openAssistantPane();
    } else {
      openAssistantFloating();
    }
  });

  sendBtn?.addEventListener('click', () => sendCurrentInput());

  root.addEventListener('click', (e) => {
    handleAiMessageClick(e).catch((err) => {
      console.error(err);
      toast('AI chat action failed', 'error');
    });
  });

  inputEl?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendCurrentInput();
    }
  });

  renderMessages();

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

export async function openAssistantFloating() {
  ensureRoot();
  createFloatingShell();

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

  setTimeout(() => inputEl?.focus(), 0);
}

export function openAssistant() {
  return openAssistantSmart();
}

export function closeAssistant() {
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

function addMessage(role, content, extra = {}) {
  conversation.push({
    role,
    content: String(content || ''),
    ts: Date.now(),
    ...extra,
  });

  saveTransientConversation();
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
    return `Deleted note: ${data.title || data.deletedNoteId || 'Untitled'}.`;
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

    const eventId = eventCard.dataset.aiOpenEvent;

    if (!eventId) return;

    try {
      const calendar = await import('../calendar.js');
      calendar.openCalendarEvent?.(eventId, {
        push: true,
      });
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

  if (!settingsOpen) return;

  const settings = getAiSettings();
  const key = getAiApiKey();
  const p = settings.permissions || {};

  settingsPanel.innerHTML = `
    <div class="yanta-ai-settings-grid">
      <label>
        Provider
        <input class="text-input" value="OpenRouter" disabled />
      </label>

      <label>
        Base URL
        <input class="text-input" data-ai-base-url value="${escapeHtml(settings.baseUrl)}" />
      </label>

      <label>
        Model
        <input class="text-input" data-ai-model value="${escapeHtml(settings.model)}" />
      </label>

      <label>
        Privacy
        <select class="text-input" data-ai-privacy>
          <option value="current-note" ${settings.privacyMode === 'current-note' ? 'selected' : ''}>Include current note</option>
          <option value="metadata-only" ${settings.privacyMode === 'metadata-only' ? 'selected' : ''}>Metadata only</option>
        </select>
      </label>

      <label>
        API key storage
        <select class="text-input" data-ai-key-storage>
          <option value="session" ${settings.apiKeyStorage === 'session' ? 'selected' : ''}>Session only</option>
          <option value="local" ${settings.apiKeyStorage === 'local' ? 'selected' : ''}>Persist in browser localStorage</option>
          <option value="none" ${settings.apiKeyStorage === 'none' ? 'selected' : ''}>Do not store</option>
        </select>
      </label>

      <label class="wide">
        OpenRouter API key
        <input class="text-input" data-ai-key type="password" value="${escapeHtml(key)}" placeholder="sk-or-..." />
      </label>
    </div>

    <section class="yanta-ai-settings-section">
      <h4>Permissions</h4>

      ${permissionCheckboxHtml('allowReadNotes', 'Allow assistant to read notes', 'Recommended', p.allowReadNotes)}
      ${permissionCheckboxHtml('allowCreateNotes', 'Allow assistant to create notes', 'Recommended', p.allowCreateNotes)}
      ${permissionCheckboxHtml('allowEditNotes', 'Allow assistant to edit notes', 'Recommended', p.allowEditNotes)}
      ${permissionCheckboxHtml('allowDeleteNotes', 'Allow assistant to delete notes', 'Not recommended', p.allowDeleteNotes)}
      ${permissionCheckboxHtml('allowManageCalendar', 'Allow assistant to manage calendar events', 'Recommended', p.allowManageCalendar)}
      ${permissionCheckboxHtml('allowReadAiBrain', 'Allow assistant to read AI Brain', 'Recommended', p.allowReadAiBrain)}
      ${permissionCheckboxHtml('allowWriteAiBrain', 'Allow assistant to write AI Brain', 'Recommended', p.allowWriteAiBrain)}

      ${permissionCheckboxHtml('allowWeather', 'Allow assistant to fetch weather via Open-Meteo', 'Recommended', p.allowWeather)}
      ${permissionCheckboxHtml('allowApproxLocationContext', 'Allow assistant to receive approximate location context', 'Optional', p.allowApproxLocationContext)}
    </section>

    ${approxLocationSettingsHtml()}

    ${externalAgentSettingsHtml()}

    <section class="yanta-ai-settings-section">
      <h4>Assistant prompt</h4>
      <textarea class="text-input yanta-ai-prompt-editor" data-ai-prompt rows="10">${escapeHtml(settings.assistantPrompt)}</textarea>

      <div class="compress-actions">
        <button class="btn" data-ai-reset-prompt>
          ${lucide('rotate-ccw', 14)}
          Reset to default
        </button>
      </div>
    </section>

    <div class="yanta-ai-warning">
      BYOK privacy note: your API key stays in this browser, but prompts and included context are sent to OpenRouter/the chosen model.
      Persistent localStorage is convenient but less safe than session-only.
    </div>

    <div class="compress-actions">
      <button class="btn" data-ai-clear-key>Clear key</button>
      <span class="grow"></span>
      <button class="btn primary" data-ai-save-settings>Save AI settings</button>
    </div>
  `;

  settingsPanel.querySelector('[data-ai-save-settings]')?.addEventListener('click', () => {
    const baseUrl = settingsPanel.querySelector('[data-ai-base-url]')?.value || '';
    const model = settingsPanel.querySelector('[data-ai-model]')?.value || '';
    const privacyMode = settingsPanel.querySelector('[data-ai-privacy]')?.value || 'current-note';
    const apiKeyStorage = settingsPanel.querySelector('[data-ai-key-storage]')?.value || 'session';
    const apiKey = settingsPanel.querySelector('[data-ai-key]')?.value || '';
    const prompt = settingsPanel.querySelector('[data-ai-prompt]')?.value || DEFAULT_ASSISTANT_PROMPT;

    const permissions = {
      allowReadNotes: checkboxValue('allowReadNotes'),
      allowCreateNotes: checkboxValue('allowCreateNotes'),
      allowEditNotes: checkboxValue('allowEditNotes'),
      allowDeleteNotes: checkboxValue('allowDeleteNotes'),
      allowManageCalendar: checkboxValue('allowManageCalendar'),
      allowReadAiBrain: checkboxValue('allowReadAiBrain'),
      allowWriteAiBrain: checkboxValue('allowWriteAiBrain'),
      allowWeather: checkboxValue('allowWeather'),
      allowApproxLocationContext: checkboxValue('allowApproxLocationContext'),
    };

    saveAiSettings({
      baseUrl: baseUrl.trim() || 'https://openrouter.ai/api/v1',
      model: model.trim() || 'openai/tencent/hy3-preview',
      privacyMode,
      apiKeyStorage,
      assistantPrompt: prompt.trim() || DEFAULT_ASSISTANT_PROMPT,
      permissions,
    });

    setAiApiKey(apiKey, apiKeyStorage);

    saveExternalAgentSettings(readExternalAgentSettingsFromPanel(settingsPanel));

    toast('AI settings saved', 'success');
    renderSettings();
  });

  settingsPanel.querySelector('[data-ai-clear-key]')?.addEventListener('click', () => {
    clearAiApiKey();
    toast('AI key cleared', 'success');
    renderSettings();
  });

  settingsPanel.querySelector('[data-ai-reset-prompt]')?.addEventListener('click', () => {
    resetAssistantPrompt();
    toast('Assistant prompt reset', 'success');
    renderSettings();
  });

async function runLocationSearch({ saveFirst = false } = {}) {
  const placeInput = settingsPanel.querySelector('[data-ai-location-place]');
  const countryInput = settingsPanel.querySelector('[data-ai-location-country]');

  const query = placeInput?.value?.trim() || '';
  const countryCode = countryInput?.value?.trim().toUpperCase() || '';

  if (!query) {
    toast('Enter a city, region or postcode', 'error');
    return;
  }

  locationSearchBusy = true;
  locationSearchError = '';
  locationSearchResults = [];
  renderSettings();

  try {
    const results = await searchApproxLocations(query, {
      countryCode,
      limit: 6,
    });

    locationSearchResults = results;
    locationSearchError = '';

    if (saveFirst && results[0]) {
      setApproxUserLocationFromCandidate(results[0]);
      locationSearchResults = [];
      toast('Approximate location saved', 'success');
    }
  } catch (err) {
    console.warn('[YANTA AI] location search failed', err);
    locationSearchError = err?.message || 'Could not find location';
    locationSearchResults = [];
  } finally {
    locationSearchBusy = false;
    renderSettings();
  }
}

settingsPanel.querySelector('[data-ai-location-search]')?.addEventListener('click', async () => {
  await runLocationSearch();
});

settingsPanel.querySelector('[data-ai-location-save-best]')?.addEventListener('click', async () => {
  await runLocationSearch({
    saveFirst: true,
  });
});

settingsPanel.querySelector('[data-ai-location-place]')?.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;

  e.preventDefault();

  await runLocationSearch();
});

settingsPanel.querySelectorAll('[data-ai-location-pick]')?.forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.aiLocationPick);
    const candidate = locationSearchResults[idx];

    if (!candidate) return;

    try {
      setApproxUserLocationFromCandidate(candidate);
      locationSearchResults = [];
      locationSearchError = '';

      toast('Approximate location saved', 'success');
      renderSettings();
    } catch (err) {
      toast(err?.message || 'Could not save location', 'error');
    }
  });
});

  settingsPanel.querySelector('[data-ai-location-clear]')?.addEventListener('click', () => {
    clearApproxUserLocation();
    toast('Approximate location cleared', 'success');
    renderSettings();
  });

  wireExternalAgentSettingsPanel(settingsPanel);
}

function checkboxValue(key) {
  return !!settingsPanel?.querySelector(`[data-ai-permission="${CSS.escape(key)}"]`)?.checked;
}

function permissionCheckboxHtml(key, label, badge, checked) {
  const recommended = /recommended/i.test(badge) && !/not/i.test(badge);

  return `
    <label class="yanta-ai-permission">
      <input type="checkbox" data-ai-permission="${escapeHtml(key)}" ${checked ? 'checked' : ''} />
      <span>
        <strong>${escapeHtml(label)}</strong>
        <small class="${recommended ? 'good' : 'warn'}">${escapeHtml(badge)}</small>
      </span>
    </label>
  `;
}

function approxLocationSettingsHtml() {
  const loc = getApproxUserLocation();

  const resultsHtml = locationSearchBusy
    ? `
      <div class="yanta-ai-location-state">
        <span class="yanta-ai-spinner small"></span>
        Searching locations…
      </div>
    `
    : locationSearchError
      ? `
        <div class="yanta-ai-location-state error">
          ${escapeHtml(locationSearchError)}
        </div>
      `
      : locationSearchResults.length
        ? `
          <div class="yanta-ai-location-results">
            ${locationSearchResults.map((r, i) => `
              <button
                type="button"
                class="yanta-ai-location-result"
                data-ai-location-pick="${i}">
                <span class="yanta-ai-location-result-main">
                  <strong>${escapeHtml(r.label || 'Location')}</strong>
                  <small>
                    ${escapeHtml(String(r.latitude))}, ${escapeHtml(String(r.longitude))}
                    ${r.countryCode ? ` · ${escapeHtml(r.countryCode)}` : ''}
                    ${r.source ? ` · ${escapeHtml(r.source)}` : ''}
                  </small>
                </span>
                ${lucide('check', 14)}
              </button>
            `).join('')}
          </div>
        `
        : '';

  return `
    <section class="yanta-ai-settings-section">
      <h4>Approximate location</h4>

      <div class="yanta-ai-warning">
        Used for weather questions like “weather here”.
        Enter a city, region or postcode instead.
        ${loc
          ? `<br><br>Stored:
             ${loc.label ? `${escapeHtml(loc.label)} · ` : ''}
             ${escapeHtml(String(loc.latitude))}, ${escapeHtml(String(loc.longitude))}
             ${loc.timezone ? ` · ${escapeHtml(loc.timezone)}` : ''}
             ${loc.updatedAt ? ` · ${escapeHtml(loc.updatedAt)}` : ''}`
          : '<br><br>No approximate location stored.'}
      </div>

      <div class="yanta-ai-location-grid">
        <label class="wide">
          City, region or postcode
          <input
            class="text-input"
            data-ai-location-place
            value=""
            placeholder="e.g. Göttingen, 37073, 10001, SW1A 1AA"
            autocomplete="postal-code"
            spellcheck="false" />
        </label>

        <label>
          Country code optional
          <input
            class="text-input"
            data-ai-location-country
            value=""
            maxlength="2"
            placeholder="DE, US, GB…" />
        </label>
      </div>

      <div class="compress-actions">
        <button class="btn" data-ai-location-search>
          ${lucide('search', 14)}
          Find matches
        </button>

        <button class="btn primary" data-ai-location-save-best>
          ${lucide('map-pin', 14)}
          Save best match
        </button>

        <button class="btn" data-ai-location-clear>
          ${lucide('trash', 14)}
          Clear location
        </button>
      </div>

      ${resultsHtml}
    </section>
  `;
}

function externalAgentPermissionHtml(key, label, badge, checked) {
  const recommended = /recommended/i.test(badge) && !/not/i.test(badge);

  return `
    <label class="yanta-ai-permission compact">
      <input type="checkbox" data-agent-permission="${escapeHtml(key)}" ${checked ? 'checked' : ''} />
      <span>
        <strong>${escapeHtml(label)}</strong>
        <small class="${recommended ? 'good' : 'warn'}">${escapeHtml(badge)}</small>
      </span>
    </label>
  `;
}

function agentPermissionValue(key) {
  return !!settingsPanel?.querySelector(`[data-agent-permission="${CSS.escape(key)}"]`)?.checked;
}

function externalAgentSettingsHtml() {
  const s = getExternalAgentSettings();
  const p = s.permissions || {};
  const status = getAgentBridgeStatus();

  const enabled = !!s.enabled;

  return `
    <section class="yanta-ai-settings-section yanta-ai-external-agent">
      <h4>External Agents</h4>

      <label class="yanta-ai-permission">
        <input type="checkbox" data-agent-enabled ${enabled ? 'checked' : ''} />
        <span>
          <strong>Allow external AI agents to connect</strong>
          <small class="${enabled ? 'good' : 'warn'}">${enabled ? 'Enabled' : 'Disabled'}</small>
        </span>
      </label>

      ${
        enabled
          ? `
            <div class="yanta-ai-settings-grid">
              <label class="wide">
                Local bridge URL
                <input class="text-input" data-agent-url value="${escapeHtml(s.bridgeUrl)}" />
              </label>

              <label class="wide">
                Session token
                <input class="text-input" data-agent-token value="${escapeHtml(s.token)}" readonly />
              </label>
            </div>

            <div class="yanta-ai-agent-status ${status.connected ? 'connected' : ''}">
              ${status.connected ? 'Connected to local bridge' : 'Not connected'}
              ${status.lastError ? ` · ${escapeHtml(status.lastError)}` : ''}
            </div>

            <div class="yanta-ai-settings-section-sub">
              ${externalAgentPermissionHtml('allowReadNotes', 'Allow external agents to read notes', 'Recommended', p.allowReadNotes)}
              ${externalAgentPermissionHtml('allowCreateNotes', 'Allow external agents to create notes', 'Recommended', p.allowCreateNotes)}
              ${externalAgentPermissionHtml('allowEditNotes', 'Allow external agents to edit notes', 'Recommended', p.allowEditNotes)}
              ${externalAgentPermissionHtml('allowDeleteNotes', 'Allow external agents to delete notes', 'Not recommended', p.allowDeleteNotes)}
              ${externalAgentPermissionHtml('allowManageCalendar', 'Allow external agents to manage calendar events', 'Recommended', p.allowManageCalendar)}
            </div>

            <textarea class="text-input yanta-ai-agent-readme" data-agent-readme rows="8" readonly>${escapeHtml(buildAgentReadmeText())}</textarea>

            <div class="compress-actions">
              <button class="btn" data-agent-copy-readme>${lucide('copy', 14)} Copy setup text</button>
              <button class="btn" data-agent-regenerate-token>${lucide('rotate-ccw', 14)} Regenerate token</button>
              <span class="grow"></span>
              <button class="btn" data-agent-disconnect>Disconnect</button>
              <button class="btn primary" data-agent-connect>Connect</button>
            </div>
          `
          : `
            <div class="yanta-ai-warning">
              External agent bridge settings are hidden while external agent access is disabled.
              Enable this option to show bridge URL, token, permissions and setup text.
            </div>
          `
      }
    </section>
  `;
}

function wireExternalAgentSettingsPanel(panel) {
  panel.querySelector('[data-agent-enabled]')?.addEventListener('change', async () => {
    const next = readExternalAgentSettingsFromPanel(panel);

    saveExternalAgentSettings(next);

    if (!next.enabled) {
      disconnectAgentBridge();
    }

    renderSettings();
  });

  panel.querySelector('[data-agent-copy-readme]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildAgentReadmeText());
      toast('External agent setup text copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  });

  panel.querySelector('[data-agent-regenerate-token]')?.addEventListener('click', () => {
    regenerateExternalAgentToken();
    toast('External agent token regenerated', 'success');
    renderSettings();
  });

  panel.querySelector('[data-agent-connect]')?.addEventListener('click', async () => {
    saveExternalAgentSettings(readExternalAgentSettingsFromPanel(panel));

    try {
      await connectAgentBridge();
      toast('External agent bridge connected', 'success');
    } catch (err) {
      toast(err?.message || 'Could not connect bridge', 'error');
    }

    renderSettings();
  });

  panel.querySelector('[data-agent-disconnect]')?.addEventListener('click', () => {
    disconnectAgentBridge();
    toast('External agent disconnected', 'success');
    renderSettings();
  });
}

function readExternalAgentSettingsFromPanel(panel) {
  const current = getExternalAgentSettings();
  const currentPermissions = current.permissions || {};

  const enabled = !!panel.querySelector('[data-agent-enabled]')?.checked;

  const permissionValue = (key) => {
    const input = panel.querySelector(`[data-agent-permission="${CSS.escape(key)}"]`);

    // If the detailed settings are hidden, preserve the existing permission.
    if (!input) {
      return currentPermissions[key] === true;
    }

    return !!input.checked;
  };

  return {
    enabled,

    // If the detailed settings are hidden, preserve the existing bridge URL.
    bridgeUrl:
      panel.querySelector('[data-agent-url]')?.value?.trim() ||
      current.bridgeUrl ||
      'ws://127.0.0.1:18791',

    permissions: {
      allowReadNotes: permissionValue('allowReadNotes'),
      allowCreateNotes: permissionValue('allowCreateNotes'),
      allowEditNotes: permissionValue('allowEditNotes'),
      allowDeleteNotes: permissionValue('allowDeleteNotes'),
      allowManageCalendar: permissionValue('allowManageCalendar'),
    },
  };
}

async function runAssistant(userText) {
  const tools = openAiToolsForModel();

  const messages = [
    await buildSystemMessage(),
    await buildContextMessage(),
    ...conversation
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: m.content,
      })),
  ];

  abortController = new AbortController();

  setAssistantBusy(true, 'Thinking…');

  const maxRounds = Math.max(1, Math.min(10, Number(getAiSettings().maxToolRounds || 6)));

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

        addMessage('tool', JSON.stringify(executed.result, null, 2), {
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

  if (!getAiApiKey()) {
    settingsOpen = true;
    renderSettings();
    toast('Add your OpenRouter API key first', 'error');
    return;
  }

  addMessage('user', clean);

  setAssistantBusy(true, 'Thinking…');

  sendBtn.disabled = true;
  sendBtn.classList.add('is-working');
  sendBtn.innerHTML = `<span class="yanta-ai-spinner small"></span> Working…`;

  try {
    await runAssistant(clean);
  } catch (err) {
    console.error(err);
    addMessage('assistant', `Error: ${err?.message || String(err)}`, {
      model: getAiSettings().model,
    });
  } finally {
    setAssistantBusy(false);

    sendBtn.disabled = false;
    sendBtn.classList.remove('is-working');
    sendBtn.innerHTML = `${lucide('send', 14)} Send`;
    abortController = null;
  }
}

async function sendCurrentInput() {
  const text = inputEl?.value?.trim();

  if (!text) return;

  inputEl.value = '';

  await submitUserText(text);
}
export function setupAssistant() {
  if (initialized) return;
  initialized = true;

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
      closeAssistant();
    }
  });
}

function injectCss() {
  if (document.getElementById('yanta-ai-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-ai-css';
  style.textContent = `
.yanta-ai-root {
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
  overflow: auto;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
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
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-elev-2);
}

.yanta-ai-foot textarea {
  resize: vertical;
  min-height: 54px;
  max-height: 180px;
  margin: 0;
}

.yanta-ai-floating {
  position: fixed;
  z-index: 260;
  width: min(680px, calc(100vw - 20px));
  height: min(760px, calc(100vh - 20px));
  min-width: 360px;
  min-height: 420px;
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

@media (max-width: 720px) {
  .yanta-ai-settings-grid {
    grid-template-columns: 1fr;
  }

  .yanta-ai-settings-grid .wide {
    grid-column: auto;
  }

  .yanta-ai-foot {
    grid-template-columns: 1fr;
  }

  .yanta-ai-floating {
    left: 8px !important;
    top: 8px !important;
    width: calc(100vw - 16px);
    height: calc(100vh - 16px);
    min-width: 0;
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

.yanta-ai-send.is-working,
.yanta-ai-foot .btn.is-working {
  opacity: 0.92;
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

@media (max-width: 720px) {
  .yanta-ai-location-grid {
    grid-template-columns: 1fr;
  }
}
`;

  document.head.append(style);
}
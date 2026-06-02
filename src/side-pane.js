// ============================================================
// YANTA — Side / Companion Pane Manager
//
// Central host for "right-pane apps":
// - preview is the default native content
// - graph/calendar/dashboard can temporarily occupy the preview pane
// ============================================================

import {
  $,
  state,
  store,
  lucide,
} from './core.js';

let active = null;
let hiddenChildren = [];
let host = null;

export function currentSidePaneKind() {
  return active?.kind || 'preview';
}

export function isSidePaneOpen(kind = null) {
  if (!active) return false;
  return kind ? active.kind === kind : true;
}

function forceSplitView() {
  const app = $('app');

  state.view = 'split';

  if (app) {
    app.dataset.view = 'split';

    if (app.dataset.surface !== 'calendar' && app.dataset.surface !== 'dashboard') {
      app.dataset.surface = 'note';
    }
  }

  $('btn-view-edit')?.classList.toggle('active', false);
  $('btn-view-split')?.classList.toggle('active', true);
  $('btn-view-preview')?.classList.toggle('active', false);

  store.settings.set('view', 'split');
}

export function openSidePane({
  kind,
  title = '',
  icon = 'panel-right',
  className = '',
  onClose = null,
} = {}) {
  if (!kind) throw new Error('openSidePane: kind required');

  const pane = $('panePreview');
  if (!pane) return null;

  forceSplitView();

  if (active?.kind === kind && host?.isConnected) {
    return host.querySelector('[data-side-pane-body]');
  }

  closeSidePane({
    silent: true,
  });

  hiddenChildren = [...pane.children].map((child) => ({
    child,
    display: child.style.display,
  }));

  for (const { child } of hiddenChildren) {
    child.style.display = 'none';
  }

  pane.classList.add('yanta-side-pane-active');
  pane.dataset.sidePane = kind;

  host = document.createElement('div');
  host.className = [
    'yanta-side-pane-host',
    className,
  ].filter(Boolean).join(' ');

  host.dataset.sidePaneHost = kind;

  host.innerHTML = `
    <div class="yanta-side-pane-head">
      <span class="yanta-side-pane-icon">${lucide(icon, 15)}</span>
      <strong class="yanta-side-pane-title">${title || kind}</strong>

      <div class="yanta-side-pane-tabs" role="tablist" aria-label="Right pane content">
        <button class="icon-btn ${kind === 'preview' ? 'active' : ''}" data-side-pane-tab="preview" title="Markdown preview">${lucide('eye', 15)}</button>
        <button class="icon-btn ${kind === 'dashboard' ? 'active' : ''}" data-side-pane-tab="dashboard" title="Dashboard">${lucide('layout-dashboard', 15)}</button>
        <button class="icon-btn ${kind === 'graph' ? 'active' : ''}" data-side-pane-tab="graph" title="Graph">${lucide('network', 15)}</button>
        <button class="icon-btn ${kind === 'calendar' ? 'active' : ''}" data-side-pane-tab="calendar" title="Calendar">${lucide('calendar-days', 15)}</button>
        <button class="icon-btn ${kind === 'ai' ? 'active' : ''}" data-side-pane-tab="ai" title="AI Assistant">${lucide('sparkles', 15)}</button>
      </div>

      <span class="grow"></span>

      <button class="icon-btn" data-side-pane-expand title="Expand">${lucide('maximize-2', 16)}</button>
      <button class="icon-btn" data-side-pane-close title="Close side pane">${lucide('x', 16)}</button>
    </div>

    <div class="yanta-side-pane-body" data-side-pane-body></div>
  `;

  pane.append(host);

  active = {
    kind,
    onClose,
  };

  host.querySelector('[data-side-pane-close]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('yanta-side-pane-close-request', {
      detail: {
        kind,
      },
    }));
  });

  host.querySelector('[data-side-pane-expand]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('yanta-side-pane-expand', {
      detail: {
        kind,
      },
    }));
  });

  for (const btn of host.querySelectorAll('[data-side-pane-tab]')) {
    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('yanta-side-pane-switch', {
        detail: {
          kind: btn.dataset.sidePaneTab,
        },
      }));
    });
  }

  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent('yanta-side-pane-opened', {
      detail: {
        kind,
      },
    }));

    window.dispatchEvent(new Event('resize'));
  });

  return host.querySelector('[data-side-pane-body]');
}

export function sidePaneBody(kind = null) {
  if (!host || !active) return null;
  if (kind && active.kind !== kind) return null;
  return host.querySelector('[data-side-pane-body]');
}

export function closeSidePane({
  silent = false,
} = {}) {
  if (!active && !host) return;

  const prev = active;

  try {
    prev?.onClose?.();
  } catch (err) {
    console.warn('[YANTA side-pane] onClose failed', err);
  }

  const pane = $('panePreview');

  if (host) {
    host.remove();
    host = null;
  }

  if (pane) {
    for (const { child, display } of hiddenChildren) {
      child.style.display = display;
    }

    pane.classList.remove('yanta-side-pane-active');
    delete pane.dataset.sidePane;
  }

  hiddenChildren = [];
  active = null;

  if (!silent) {
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('yanta-side-pane-closed', {
        detail: {
          kind: prev?.kind || null,
        },
      }));

      window.dispatchEvent(new Event('resize'));
    });
  }
}
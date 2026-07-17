// ============================================================
// YANTA Dashboard — widget registry
//
// Widgets are self-contained sections rendered above the note grid
// on the dashboard ROOT view (never inside folders). A widget's
// render() may return null to stay hidden (e.g. nothing new to show),
// and is responsible for keeping its own DOM fresh — the dashboard's
// structure-signature cache deliberately skips re-rendering widgets.
//
// The registry owns what the widgets themselves should not:
// per-widget visibility, ordering (drag & drop on the dashboard,
// up/down in the manager dialog), and the manager UI.
// ============================================================

import {
  el,
  lucide,
  store,
  toast,
} from './core.js';

const widgets = new Map();

const CONFIG_KEY = 'dashboard.widgets.v1';

async function getWidgetsConfig() {
  const raw = await store.settings.get(CONFIG_KEY, {});

  return {
    order: Array.isArray(raw?.order) ? raw.order.filter(Boolean) : [],
    disabled: Array.isArray(raw?.disabled) ? raw.disabled.filter(Boolean) : [],
    layout: raw?.layout === 'grid' ? 'grid' : 'stack',
  };
}

async function saveWidgetsConfig(patch = {}) {
  const current = await getWidgetsConfig();

  await store.settings.set(CONFIG_KEY, {
    ...current,
    ...patch,
  });
}

function forceDashboardRefresh() {
  window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
    detail: { force: true },
  }));
}

// ---------------- registry --------------------------------------

export function registerDashboardWidget({
  id,
  title = '',
  icon = 'layout-dashboard',
  order = 100,
  render,
} = {}) {
  if (!id || typeof render !== 'function') return;

  widgets.set(id, {
    id,
    title: title || id,
    icon,
    order,
    render,
  });
}

export function hasDashboardWidgets() {
  return widgets.size > 0;
}

export async function isDashboardWidgetEnabled(id) {
  const config = await getWidgetsConfig();
  return !config.disabled.includes(id);
}

export async function setDashboardWidgetEnabled(id, enabled) {
  const config = await getWidgetsConfig();
  const disabled = new Set(config.disabled);

  if (enabled) disabled.delete(id);
  else disabled.add(id);

  await saveWidgetsConfig({ disabled: [...disabled] });
  forceDashboardRefresh();
}

async function sortedWidgetDefs() {
  const config = await getWidgetsConfig();

  return [...widgets.values()].sort((a, b) => {
    const ia = config.order.indexOf(a.id);
    const ib = config.order.indexOf(b.id);

    // Saved positions win; unsaved widgets fall back to their
    // registration order and sort after saved ones consistently.
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;

    return a.order - b.order;
  });
}

// ---------------- rendering + drag & drop -----------------------

let draggingSlot = null;

function persistOrderFromDom(host) {
  const order = [...host.querySelectorAll('[data-widget-id]')]
    .map((slot) => slot.dataset.widgetId)
    .filter(Boolean);

  saveWidgetsConfig({ order }).catch(() => {});
}

function makeSlotDraggable(slot, host) {
  const grip = el('button', {
    class: 'icon-btn yanta-dash-widget-grip',
    title: 'Drag to reorder',
    type: 'button',
  });

  grip.innerHTML = lucide('grip-vertical', 14);

  /*
    Widgets rebuild their own head on self-refresh (replaceChildren) —
    that used to silently drop the grip until the next full dashboard
    render. Re-attach it whenever a grip-less head (re)appears.

    Warum parentElement statt isConnected: Nach einem Dashboard-Re-Render
    ist der alte Slot detached; dort ist isConnected für den Grip IMMER
    false, und prepend→Mutation→Observer wird zur endlosen Microtask-
    Schleife (Renderer-Crash). Der relative Check terminiert, und
    detachte Slots stoppen ihren Observer ganz.
  */
  const ensureGrip = () => {
    const head = slot.querySelector('.yanta-dash-widget-head');

    if (!head) return;
    if (grip.parentElement === head) return;

    head.prepend(grip);
  };

  ensureGrip();

  const observer = new MutationObserver(() => {
    if (!slot.isConnected) {
      observer.disconnect();
      return;
    }

    ensureGrip();
  });

  observer.observe(slot, {
    childList: true,
    subtree: true,
  });

  // Draggable only while grabbed by the grip, so text selection and
  // scrolling inside the widget keep working.
  grip.addEventListener('pointerdown', () => {
    slot.draggable = true;
  });

  grip.addEventListener('pointerup', () => {
    slot.draggable = false;
  });

  slot.addEventListener('dragstart', (e) => {
    draggingSlot = slot;
    slot.classList.add('yanta-dash-widget-dragging');

    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', slot.dataset.widgetId || '');
    } catch {}
  });

  slot.addEventListener('dragend', () => {
    slot.classList.remove('yanta-dash-widget-dragging');
    slot.draggable = false;

    if (draggingSlot === slot) {
      draggingSlot = null;
      persistOrderFromDom(host);
    }
  });
}

function installDropHandling(host) {
  host.addEventListener('dragover', (e) => {
    if (!draggingSlot) return;

    e.preventDefault();

    const over = e.target.closest?.('[data-widget-id]');
    if (!over || over === draggingSlot) return;

    const rect = over.getBoundingClientRect();

    // Side-by-side layout flows horizontally — compare on that axis.
    const before = host.classList.contains('yanta-dash-widgets-grid')
      ? e.clientX < rect.left + rect.width / 2
      : e.clientY < rect.top + rect.height / 2;

    if (before) {
      over.before(draggingSlot);
    } else {
      over.after(draggingSlot);
    }
  });

  host.addEventListener('drop', (e) => {
    if (draggingSlot) e.preventDefault();
  });
}

function injectRegistryCss() {
  if (document.getElementById('yanta-dash-widgets-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-dash-widgets-css';
  style.textContent = `
.yanta-dashboard-widgets {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(1120px, 100%);
  margin-left: auto;
  margin-right: auto;
}

.yanta-dashboard-widgets:not(:empty) {
  margin-block-end: 6px;
}

.yanta-dash-widget-slot {
  min-width: 0;
}

/* Side-by-side on wide screens; media query keeps mobile stacked. */
.yanta-dashboard-widgets.yanta-dash-widgets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  align-items: start;
}

@media (max-width: 760px) {
  .yanta-dashboard-widgets.yanta-dash-widgets-grid {
    display: flex;
    flex-direction: column;
  }
}

.yanta-dash-widget-grip {
  width: 24px !important;
  height: 24px !important;

  color: var(--text-faint) !important;
  cursor: grab;

  touch-action: none;
}

.yanta-dash-widget-grip:active {
  cursor: grabbing;
}

.yanta-dash-widget-dragging {
  opacity: 0.55;
}

.yanta-dash-widget-manager-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.yanta-dash-widget-manager-row {
  display: flex;
  align-items: center;
  gap: 10px;

  padding: 9px 11px;

  border: 1px solid var(--border);
  border-radius: 10px;

  background: var(--bg-elev);
}

.yanta-dash-widget-manager-row .yanta-dash-widget-manager-icon {
  color: var(--accent);
  display: inline-flex;
}

.yanta-dash-widget-manager-row strong {
  flex: 1;
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
}

.yanta-dash-widget-manager-row input[type="checkbox"] {
  accent-color: var(--accent);
}

.yanta-dash-widget-manager-hint {
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.5;
}

.yanta-dash-widget-manager-layout {
  display: inline-flex;
  gap: 2px;

  padding: 2px;

  border: 1px solid var(--border);
  border-radius: 8px;

  background: var(--bg);
}

.yanta-dash-widget-manager-layout button {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  min-height: 26px;
  padding: 2px 10px;

  border: 0;
  border-radius: 6px;

  background: transparent;
  color: var(--text-dim);

  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.yanta-dash-widget-manager-layout button.active {
  color: var(--text);
  background: var(--bg-elev-2, var(--bg-elev));
}
`;

  document.head.append(style);
}

/**
 * Render all registered widgets into the host element.
 * Widgets render independently — one failing must not hide the rest.
 */
export async function renderDashboardWidgetsInto(host) {
  if (!host) return;

  injectRegistryCss();
  installDropHandling(host);

  const config = await getWidgetsConfig();
  const defs = await sortedWidgetDefs();

  host.classList.toggle('yanta-dash-widgets-grid', config.layout === 'grid');

  for (const def of defs) {
    if (config.disabled.includes(def.id)) continue;

    try {
      const node = await def.render();
      if (!node || host.isConnected === false) continue;

      const slot = el('div', {
        class: 'yanta-dash-widget-slot',
        dataset: { widgetId: def.id },
      });

      slot.append(node);
      host.append(slot);

      makeSlotDraggable(slot, host);
    } catch (err) {
      console.warn('[YANTA Dashboard] widget render failed:', def.id, err);
    }
  }
}

// ---------------- manager dialog ---------------------------------

let managerModal = null;

export async function openDashboardWidgetManager() {
  injectRegistryCss();

  managerModal?.remove();

  const config = await getWidgetsConfig();
  const defs = await sortedWidgetDefs();

  const modal = el('div', { class: 'modal' });
  managerModal = modal;

  const card = el('div', { class: 'modal-card', style: { width: 'min(440px, 94vw)' } });

  card.innerHTML = `
    <header class="modal-head">
      <h3>Dashboard widgets</h3>
      <button class="icon-btn" data-widget-manager-close>&times;</button>
    </header>

    <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
      <div class="yanta-dash-widget-manager-row" style="gap:12px">
        <strong style="flex:1">Layout</strong>
        <div class="yanta-dash-widget-manager-layout" data-widget-layout>
          <button type="button" data-layout="stack">${lucide('rows-3', 13)} Stacked</button>
          <button type="button" data-layout="grid">${lucide('columns-3', 13)} Side by side</button>
        </div>
      </div>

      <div class="yanta-dash-widget-manager-list" data-widget-list></div>

      <div class="yanta-dash-widget-manager-hint">
        Widgets appear above your notes on the dashboard home. Reorder them
        here or drag them directly on the dashboard using the grip handle.
        On small screens widgets always stack.
      </div>
    </div>
  `;

  let layout = config.layout;

  const layoutButtons = [...card.querySelectorAll('[data-layout]')];

  const syncLayoutButtons = () => {
    for (const btn of layoutButtons) {
      btn.classList.toggle('active', btn.dataset.layout === layout);
    }
  };

  for (const btn of layoutButtons) {
    btn.addEventListener('click', () => {
      layout = btn.dataset.layout === 'grid' ? 'grid' : 'stack';
      syncLayoutButtons();
    });
  }

  syncLayoutButtons();

  const list = card.querySelector('[data-widget-list]');
  const disabled = new Set(config.disabled);

  const rows = defs.map((def) => {
    const row = el('div', {
      class: 'yanta-dash-widget-manager-row',
      dataset: { widgetId: def.id },
    });

    const iconSpan = el('span', { class: 'yanta-dash-widget-manager-icon' });
    iconSpan.innerHTML = lucide(def.icon, 15);

    const toggle = el('input', { type: 'checkbox', title: 'Show widget' });
    toggle.checked = !disabled.has(def.id);

    toggle.addEventListener('change', () => {
      if (toggle.checked) disabled.delete(def.id);
      else disabled.add(def.id);
    });

    const up = el('button', { class: 'icon-btn', title: 'Move up', type: 'button' });
    up.innerHTML = lucide('chevron-up', 15);
    up.addEventListener('click', () => {
      row.previousElementSibling?.before(row);
    });

    const down = el('button', { class: 'icon-btn', title: 'Move down', type: 'button' });
    down.innerHTML = lucide('chevron-down', 15);
    down.addEventListener('click', () => {
      row.nextElementSibling?.after(row);
    });

    row.append(toggle, iconSpan, el('strong', {}, def.title), up, down);

    return row;
  });

  list.append(...rows);

  const foot = el('div', {
    class: 'compress-actions',
    style: { marginTop: '2px' },
  });

  const cancel = el('button', { class: 'btn' }, 'Cancel');
  const apply = el('button', { class: 'btn primary' }, 'Apply');

  const close = () => {
    modal.remove();
    if (managerModal === modal) managerModal = null;
  };

  cancel.addEventListener('click', close);

  apply.addEventListener('click', async () => {
    const order = [...list.querySelectorAll('[data-widget-id]')]
      .map((row) => row.dataset.widgetId)
      .filter(Boolean);

    await saveWidgetsConfig({
      order,
      disabled: [...disabled],
      layout,
    });

    close();
    forceDashboardRefresh();
    toast('Widgets updated', 'success');
  });

  foot.append(el('span', { class: 'grow' }), cancel, apply);
  card.querySelector('.modal-body').append(foot);

  modal.append(card);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
    if (e.target.closest?.('[data-widget-manager-close]')) close();
  });

  document.body.append(modal);
  modal.hidden = false;
}

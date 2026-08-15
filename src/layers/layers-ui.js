// ============================================================
// YANTA Drawing — Layers panel.
//
// Lives on the fullscreen drawing stage, opened from the "Layers" button in
// the drawing header. One layer per row: visibility, lock, name, element
// count, and the actions that make layers worth having — reorder (which is
// what actually restacks the board), move the selection in, select the whole
// layer.
//
// The panel is a thin view over layers-store.js; it holds no scene state of
// its own beyond which layer is active for newly drawn elements.
// ============================================================

import {
  lucide,
  escapeHtml,
  escapeAttr,
  toast,
} from '../core.js';

import {
  yantaConfirm,
  yantaPrompt,
} from '../dialogs.js';

import {
  openBoundOverlay,
} from '../overlay-history.js';

import {
  BASE_LAYER_ID,
  layerIdOfElement,
} from './layers-model.js';

import {
  adoptNewElements,
  createLayer,
  deleteLayer,
  layerElementCounts,
  listLayers,
  liveElementIds,
  moveSelectionToLayer,
  reorderLayer,
  selectLayer,
  selectedElementIds,
  setLayerLocked,
  setLayerVisible,
  updateLayer,
} from './layers-store.js';

const PANEL_OVERLAY_ID = 'draw-layers';

let panel = null;
let cssInjected = false;

function injectCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.dataset.yanta = 'draw-layers';

  style.textContent = `
.yanta-layers-panel {
  position: fixed;
  left: max(16px, env(safe-area-inset-left));
  top: 50%;
  transform: translateY(-50%);
  z-index: 392;

  width: min(300px, calc(100vw - 32px));
  max-height: min(72vh, 640px);

  display: flex;
  flex-direction: column;

  border: 1px solid var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-elev) 96%, transparent);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  overflow: hidden;
}

/* Never in the way of a running presentation. */
body.yanta-slideshow-active .yanta-layers-panel {
  display: none;
}

@media (max-width: 760px) {
  .yanta-layers-panel {
    left: 8px;
    right: 8px;
    width: auto;
    top: auto;
    bottom: max(12px, env(safe-area-inset-bottom));
    transform: none;
    max-height: 62vh;
  }
}

.yanta-layers-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--border);
}

.yanta-layers-head h3 {
  margin: 0;
  flex: 1 1 auto;
  font-size: 13px;
  font-weight: 700;
}

.yanta-layers-list {
  padding: 8px;
  overflow: auto;
  display: flex;

  /* Top of the stack first — the board's front layer is the top row. */
  flex-direction: column-reverse;
  justify-content: flex-end;
  gap: 6px;
}

.yanta-layer-row {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 8px;

  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: var(--bg);
  cursor: pointer;
}

.yanta-layer-row:hover {
  border-color: var(--border);
}

.yanta-layer-row.is-active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
}

.yanta-layer-row.is-hidden .yanta-layer-name,
.yanta-layer-row.is-hidden .yanta-layer-count {
  opacity: 0.45;
}

.yanta-layer-swatch {
  width: 8px;
  height: 22px;
  border-radius: 4px;
  flex: 0 0 auto;
}

.yanta-layer-main {
  min-width: 0;
}

.yanta-layer-name {
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanta-layer-count {
  font-size: 11px;
  color: var(--muted);
}

.yanta-layer-row .icon-btn {
  width: 26px;
  height: 26px;
}

.yanta-layer-toggles,
.yanta-layer-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.yanta-layer-row .icon-btn[aria-pressed="true"] {
  color: var(--accent);
}

.yanta-layers-foot {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
}

.yanta-layers-foot .btn {
  flex: 1 1 auto;
  justify-content: center;
}

.yanta-layers-hint {
  padding: 0 12px 10px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--muted);
}
  `;

  document.head.append(style);
}

// ------------------------------------------------------------
// Panel
// ------------------------------------------------------------

function api() {
  return panel?.getApi?.() || null;
}

function refresh() {
  if (!panel?.root?.isConnected) return;

  const { noteId, drawingId } = panel;
  const layers = listLayers(noteId, drawingId);

  const elements = (() => {
    try {
      return api()?.getSceneElements?.() || [];
    } catch {
      return [];
    }
  })();

  const counts = layerElementCounts(elements);
  const list = panel.root.querySelector('[data-layers-list]');
  if (!list) return;

  // The active layer may have been deleted elsewhere.
  if (!layers.some((l) => l.id === panel.activeLayerId)) {
    panel.activeLayerId = BASE_LAYER_ID;
  }

  list.innerHTML = layers.map((layer, index) => {
    const count = counts.get(layer.id) || 0;
    const isBase = layer.id === BASE_LAYER_ID;

    return `
      <div class="yanta-layer-row ${layer.id === panel.activeLayerId ? 'is-active' : ''} ${layer.visible ? '' : 'is-hidden'}"
           data-layer="${escapeAttr(layer.id)}"
           title="Click to make this the active layer">
        <span class="yanta-layer-swatch" style="background:${escapeAttr(layer.color)}"></span>

        <span class="yanta-layer-toggles">
          <button class="icon-btn" data-toggle="visible" aria-pressed="${layer.visible ? 'false' : 'true'}"
                  title="${layer.visible ? 'Hide layer' : 'Show layer'}">
            ${lucide(layer.visible ? 'eye' : 'eye-off', 14)}
          </button>
          <button class="icon-btn" data-toggle="locked" aria-pressed="${layer.locked ? 'true' : 'false'}"
                  title="${layer.locked ? 'Unlock layer' : 'Lock layer'}">
            ${lucide(layer.locked ? 'lock' : 'lock-open', 14)}
          </button>
        </span>

        <span class="yanta-layer-main">
          <div class="yanta-layer-name">${escapeHtml(layer.name)}</div>
          <div class="yanta-layer-count">${count} object${count === 1 ? '' : 's'}</div>
        </span>

        <span class="yanta-layer-actions">
          <button class="icon-btn" data-action="up" title="Bring layer forward"
                  ${index >= layers.length - 1 || isBase ? 'disabled' : ''}>${lucide('chevron-up', 14)}</button>
          <button class="icon-btn" data-action="down" title="Send layer backward"
                  ${index <= 1 ? 'disabled' : ''}>${lucide('chevron-down', 14)}</button>
          <button class="icon-btn" data-action="menu" title="More">${lucide('ellipsis', 14)}</button>
        </span>
      </div>
    `;
  }).join('');
}

function openLayerMenu(anchor, layerId) {
  const { noteId, drawingId } = panel;
  const layer = listLayers(noteId, drawingId).find((l) => l.id === layerId);
  if (!layer) return;

  const isBase = layer.id === BASE_LAYER_ID;
  const rect = anchor.getBoundingClientRect();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.zIndex = '560';
  menu.style.left = `${Math.round(rect.left)}px`;
  menu.style.top = `${Math.round(rect.bottom + 6)}px`;

  menu.innerHTML = `
    <button data-act="move">${lucide('between-vertical-start', 14)} Move selection here</button>
    <button data-act="select">${lucide('box-select', 14)} Select layer objects</button>
    <button data-act="rename" ${isBase ? 'disabled' : ''}>${lucide('pencil', 14)} Rename</button>
    ${isBase ? '' : `<hr><button class="danger" data-act="delete">${lucide('trash', 14)} Delete layer</button>`}
  `;

  document.body.append(menu);

  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
  };

  const outside = (e) => {
    if (!menu.contains(e.target)) close();
  };

  setTimeout(() => document.addEventListener('pointerdown', outside, true));

  menu.querySelector('[data-act="move"]')?.addEventListener('click', () => {
    close();

    const moved = moveSelectionToLayer(noteId, drawingId, layerId, { api: api() });

    if (!moved) {
      toast('Select objects on the board first', 'error');
      return;
    }

    panel.knownIds = liveElementIds(noteId, drawingId, api());
    toast(`Moved ${moved} object${moved === 1 ? '' : 's'} to “${layer.name}”`, 'success');
    refresh();
  });

  menu.querySelector('[data-act="select"]')?.addEventListener('click', () => {
    close();

    const count = selectLayer(noteId, drawingId, layerId, { api: api() });

    if (!count) toast('This layer has nothing selectable', 'error');
  });

  menu.querySelector('[data-act="rename"]')?.addEventListener('click', async () => {
    close();

    const name = await yantaPrompt({
      title: 'Rename layer',
      label: 'Layer name',
      initial: layer.name,
      confirmLabel: 'Rename',
      icon: 'layers',
    });

    if (name == null) return;

    updateLayer(noteId, drawingId, layerId, {
      name: name.trim() || layer.name,
    }, { api: api() });

    refresh();
  });

  menu.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    close();

    const ok = await yantaConfirm({
      title: 'Delete layer?',
      message: `“${layer.name}” is removed. Its objects are kept and move to the base layer.`,
      confirmLabel: 'Delete layer',
      danger: true,
      icon: 'trash',
    });

    if (!ok) return;

    deleteLayer(noteId, drawingId, layerId, { api: api() });
    refresh();
  });
}

function onListClick(e) {
  const row = e.target.closest?.('[data-layer]');
  if (!row || !panel) return;

  const layerId = row.dataset.layer;
  const { noteId, drawingId } = panel;

  const toggle = e.target.closest('[data-toggle]');

  if (toggle) {
    const layer = listLayers(noteId, drawingId).find((l) => l.id === layerId);
    if (!layer) return;

    if (toggle.dataset.toggle === 'visible') {
      setLayerVisible(noteId, drawingId, layerId, !layer.visible, { api: api() });
    } else {
      setLayerLocked(noteId, drawingId, layerId, !layer.locked, { api: api() });
    }

    refresh();
    return;
  }

  const action = e.target.closest('[data-action]');

  if (action) {
    if (action.dataset.action === 'menu') {
      openLayerMenu(action, layerId);
      return;
    }

    reorderLayer(
      noteId,
      drawingId,
      layerId,
      action.dataset.action === 'up' ? 1 : -1,
      { api: api() }
    );

    refresh();
    return;
  }

  // Plain row click: this is where new strokes go from now on.
  panel.activeLayerId = layerId;
  panel.knownIds = liveElementIds(noteId, drawingId, api());
  refresh();
}

/**
 * Anything drawn since the last check joins the active layer.
 *
 * Driven by the drawing's own change event rather than a timer, so it costs
 * nothing while the board is idle.
 */
function adoptDrawnElements() {
  if (!panel || panel.activeLayerId === BASE_LAYER_ID) return;

  const adopted = adoptNewElements(
    panel.noteId,
    panel.drawingId,
    panel.activeLayerId,
    panel.knownIds,
    { api: api() }
  );

  if (adopted.length) {
    for (const id of adopted) panel.knownIds.add(id);
    refresh();
  }
}

export function isLayersPanelOpen() {
  return !!panel;
}

export function closeLayersPanel({ fromHistory = false } = {}) {
  if (!panel) return;

  const { release, onDrawingUpdated, onLayersUpdated } = panel;

  window.removeEventListener('yanta-drawing-updated', onDrawingUpdated);
  window.removeEventListener('yanta-draw-layers-updated', onLayersUpdated);
  panel.root.remove();
  panel = null;

  window.dispatchEvent(new CustomEvent('yanta-draw-layers-visibility', {
    detail: { open: false },
  }));

  if (!fromHistory) release?.();
}

export function openLayersPanel({ noteId, drawingId, getApi }) {
  injectCss();

  if (panel) {
    closeLayersPanel();
    return null;
  }

  const root = document.createElement('div');
  root.className = 'yanta-layers-panel';

  root.innerHTML = `
    <div class="yanta-layers-head">
      <span>${lucide('layers', 16)}</span>
      <h3>Layers</h3>
      <button class="icon-btn" data-layers-close title="Close">${lucide('x', 16)}</button>
    </div>

    <div class="yanta-layers-list" data-layers-list></div>

    <div class="yanta-layers-hint">
      The highlighted layer collects what you draw next. Top row is the front
      of the board.
    </div>

    <div class="yanta-layers-foot">
      <button class="btn" data-layers-add>${lucide('plus', 14)} New layer</button>
    </div>
  `;

  document.body.append(root);

  const onDrawingUpdated = (e) => {
    if (!panel) return;
    if (e.detail?.drawingId && e.detail.drawingId !== panel.drawingId) return;

    adoptDrawnElements();
    refresh();
  };

  // Layer state can also change from outside the panel — an AI action, a sync
  // from another device, an undo. Mirror it rather than going stale.
  const onLayersUpdated = (e) => {
    if (!panel) return;
    if (e.detail?.drawingId && e.detail.drawingId !== panel.drawingId) return;

    refresh();
  };

  panel = {
    root,
    noteId,
    drawingId,
    getApi: getApi || (() => null),
    activeLayerId: BASE_LAYER_ID,
    knownIds: new Set(),
    onDrawingUpdated,
    onLayersUpdated,
    release: null,
  };

  panel.knownIds = liveElementIds(noteId, drawingId, api());

  root.querySelector('[data-layers-close]')?.addEventListener('click', () => {
    closeLayersPanel();
  });

  root.querySelector('[data-layers-add]')?.addEventListener('click', async () => {
    const name = await yantaPrompt({
      title: 'New layer',
      label: 'Layer name',
      initial: `Layer ${listLayers(noteId, drawingId).length}`,
      confirmLabel: 'Create',
      icon: 'layers',
    });

    if (name == null) return;

    const layer = createLayer(noteId, drawingId, {
      name: name.trim(),
      api: api(),
    });

    // A layer you just made is the one you want to draw into.
    if (layer) {
      panel.activeLayerId = layer.id;
      panel.knownIds = liveElementIds(noteId, drawingId, api());
    }

    refresh();
  });

  root.querySelector('[data-layers-list]')?.addEventListener('click', onListClick);

  window.addEventListener('yanta-drawing-updated', onDrawingUpdated);
  window.addEventListener('yanta-draw-layers-updated', onLayersUpdated);

  panel.release = openBoundOverlay(PANEL_OVERLAY_ID, {
    close: () => closeLayersPanel({ fromHistory: true }),
    isOpen: () => !!panel,
  });

  window.dispatchEvent(new CustomEvent('yanta-draw-layers-visibility', {
    detail: { open: true },
  }));

  refresh();

  return root;
}

/** Number of layers a drawing uses, for the header button badge. */
export function layerCountForDrawing(noteId, drawingId) {
  return listLayers(noteId, drawingId).length;
}

export { layerIdOfElement, selectedElementIds };

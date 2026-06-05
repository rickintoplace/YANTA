// ============================================================
// YANTA — Dashboard Smart Selection
//
// Clean integration layer:
// - Desktop: rectangle selection, Cmd/Ctrl toggle, Shift range
// - Touch/Pen: long-press to enter selection
// - If selection exists: tapping/clicking cards toggles selection
// - 1 selected item: use normal in-card action bar
// - 2+ selected items: fixed floating bulk action bar, no layout shift
// - Robust rectangle cleanup
// - Small native YANTA popovers, no browser confirm/prompt
// ============================================================

import {
    $,
    el,
    uid,
    state,
    store,
    toast,
    lucide,
    escapeHtml,
  } from './core.js';
  
  import {
    openNote,
    rebuildWikilinkIndex,
    clearEditor,
  } from './notes.js';
  
  import {
    getNoteDoc,
    noteMarkdown,
    destroyNoteDoc,
  } from './yjs.js';
  
  import {
    renderTree,
  } from './tree.js';
  
  import {
    openFolderInDashboard,
  } from './item-actions.js';

  import {
    moveItemsToTrash,
  } from './trash.js';
  
  const DESKTOP_MQ = window.matchMedia('(min-width: 901px)');
  
  const TOUCH_LONG_PRESS_MS = 430;
  const ACTION_TOOLTIP_MS = 520;
  const MOVE_CANCEL_PX = 9;
  const RECT_START_PX = 5;
  
  let initialized = false;
  let mutationObserver = null;
  let syncRaf = 0;
  
  const selectedKeys = new Set();
  
  let anchorKey = '';
  let focusKey = '';
  
  let pendingCardPointer = null;
  let pendingTouchLongPress = null;
  let pendingRectStart = null;
  let activeRect = null;
  
  let suppressClickUntil = 0;
  
  let bulkBar = null;
  let actionTip = null;
  let actionTipTimer = 0;
  
  // ============================================================
  // Basic helpers
  // ============================================================
  
  function root() {
    return $('dashboard');
  }
  
  function page() {
    return root()?.querySelector('.yanta-dashboard-page') || null;
  }
  
  function dashboardVisible() {
    const r = root();
  
    if (!r || r.hidden === true) return false;
  
    /*
      Full dashboard surface.
    */
    if (state.surface === 'dashboard') return true;
  
    /*
      Dashboard may also live inside the right side pane.
      In that mode state.surface remains "note", but bulk selection should
      still work inside the dashboard pane.
    */
    if (r.closest?.('[data-side-pane-host="dashboard"], .yanta-dashboard-side-pane')) {
      return true;
    }
  
    return false;
  }
  
  function isDesktop() {
    return DESKTOP_MQ.matches;
  }
  
  function parseKey(key = '') {
    const [kind, ...rest] = String(key).split(':');
  
    return {
      kind,
      id: rest.join(':'),
    };
  }
  
  function noteKey(id) {
    return `note:${id}`;
  }
  
  function folderKey(id) {
    return `folder:${id}`;
  }
  
  function keyExists(key) {
    const { kind, id } = parseKey(key);
  
    if (kind === 'note') return state.notes.has(id);
    if (kind === 'folder') return state.folders.has(id);
  
    return false;
  }
  
  function cardFromTarget(target) {
    return target?.closest?.('.yanta-dash-card[data-key]') || null;
  }
  
  function keyFromCard(card) {
    return card?.dataset?.key || '';
  }
  
  function cardByKey(key) {
    if (!key) return null;
  
    return root()?.querySelector(
      `.yanta-dash-card[data-key="${CSS.escape(key)}"]`
    ) || null;
  }
  
  function visibleCards() {
    const r = root();
    if (!r) return [];
  
    return [...r.querySelectorAll('.yanta-dashboard-page .yanta-dash-card[data-key]')]
      .filter((card) => {
        if (card.classList.contains('drag-clone')) return false;
        if (card.classList.contains('yanta-dash-card-clone')) return false;
  
        const rect = card.getBoundingClientRect();
  
        return rect.width > 0 && rect.height > 0;
      });
  }
  
  function visibleKeys() {
    return visibleCards()
      .map((card) => card.dataset.key)
      .filter(Boolean);
  }
  
  function isInteractiveTarget(target) {
    return !!target?.closest?.(
      [
        'button',
        'input',
        'textarea',
        'select',
        'a',
        'iframe',
        '[contenteditable="true"]',
        '.yanta-inline-edit',
        '.yanta-dash-resize-handle',
        '.yanta-dash-card-actions',
        '.yanta-dashboard-selection-tray',
        '.yanta-dashboard-popover',
      ].join(',')
    );
  }
  
  function pruneSelection() {
    for (const key of [...selectedKeys]) {
      if (!keyExists(key)) selectedKeys.delete(key);
    }
  
    if (anchorKey && !keyExists(anchorKey)) {
      anchorKey = selectedKeys.values().next().value || '';
    }
  
    if (focusKey && !keyExists(focusKey)) {
      focusKey = anchorKey || selectedKeys.values().next().value || '';
    }
  
    if (!selectedKeys.size) {
      anchorKey = '';
      focusKey = '';
    }
  }
  
  function selectedItems() {
    const out = [];
  
    for (const key of selectedKeys) {
      const { kind, id } = parseKey(key);
  
      if (kind === 'note') {
        const note = state.notes.get(id);
        if (note) out.push({ key, kind, id, note });
      }
  
      if (kind === 'folder') {
        const folder = state.folders.get(id);
        if (folder) out.push({ key, kind, id, folder });
      }
    }
  
    return out;
  }
  
  function selectedNotes(items = selectedItems()) {
    return items
      .filter((item) => item.kind === 'note')
      .map((item) => item.note);
  }
  
  function selectedFolders(items = selectedItems()) {
    return items
      .filter((item) => item.kind === 'folder')
      .map((item) => item.folder);
  }
  
  function clearSelection({ sync = true } = {}) {
    selectedKeys.clear();
    anchorKey = '';
    focusKey = '';
  
    if (sync) scheduleSyncUi();
  }
  
  function setOnlySelection(key) {
    selectedKeys.clear();
  
    if (key && keyExists(key)) {
      selectedKeys.add(key);
      anchorKey = key;
      focusKey = key;
    }
  
    scheduleSyncUi();
  }
  
  function addSelection(key) {
    if (!key || !keyExists(key)) return;
  
    selectedKeys.add(key);
  
    anchorKey ||= key;
    focusKey = key;
  
    scheduleSyncUi();
  }
  
  function toggleSelection(key) {
    if (!key || !keyExists(key)) return;
  
    if (selectedKeys.has(key)) {
      selectedKeys.delete(key);
  
      if (anchorKey === key) {
        anchorKey = selectedKeys.values().next().value || '';
      }
  
      if (focusKey === key) {
        focusKey = anchorKey || selectedKeys.values().next().value || '';
      }
    } else {
      selectedKeys.add(key);
      anchorKey = key;
      focusKey = key;
    }
  
    if (!selectedKeys.size) {
      anchorKey = '';
      focusKey = '';
    }
  
    scheduleSyncUi();
  }
  
  function selectRange(fromKey, toKey) {
    const keys = visibleKeys();
  
    const a = keys.indexOf(fromKey);
    const b = keys.indexOf(toKey);
  
    if (a < 0 || b < 0) {
      setOnlySelection(toKey);
      return;
    }
  
    selectedKeys.clear();
  
    const from = Math.min(a, b);
    const to = Math.max(a, b);
  
    for (let i = from; i <= to; i++) {
      selectedKeys.add(keys[i]);
    }
  
    anchorKey = fromKey;
    focusKey = toKey;
  
    scheduleSyncUi();
  }
  
  function selectionGestureSelect(key, eventLike = {}) {
    if (!key) return;
  
    if (eventLike.shiftKey) {
      selectRange(anchorKey || key, key);
      return;
    }
  
    if (eventLike.ctrlKey || eventLike.metaKey) {
      toggleSelection(key);
      return;
    }
  
    // Selection mode:
    // - click selected => deselect
    // - click unselected => add
    if (selectedKeys.size > 0) {
      toggleSelection(key);
      return;
    }
  
    setOnlySelection(key);
  }
  
  function syncUiNow() {
    pruneSelection();
  
    const r = root();
  
    if (!r) return;
  
    const count = selectedKeys.size;
  
    r.classList.toggle('has-dashboard-selection', count > 0);
    r.classList.toggle('dashboard-selection-one', count === 1);
    r.classList.toggle('dashboard-selection-many', count > 1);
  
    for (const card of r.querySelectorAll('.yanta-dash-card[data-key]')) {
      const key = card.dataset.key || '';
      const selected = selectedKeys.has(key);
  
      card.classList.toggle('selected', selected);
      card.classList.toggle('bulk-selected', selected);
      card.classList.toggle('bulk-focus', key === focusKey);
  
      card.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
  
    renderBulkTray();
  }
  
  function scheduleSyncUi() {
    cancelAnimationFrame(syncRaf);
  
    syncRaf = requestAnimationFrame(() => {
      syncRaf = 0;
      syncUiNow();
    });
  }
  
  // ============================================================
  // Rectangle selection
  // ============================================================
  
  function removeStaleRectangles() {
    document
      .querySelectorAll('.yanta-dashboard-select-rect')
      .forEach((node) => node.remove());
  
    document.body.classList.remove('yanta-dashboard-rect-selecting');
  }
  
  function rectsIntersect(a, b) {
    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  }
  
  function canStartRect(e) {
    if (!dashboardVisible()) return false;
    if (!isDesktop()) return false;
    if (e.pointerType && e.pointerType !== 'mouse') return false;
    if (e.button != null && e.button !== 0) return false;
  
    const r = root();
    const target = e.target instanceof Element ? e.target : null;
  
    if (!r || !target || !r.contains(target)) return false;
  
    /*
      Do not start rectangle selection from cards or controls.
      Card clicks/drags are handled by dashboard.js and selection gestures.
    */
    if (cardFromTarget(target)) return false;
    if (isInteractiveTarget(target)) return false;
  
    /*
      Important:
      In folder views, especially with centered/narrow content, pointerdown
      often lands on #dashboard padding instead of the inner page/body/grid.
      Allow the dashboard root as rectangle start area too.
    */
    return (
      target === r ||
      !!target.closest?.(
        [
          '#dashboard',
          '.dashboard',
          '.yanta-dashboard-page',
          '.yanta-dashboard-body',
          '.yanta-dashboard-grid',
          '.yanta-side-pane-body',
        ].join(',')
      )
    );
  }
  
  function beginPendingRect(e) {
    pendingRectStart = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      additive: e.ctrlKey || e.metaKey,
      base: new Set(selectedKeys),
    };
  
    document.addEventListener('pointermove', onPendingRectMove, true);
    document.addEventListener('pointerup', onPendingRectUp, true);
    document.addEventListener('pointercancel', onPendingRectCancel, true);
  }
  
  function cleanupPendingRect() {
    document.removeEventListener('pointermove', onPendingRectMove, true);
    document.removeEventListener('pointerup', onPendingRectUp, true);
    document.removeEventListener('pointercancel', onPendingRectCancel, true);
  
    pendingRectStart = null;
  }
  
  function activateRectSelection(e) {
    if (!pendingRectStart) return;
  
    removeStaleRectangles();
  
    const overlay = document.createElement('div');
    overlay.className = 'yanta-dashboard-select-rect';
    document.body.append(overlay);
  
    const cards = visibleCards()
      .map((card) => ({
        card,
        key: card.dataset.key,
        rect: card.getBoundingClientRect(),
      }))
      .filter((item) => item.key);
  
    activeRect = {
      ...pendingRectStart,
      overlay,
      cards,
      x: e.clientX,
      y: e.clientY,
      raf: 0,
    };
  
    document.body.classList.add('yanta-dashboard-rect-selecting');
  
    cleanupPendingRect();
  
    document.addEventListener('pointermove', onActiveRectMove, true);
    document.addEventListener('pointerup', onActiveRectUp, true);
    document.addEventListener('pointercancel', onActiveRectCancel, true);
  
    updateRectSelection(e.clientX, e.clientY);
  }
  
  function cleanupActiveRect({ revert = false } = {}) {
    if (!activeRect) return;
  
    cancelAnimationFrame(activeRect.raf);
  
    if (revert) {
      selectedKeys.clear();
      for (const key of activeRect.base) selectedKeys.add(key);
    }
  
    activeRect.overlay?.remove();
  
    document.body.classList.remove('yanta-dashboard-rect-selecting');
  
    document.removeEventListener('pointermove', onActiveRectMove, true);
    document.removeEventListener('pointerup', onActiveRectUp, true);
    document.removeEventListener('pointercancel', onActiveRectCancel, true);
  
    activeRect = null;
  
    suppressClickUntil = performance.now() + 300;
  
    scheduleSyncUi();
  }
  
  function updateRectSelection(clientX, clientY) {
    if (!activeRect) return;
  
    activeRect.x = clientX;
    activeRect.y = clientY;
  
    if (activeRect.raf) return;
  
    activeRect.raf = requestAnimationFrame(() => {
      if (!activeRect) return;
  
      activeRect.raf = 0;
  
      const left = Math.min(activeRect.startX, activeRect.x);
      const top = Math.min(activeRect.startY, activeRect.y);
      const right = Math.max(activeRect.startX, activeRect.x);
      const bottom = Math.max(activeRect.startY, activeRect.y);
  
      const selectRect = {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
      };
  
      Object.assign(activeRect.overlay.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${selectRect.width}px`,
        height: `${selectRect.height}px`,
      });
  
      const next = new Set(activeRect.additive ? activeRect.base : []);
  
      for (const item of activeRect.cards) {
        if (rectsIntersect(selectRect, item.rect)) {
          next.add(item.key);
        }
      }
  
      selectedKeys.clear();
  
      for (const key of next) {
        if (keyExists(key)) selectedKeys.add(key);
      }
  
      if (selectedKeys.size && !anchorKey) {
        anchorKey = selectedKeys.values().next().value || '';
      }
  
      focusKey = selectedKeys.values().next().value || '';
  
      scheduleSyncUi();
    });
  }
  
  function onPendingRectMove(e) {
    if (!pendingRectStart || e.pointerId !== pendingRectStart.pointerId) return;
  
    const dist = Math.hypot(
      e.clientX - pendingRectStart.startX,
      e.clientY - pendingRectStart.startY
    );
  
    if (dist >= RECT_START_PX) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
  
      activateRectSelection(e);
    }
  }
  
  function onPendingRectUp(e) {
    if (!pendingRectStart || e.pointerId !== pendingRectStart.pointerId) return;
  
    const hadSelection = selectedKeys.size > 0;
  
    cleanupPendingRect();
  
    // Plain blank click clears selection.
    if (hadSelection) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
  
      clearSelection();
      suppressClickUntil = performance.now() + 250;
    }
  }
  
  function onPendingRectCancel(e) {
    if (!pendingRectStart || e.pointerId !== pendingRectStart.pointerId) return;
  
    cleanupPendingRect();
  }
  
  function onActiveRectMove(e) {
    if (!activeRect || e.pointerId !== activeRect.pointerId) return;
  
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  
    updateRectSelection(e.clientX, e.clientY);
  }
  
  function onActiveRectUp(e) {
    if (!activeRect || e.pointerId !== activeRect.pointerId) return;
  
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
  
    cleanupActiveRect();
  }
  
  function onActiveRectCancel(e) {
    if (!activeRect || e.pointerId !== activeRect.pointerId) return;
  
    cleanupActiveRect({ revert: true });
  }
  
  // ============================================================
  // Card selection gestures
  // ============================================================
  
  function beginCardPointer(e, card) {
    const key = keyFromCard(card);
    if (!key) return;
  
    pendingCardPointer = {
      pointerId: e.pointerId,
      key,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    };
  
    document.addEventListener('pointermove', onCardPointerMove, true);
    document.addEventListener('pointerup', onCardPointerUp, true);
    document.addEventListener('pointercancel', onCardPointerCancel, true);
  }
  
  function cleanupCardPointer() {
    document.removeEventListener('pointermove', onCardPointerMove, true);
    document.removeEventListener('pointerup', onCardPointerUp, true);
    document.removeEventListener('pointercancel', onCardPointerCancel, true);
  
    pendingCardPointer = null;
  }
  
  function onCardPointerMove(e) {
    if (!pendingCardPointer || e.pointerId !== pendingCardPointer.pointerId) return;
  
    const dist = Math.hypot(
      e.clientX - pendingCardPointer.startX,
      e.clientY - pendingCardPointer.startY
    );
  
    if (dist > MOVE_CANCEL_PX) {
      pendingCardPointer.moved = true;
    }
  }
  
  function onCardPointerUp(e) {
    if (!pendingCardPointer || e.pointerId !== pendingCardPointer.pointerId) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    const snap = pendingCardPointer;

    /*
      Wenn kurz vorher ein Longpress gefeuert hat, darf pointerup
      NICHT nochmal toggeln. Sonst verliert man bei Bulk-Selection
      die Mehrfachauswahl oder reduziert auf eine einzelne Card.
    */
    const longPressAlreadyHandled =
      performance.now() < suppressClickUntil;

    cleanupCardPointer();

    if (!longPressAlreadyHandled && !snap.moved) {
      selectionGestureSelect(snap.key, snap);
    }

    suppressClickUntil = performance.now() + 350;
  }
  
  function onCardPointerCancel(e) {
    if (!pendingCardPointer || e.pointerId !== pendingCardPointer.pointerId) return;
  
    cleanupCardPointer();
  }
  
  function armTouchLongPress(e, card) {
    if (!card || isInteractiveTarget(e.target)) return;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;

    const key = keyFromCard(card);
    if (!key) return;

    clearTouchLongPress();

    pendingTouchLongPress = {
      pointerId: e.pointerId,
      key,
      startX: e.clientX,
      startY: e.clientY,
      fired: false,
      timer: window.setTimeout(() => {
        if (!pendingTouchLongPress || pendingTouchLongPress.pointerId !== e.pointerId) return;

        pendingTouchLongPress.fired = true;

        /*
          Mobile UX:
          - Erster Longpress ohne Auswahl: Selection starten.
          - Longpress innerhalb bestehender Multiselection:
              NICHT toggeln / NICHT auf eine Note reduzieren.
              Selection erhalten, ggf. unselektierte Note ergänzen.
            Danach darf das contextmenu-Event Bulk-Actions öffnen.
        */
        if (selectedKeys.size > 0) {
          if (!selectedKeys.has(key)) {
            selectedKeys.add(key);
          }

          anchorKey ||= key;
          focusKey = key;

          scheduleSyncUi();
        } else {
          addSelection(key);
        }

        /*
          Verhindert, dass der anschließende pointerup/click die gerade
          erhaltene Bulk-Selection wieder toggelt.
        */
        suppressClickUntil = performance.now() + 900;

        try {
          navigator.vibrate?.(10);
        } catch {}
      }, TOUCH_LONG_PRESS_MS),
    };

    document.addEventListener('pointermove', onTouchLongPressMove, true);
    document.addEventListener('pointerup', onTouchLongPressEnd, true);
    document.addEventListener('pointercancel', onTouchLongPressEnd, true);
  }
  
  function clearTouchLongPress() {
    if (pendingTouchLongPress?.timer) {
      clearTimeout(pendingTouchLongPress.timer);
    }
  
    document.removeEventListener('pointermove', onTouchLongPressMove, true);
    document.removeEventListener('pointerup', onTouchLongPressEnd, true);
    document.removeEventListener('pointercancel', onTouchLongPressEnd, true);
  
    pendingTouchLongPress = null;
  }
  
  function onTouchLongPressMove(e) {
    if (!pendingTouchLongPress || e.pointerId !== pendingTouchLongPress.pointerId) return;
  
    const dist = Math.hypot(
      e.clientX - pendingTouchLongPress.startX,
      e.clientY - pendingTouchLongPress.startY
    );
  
    if (dist > MOVE_CANCEL_PX) {
      clearTouchLongPress();
    }
  }
  
  function onTouchLongPressEnd(e) {
    if (!pendingTouchLongPress || e.pointerId !== pendingTouchLongPress.pointerId) return;
  
    if (pendingTouchLongPress.fired) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    }
  
    clearTouchLongPress();
  }
  
  // ============================================================
  // Bulk tray
  // ============================================================
  
  function removeBulkTray() {
    bulkBar?.remove();
    bulkBar = null;
  }
  
  function renderBulkTray() {
    removeBulkTray();
  
    const items = selectedItems();
  
    // Important UX:
    // 0 items: no tray
    // 1 item: no tray; normal card actionbar is shown
    if (items.length <= 1) return;
  
    const notes = selectedNotes(items);
    const folders = selectedFolders(items);
  
    bulkBar = el('div', {
      class: 'yanta-dashboard-selection-tray',
      role: 'toolbar',
      'aria-label': 'Dashboard bulk actions',
      onpointerdown: (e) => {
        e.stopPropagation();
      },
      onclick: (e) => {
        e.stopPropagation();
      },
    });
  
    const summary = el('div', { class: 'yanta-dashboard-selection-summary' });
  
    summary.innerHTML = `
      <strong>${items.length}</strong>
      <span>selected</span>
      <small>${notes.length} note${notes.length === 1 ? '' : 's'} · ${folders.length} folder${folders.length === 1 ? '' : 's'}</small>
    `;
  
    const actions = el('div', { class: 'yanta-dashboard-selection-actions' });
  
    actions.append(
      trayButton({
        icon: 'palette',
        label: 'Appearance',
        description: 'Change icon and color for all selected items.',
        onClick: () => editAppearance(items),
      }),
    );
  
    if (notes.length) {
      const anyUnpinned = notes.some((n) => !n.pinned);
      const anyPinned = notes.some((n) => n.pinned);
  
      actions.append(
        trayButton({
          icon: 'pin',
          label: 'Pin',
          description: 'Pin selected notes to the dashboard top area.',
          disabled: !anyUnpinned,
          onClick: () => setPinned(notes, true),
        }),
  
        trayButton({
          icon: 'pin-off',
          label: 'Unpin',
          description: 'Remove selected notes from the dashboard top area.',
          disabled: !anyPinned,
          onClick: () => setPinned(notes, false),
        }),
  
        trayButton({
          icon: 'copy',
          label: 'Duplicate',
          description: 'Duplicate selected notes including markdown content.',
          onClick: () => duplicateNotes(notes),
        }),
      );
    }
  
    actions.append(
      trayButton({
        icon: 'folder-input',
        label: 'Move',
        description: 'Move selected items to another folder or Home.',
        onClick: () => moveItems(items),
      }),
  
      trayButton({
        icon: 'trash',
        label: 'Delete',
        danger: true,
        description: 'Delete selected items. Folders include their contents.',
        onClick: () => deleteItems(items),
      }),
  
      trayButton({
        icon: 'x',
        label: 'Clear',
        description: 'Clear selection.',
        onClick: () => clearSelection(),
      }),
    );
  
    bulkBar.append(summary, actions);
    document.body.append(bulkBar);
  }
  
  function trayButton({
    icon,
    label,
    description = label,
    danger = false,
    disabled = false,
    onClick,
  }) {
    const btn = el('button', {
      type: 'button',
      class:
        'yanta-dash-action-btn yanta-dashboard-tray-btn' +
        (danger ? ' danger' : ''),
      disabled,
      title: description,
      'aria-label': label,
      dataset: {
        actionDescription: description,
      },
      onpointerdown: (e) => {
        // Stop dashboard/card pointer handlers, but DO NOT preventDefault.
        // Preventing default here can kill click on desktop.
        e.stopPropagation();
      },
      onclick: async (e) => {
        e.preventDefault();
        e.stopPropagation();
  
        if (disabled) return;
  
        try {
          await onClick?.();
        } catch (err) {
          console.error(err);
          toast('Action failed', 'error');
        }
      },
    });
  
    btn.innerHTML = `${lucide(icon, 15)} <span>${escapeHtml(label)}</span>`;
  
    return btn;
  }
  
  // ============================================================
  // Bulk actions
  // ============================================================
  
  async function setPinned(notes, pinned) {
    for (const note of notes) {
      note.pinned = pinned;
      note.updated = Date.now();
  
      if (pinned && note.dashboardPinnedOrder == null) {
        note.dashboardPinnedOrder = Date.now();
      }
  
      await store.notes.put(note);
    }
  
    toast(
      `${pinned ? 'Pinned' : 'Unpinned'} ${notes.length} note${notes.length === 1 ? '' : 's'}`,
      'success'
    );
  
    window.dispatchEvent(new CustomEvent('yanta-note-updated', {
      detail: {
        reason: pinned ? 'bulk-pin' : 'bulk-unpin',
        source: 'dashboard',
      },
    }));
  
    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));
  }
  
  async function duplicateNotes(notes) {
    let count = 0;
  
    for (const src of notes) {
      await duplicateNote(src);
      count++;
    }
  
    rebuildWikilinkIndex();
    renderTree();
  
    toast(`Duplicated ${count} note${count === 1 ? '' : 's'}`, 'success');
  
    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));
  }
  
  async function duplicateNote(src) {
    const id = uid();
  
    const copy = {
      ...src,
      id,
      title: `${src.title || 'Untitled'} (copy)`,
      pinned: false,
      dashboardOrder: Date.now(),
      dashboardPinnedOrder: undefined,
      created: Date.now(),
      updated: Date.now(),
    };
  
    delete copy.body;
    delete copy.bodyMigrated;
  
    state.notes.set(id, copy);
    await store.notes.put(copy);
  
    try {
      const srcEntry = getNoteDoc(src.id);
      await srcEntry.ready;
  
      const dstEntry = getNoteDoc(id);
      await dstEntry.ready;
  
      const body = noteMarkdown(src.id);
  
      if (body) {
        dstEntry.doc.getText('markdown').insert(0, body);
      }
  
      state.searchIndex.set(
        id,
        [
          copy.title || '',
          (copy.tags || []).join(' '),
          body || '',
        ].join(' ').toLowerCase()
      );
    } catch {}
  }
  
  async function editAppearance(items) {
    const keys = items.map((item) => item.key);
  
    const {
      editTreeAppearanceTargets,
    } = await import('./graph.js');
  
    editTreeAppearanceTargets(keys, {
      title: `Icon & color for ${items.length} selected items`,
    });
  }
  
  function folderPath(folderId) {
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
  
  function folderIsAncestor(ancestorId, descendantId) {
    if (!ancestorId || !descendantId) return false;
  
    let cur = state.folders.get(descendantId);
    const seen = new Set();
  
    while (cur && !seen.has(cur.id)) {
      if (cur.id === ancestorId) return true;
  
      seen.add(cur.id);
      cur = cur.parentId ? state.folders.get(cur.parentId) : null;
    }
  
    return false;
  }
  
  async function moveItems(items) {
    const targetFolderId = await folderPickerPopover({
      title: 'Move selected items',
      items,
    });
  
    if (targetFolderId === undefined) return;
  
    let moved = 0;
    let skipped = 0;
  
    for (const item of items) {
      if (item.kind === 'note') {
        const note = state.notes.get(item.id);
        if (!note) continue;
  
        note.folderId = targetFolderId || null;
        note.updated = Date.now();
  
        await store.notes.put(note);
        moved++;
      }
  
      if (item.kind === 'folder') {
        const folder = state.folders.get(item.id);
        if (!folder) continue;
  
        if (
          targetFolderId &&
          (
            targetFolderId === folder.id ||
            folderIsAncestor(folder.id, targetFolderId)
          )
        ) {
          skipped++;
          continue;
        }
  
        folder.parentId = targetFolderId || null;
        folder.updated = Date.now();
  
        await store.folders.put(folder);
        moved++;
      }
    }
  
    if (targetFolderId) {
      state.expandedFolders.add(targetFolderId);
    }
  
    toast(
      skipped
        ? `Moved ${moved}; skipped ${skipped} invalid folder move${skipped === 1 ? '' : 's'}`
        : `Moved ${moved} item${moved === 1 ? '' : 's'}`,
      skipped ? 'error' : 'success'
    );
  
    clearSelection({ sync: false });
  
    renderTree();
    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh'));
  }
  
  function collectFolderIdsRecursive(folderId) {
    const out = new Set();
    const stack = [folderId];
  
    while (stack.length) {
      const id = stack.pop();
  
      if (!id || out.has(id)) continue;
  
      out.add(id);
  
      for (const folder of state.folders.values()) {
        if (folder.parentId === id) {
          stack.push(folder.id);
        }
      }
    }
  
    return out;
  }
  
  async function deleteItems(items) {
    const directFolderIds = new Set(
      items
        .filter((item) => item.kind === 'folder')
        .map((item) => item.id)
    );

    const directNoteIds = new Set(
      items
        .filter((item) => item.kind === 'note')
        .map((item) => item.id)
    );

    if (!directFolderIds.size && !directNoteIds.size) return;

    let descendantFolderCount = 0;
    let descendantNoteCount = 0;

    for (const folderId of directFolderIds) {
      const folderIds = collectFolderIdsRecursive(folderId);
      descendantFolderCount += Math.max(0, folderIds.size - 1);

      for (const note of state.notes.values()) {
        if (note.folderId && folderIds.has(note.folderId)) {
          descendantNoteCount++;
        }
      }
    }

    const what = [
      directNoteIds.size ? `${directNoteIds.size} note${directNoteIds.size === 1 ? '' : 's'}` : '',
      directFolderIds.size ? `${directFolderIds.size} folder${directFolderIds.size === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');

    const extra =
      descendantFolderCount || descendantNoteCount
        ? `\n\nSelected folders include ${descendantFolderCount} sub-folder${descendantFolderCount === 1 ? '' : 's'} and ${descendantNoteCount} note${descendantNoteCount === 1 ? '' : 's'}.`
        : '';

    const ok = await confirmPopover({
      title: 'Move selected items to Trash',
      message: `Move ${what} to Trash?${extra}\n\nYou can restore them later from Trash.`,
      confirmLabel: 'Move to Trash',
      danger: true,
    });

    if (!ok) return;

    await moveItemsToTrash({
      noteIds: [...directNoteIds],
      folderIds: [...directFolderIds],
      source: 'dashboard-multiselect',
    });

    clearSelection({ sync: false });

    renderTree();

    window.dispatchEvent(new CustomEvent('yanta-dashboard-refresh', {
      detail: {
        reason: 'trash-selected',
        source: 'dashboard-multiselect',
      },
    }));
  }
  
  // ============================================================
  // Small native popovers
  // ============================================================
  
  function popoverCard({
    className = '',
    html = '',
  } = {}) {
    const host = document.createElement('div');
    host.className = `yanta-dashboard-popover ${className}`;
    host.innerHTML = html;
    document.body.append(host);
  
    return host;
  }
  
  function positionPopover(host) {
    requestAnimationFrame(() => {
      const r = host.getBoundingClientRect();
  
      let left = Math.round((window.innerWidth - r.width) / 2);
      let top = Math.round((window.innerHeight - r.height) / 2);
  
      left = Math.max(10, Math.min(window.innerWidth - r.width - 10, left));
      top = Math.max(10, Math.min(window.innerHeight - r.height - 10, top));
  
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
    });
  }
  
  function confirmPopover({
    title = 'Confirm',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
  } = {}) {
    return new Promise((resolve) => {
      const host = popoverCard({
        className: 'yanta-dashboard-confirm-popover',
        html: `
          <div class="yanta-dashboard-popover-head">
            <strong>${escapeHtml(title)}</strong>
            <button class="icon-btn" data-cancel>&times;</button>
          </div>
  
          <div class="yanta-dashboard-popover-body">
            <div class="yanta-dashboard-popover-message">
              ${escapeHtml(message).replace(/\n/g, '<br>')}
            </div>
  
            <div class="compress-actions">
              <button class="btn" data-cancel>${escapeHtml(cancelLabel)}</button>
              <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm>
                ${escapeHtml(confirmLabel)}
              </button>
            </div>
          </div>
        `,
      });
  
      const finish = (value) => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', onKey, true);
        host.remove();
        resolve(value);
      };
  
      const outside = (e) => {
        if (!host.contains(e.target)) finish(false);
      };
  
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      };
  
      host.querySelectorAll('[data-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => finish(false));
      });
  
      host.querySelector('[data-confirm]')?.addEventListener('click', () => {
        finish(true);
      });
  
      positionPopover(host);
  
      setTimeout(() => {
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', onKey, true);
        host.querySelector('[data-confirm]')?.focus?.();
      }, 0);
    });
  }
  
  function folderPickerPopover({
    title = 'Choose folder',
    items = [],
  } = {}) {
    return new Promise((resolve) => {
      const selectedFolderIds = new Set(
        items
          .filter((item) => item.kind === 'folder')
          .map((item) => item.id)
      );
  
      const folders = [...state.folders.values()]
        .sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id)));
  
      const canMoveTo = (folderId) => {
        if (!folderId) return true;
  
        for (const selectedId of selectedFolderIds) {
          if (folderId === selectedId) return false;
          if (folderIsAncestor(selectedId, folderId)) return false;
        }
  
        return true;
      };
  
      const host = popoverCard({
        className: 'yanta-dashboard-folder-popover',
        html: `
          <div class="yanta-dashboard-popover-head">
            <strong>${escapeHtml(title)}</strong>
            <button class="icon-btn" data-cancel>&times;</button>
          </div>
  
          <div class="yanta-dashboard-popover-body">
            <div class="yanta-dashboard-folder-list">
              <button class="yanta-dashboard-folder-option" data-folder-id="">
                ${lucide('home', 15)}
                <span>Home / no folder</span>
              </button>
  
              ${folders.map((folder) => {
                const disabled = !canMoveTo(folder.id);
  
                return `
                  <button class="yanta-dashboard-folder-option"
                    data-folder-id="${escapeHtml(folder.id)}"
                    ${disabled ? 'disabled' : ''}>
                    ${lucide(folder.icon || 'folder', 15)}
                    <span>${escapeHtml(folderPath(folder.id) || folder.name || 'Folder')}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        `,
      });
  
      const finish = (value) => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', onKey, true);
        host.remove();
        resolve(value);
      };
  
      const outside = (e) => {
        if (!host.contains(e.target)) finish(undefined);
      };
  
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(undefined);
        }
      };
  
      host.querySelectorAll('[data-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => finish(undefined));
      });
  
      host.querySelectorAll('[data-folder-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          finish(btn.dataset.folderId || null);
        });
      });
  
      positionPopover(host);
  
      setTimeout(() => {
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
    });
  }
  
  // ============================================================
  // Action long-press descriptions
  // ============================================================
  
  function ensureActionTip() {
    if (actionTip) return actionTip;
  
    actionTip = document.createElement('div');
    actionTip.className = 'yanta-dashboard-action-tooltip';
    actionTip.hidden = true;
    document.body.append(actionTip);
  
    return actionTip;
  }
  
  
  function hideActionTip() {
    clearTimeout(actionTipTimer);
  
    if (actionTip) actionTip.hidden = true;
  }
  
  function showActionTip(btn, frozenText = '') {
    const text =
      frozenText ||
      btn?.dataset?.actionDescription ||
      btn?.getAttribute?.('aria-label') ||
      btn?.title ||
      '';
  
    if (!text) return;
  
    const tip = ensureActionTip();
  
    tip.textContent = text;
    tip.hidden = false;
  
    const r = btn.getBoundingClientRect();
  
    requestAnimationFrame(() => {
      if (!tip || tip.hidden) return;
  
      const tr = tip.getBoundingClientRect();
  
      let left = r.left + r.width / 2 - tr.width / 2;
      let top = r.top - tr.height - 9;
  
      if (top < 8) top = r.bottom + 9;
      if (left < 8) left = 8;
      if (left + tr.width > window.innerWidth - 8) {
        left = window.innerWidth - tr.width - 8;
      }
  
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    });
  
    window.setTimeout(() => {
      if (tip) tip.hidden = true;
    }, 1700);
  }
  
  function bindActionDescriptionTooltip() {
    let press = null;
  
    const textForButton = (btn) =>
      btn?.dataset?.actionDescription ||
      btn?.getAttribute?.('aria-label') ||
      btn?.title ||
      '';
  
    const buttonAtPoint = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit?.closest?.('.yanta-dash-action-btn') || null;
    };
  
    const cancel = () => {
      press = null;
      hideActionTip();
    };
  
    document.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest?.('.yanta-dash-action-btn');
  
      if (!btn || btn.disabled) return;
  
      const text = textForButton(btn);
      if (!text) return;
  
      clearTimeout(actionTipTimer);
  
      press = {
        btn,
        text,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
      };
  
      actionTipTimer = window.setTimeout(() => {
        if (!press) return;
  
        const {
          btn,
          text,
          startX,
          startY,
          lastX,
          lastY,
        } = press;
  
        const moved = Math.hypot(lastX - startX, lastY - startY);
        const currentBtn = buttonAtPoint(lastX, lastY);
  
        // Wichtig:
        // Nur anzeigen, wenn der Pointer noch auf exakt demselben Button ist.
        // Dadurch zeigen alte Timer oder leichte Bewegungen keinen falschen Text.
        if (
          moved > MOVE_CANCEL_PX ||
          !btn.isConnected ||
          currentBtn !== btn
        ) {
          cancel();
          return;
        }
  
        press = null;
        actionTipTimer = 0;
  
        showActionTip(btn, text);
      }, ACTION_TOOLTIP_MS);
    }, true);
  
    document.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.pointerId) return;
  
      press.lastX = e.clientX;
      press.lastY = e.clientY;
  
      const moved = Math.hypot(
        e.clientX - press.startX,
        e.clientY - press.startY
      );
  
      const currentBtn = buttonAtPoint(e.clientX, e.clientY);
  
      if (moved > MOVE_CANCEL_PX || currentBtn !== press.btn) {
        cancel();
      }
    }, true);
  
    document.addEventListener('pointerup', (e) => {
      if (!press || e.pointerId !== press.pointerId) return;
      cancel();
    }, true);
  
    document.addEventListener('pointercancel', (e) => {
      if (!press || e.pointerId !== press.pointerId) return;
      cancel();
    }, true);
  
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('blur', cancel);
  }
  
  // ============================================================
  // CSS
  // ============================================================
  
  function injectCss() {
    document.getElementById('yanta-dashboard-multiselect-css')?.remove();
  
    const style = document.createElement('style');
    style.id = 'yanta-dashboard-multiselect-css';
  
    style.textContent = `
  /* ============================================================
     Dashboard selection state
     ============================================================ */
  
  .yanta-dash-card.bulk-selected {
    outline-offset: 2px;
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 42%, transparent),
      0 16px 38px rgba(0,0,0,0.24);
  }
  
  .yanta-dash-card.bulk-selected::after {
    content: "";
    position: absolute;
    right: 9px;
    top: 9px;
    width: 19px;
    height: 19px;
    border-radius: 999px;
    background: var(--accent);
    box-shadow: 0 2px 10px rgba(0,0,0,0.26);
    z-index: 8;
    pointer-events: none;
  }
  
  .yanta-dash-card.bulk-selected::before {
    content: "✓";
    position: absolute;
    right: 12px;
    top: 7px;
    color: white;
    font-size: 14px;
    font-weight: 900;
    z-index: 9;
    pointer-events: none;
  }
  
  .yanta-dash-card.bulk-focus {
    outline-offset: 4px;
  }
  
  /*
    Single selection:
    - no bulk tray
    - show the normal in-card actionbar for the selected card
  */
  #dashboard.dashboard-selection-one .yanta-dash-card:not(.bulk-selected) .yanta-dash-card-actions {
    opacity: 0;
    pointer-events: none;
  }
  
  #dashboard.dashboard-selection-one .yanta-dash-card.bulk-selected .yanta-dash-card-actions {
    display: flex !important;
    opacity: 1 !important;
    pointer-events: auto !important;
    transform: none !important;
  }
  
  /*
    Multi selection:
    - card actions hidden
    - fixed tray handles bulk actions
  */
  #dashboard.dashboard-selection-many .yanta-dash-card .yanta-dash-card-actions {
    opacity: 0 !important;
    pointer-events: none !important;
  }
  
  /* ============================================================
     Fixed selection tray — no layout shift
     ============================================================ */
  
  .yanta-dashboard-selection-tray {
    position: fixed;
    left: 50%;
    bottom: max(18px, env(safe-area-inset-bottom));
  
    z-index: 130;
    transform: translateX(-50%);
  
    width: min(860px, calc(100vw - 24px));
    padding: 9px 10px;
  
    display: flex;
    align-items: center;
    gap: 12px;
  
    border: 1px solid color-mix(in srgb, var(--accent) 36%, var(--border));
    border-radius: 999px;
  
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev));
  
    box-shadow:
      0 20px 60px rgba(0,0,0,0.32),
      0 1px 0 rgba(255,255,255,0.05) inset;
  
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  
    animation: yanta-selection-tray-in 130ms cubic-bezier(.2,.8,.2,1);
  }
  
  @keyframes yanta-selection-tray-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }
  
  .yanta-dashboard-selection-summary {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    color: var(--text);
    padding-left: 4px;
  }
  
  .yanta-dashboard-selection-summary strong {
    color: var(--accent);
    font-size: 15px;
  }
  
  .yanta-dashboard-selection-summary span {
    font-weight: 850;
    font-size: 13px;
  }
  
  .yanta-dashboard-selection-summary small {
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }
  
  .yanta-dashboard-selection-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-left: auto;
  }
  
  .yanta-dashboard-tray-btn {
  
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  
    border-radius: 999px;
    border: 1px solid var(--border);
  
    background: var(--bg-elev-2);
    color: var(--text);
  
    font-size: 12px;
    font-weight: 760;
  
    cursor: pointer;

    width: auto;
    padding: 0 8px;
  }
  
  .yanta-dashboard-tray-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev-2));
  }
  
  .yanta-dashboard-tray-btn.danger {
    color: var(--red);
  }
  
  .yanta-dashboard-tray-btn.danger:hover:not(:disabled) {
    border-color: var(--red);
    background: color-mix(in srgb, var(--red) 10%, var(--bg-elev-2));
  }
  
  .yanta-dashboard-tray-btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  
  /* ============================================================
     Rectangle select
     ============================================================ */
  
  .yanta-dashboard-select-rect {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
  
    border: 1px solid var(--accent);
    border-radius: 8px;
  
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent) inset;
  }
  
  body.yanta-dashboard-rect-selecting,
  body.yanta-dashboard-rect-selecting * {
    cursor: crosshair !important;
    user-select: none !important;
  }
  
  /* ============================================================
     Small floating popovers
     ============================================================ */
  
  .yanta-dashboard-popover {
    position: fixed;
    z-index: 260;
  
    width: min(460px, calc(100vw - 24px));
    max-height: min(76vh, 620px);
  
    display: flex;
    flex-direction: column;
    overflow: hidden;
  
    border: 1px solid var(--border);
    border-radius: 14px;
  
    background: var(--bg-elev);
    color: var(--text);
  
    box-shadow: 0px 10px 36px rgb(0 0 0 / 22%);
    animation: yanta-pop-in 120ms cubic-bezier(.2,.8,.2,1);
  }
  
  @keyframes yanta-pop-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  
  .yanta-dashboard-popover-head {
    min-height: 44px;
    padding: 10px 12px;
  
    display: flex;
    align-items: center;
    gap: 10px;
  
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev-2);
  }
  
  .yanta-dashboard-popover-head strong {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  
  .yanta-dashboard-popover-body {
    padding: 13px;
    overflow: auto;
  }
  
  .yanta-dashboard-popover-message {
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.5;
    margin-bottom: 14px;
  }
  
  .yanta-dashboard-folder-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: min(58vh, 440px);
    overflow: auto;
  }
  
  .yanta-dashboard-folder-option {
    width: 100%;
    min-height: 38px;
    padding: 8px 10px;
  
    display: flex;
    align-items: center;
    gap: 9px;
  
    border: 1px solid var(--border);
    border-radius: 9px;
  
    background: var(--bg-elev-2);
    color: var(--text);
  
    cursor: pointer;
    text-align: left;
  }
  
  .yanta-dashboard-folder-option:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
  }
  
  .yanta-dashboard-folder-option:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  
  /* ============================================================
     Action description tooltip
     ============================================================ */
  
  .yanta-dashboard-action-tooltip {
    position: fixed;
    z-index: 10000;
  
    max-width: min(320px, calc(100vw - 24px));
    padding: 7px 10px;
  
    border: 1px solid var(--border);
    border-radius: 999px;
  
    background: color-mix(in srgb, var(--bg-elev-3) 96%, transparent);
    color: var(--text);
  
    font-size: 12px;
    line-height: 1.25;
  
    box-shadow: 0 12px 32px rgba(0,0,0,0.35);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  
    pointer-events: none;
    animation: yanta-tip-in 120ms ease;
  }
  
  .yanta-dashboard-action-tooltip[hidden] {
    display: none !important;
  }
  
  @keyframes yanta-tip-in {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  
  /* ============================================================
     Mobile
     ============================================================ */
  
  @media (max-width: 900px) {
    .yanta-dashboard-selection-tray {
      bottom: max(14px, env(safe-area-inset-bottom));
      width: min(560px, calc(100vw - 18px));
      border-radius: 18px;
      align-items: stretch;
      flex-direction: column;
      gap: 8px;
    }
  
    .yanta-dashboard-selection-summary {
      justify-content: center;
      padding-left: 0;
    }
  
    .yanta-dashboard-selection-summary small {
      display: none;
    }
  
    .yanta-dashboard-selection-actions {
      margin-left: 0;
      justify-content: center;
    }
  
    .yanta-dashboard-tray-btn span {
      display: none;
    }
  }
  
  @media (prefers-reduced-motion: reduce) {
    .yanta-dashboard-selection-tray,
    .yanta-dashboard-popover,
    .yanta-dashboard-action-tooltip {
      animation: none !important;
    }
  }
  `;
  
    document.head.append(style);
  }
  
  // ============================================================
  // Binding
  // ============================================================
  
  function bindSelectionEvents() {
    document.addEventListener('pointerdown', (e) => {
      if (!dashboardVisible()) return;
  
      if (canStartRect(e)) {
        beginPendingRect(e);
        return;
      }
  
      const card = cardFromTarget(e.target);
      if (!card) return;
  
      if (isInteractiveTarget(e.target)) return;
  
      armTouchLongPress(e, card);
  
      const key = keyFromCard(card);
      if (!key) return;
  
      const wantsSelection =
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        selectedKeys.size > 0;
  
      if (!wantsSelection) return;
  
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
  
      beginCardPointer(e, card);
    }, {
      capture: true,
      passive: false,
    });
  
    document.addEventListener('click', (e) => {
      if (!dashboardVisible()) return;
      if (performance.now() > suppressClickUntil) return;
  
      const card = cardFromTarget(e.target);
      if (!card) return;
  
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    }, true);
  
    document.addEventListener('keydown', (e) => {
      if (!dashboardVisible()) return;
  
      const active = document.activeElement;
  
      const typing =
        active &&
        (
          active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable
        );
  
      if (typing) return;
  
      if (e.key === 'Escape' && selectedKeys.size) {
        e.preventDefault();
        clearSelection();
        return;
      }
  
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
  
        selectedKeys.clear();
  
        const keys = visibleKeys();
  
        for (const key of keys) selectedKeys.add(key);
  
        anchorKey = keys[0] || '';
        focusKey = keys.at(-1) || anchorKey;
  
        scheduleSyncUi();
        return;
      }
  
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKeys.size > 1) {
        e.preventDefault();
        deleteItems(selectedItems());
      }
    }, true);
  
    window.addEventListener('blur', () => {
      cleanupPendingRect();
      cleanupActiveRect({ revert: false });
      removeStaleRectangles();
      clearTouchLongPress();
      cleanupCardPointer();
    });
  
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cleanupPendingRect();
        cleanupActiveRect({ revert: false });
        removeStaleRectangles();
        clearTouchLongPress();
        cleanupCardPointer();
      }
    });
  }
  
  function setupMutationObserver() {
    const r = root();
    if (!r) return;
  
    mutationObserver?.disconnect();
  
    mutationObserver = new MutationObserver(() => {
      scheduleSyncUi();
    });
  
    mutationObserver.observe(r, {
      childList: true,
      subtree: true,
    });
  }
  
  // ============================================================
// Public API for dashboard-context-menu.js
// ============================================================

export function getDashboardSelectedKeys() {
  pruneSelection();
  return [...selectedKeys];
}

export function isDashboardKeySelected(key) {
  pruneSelection();
  return selectedKeys.has(String(key || ''));
}

export function setDashboardSelectedKeys(keys = [], {
  sync = true,
} = {}) {
  selectedKeys.clear();

  for (const key of keys || []) {
    const clean = String(key || '');
    if (clean && keyExists(clean)) {
      selectedKeys.add(clean);
    }
  }

  anchorKey = selectedKeys.values().next().value || '';
  focusKey = anchorKey || '';

  if (sync) scheduleSyncUi();
}

export function clearDashboardSelection({
  sync = true,
} = {}) {
  clearSelection({ sync });
}

export function selectAllVisibleDashboardItems() {
  selectedKeys.clear();

  const keys = visibleKeys();

  for (const key of keys) {
    selectedKeys.add(key);
  }

  anchorKey = keys[0] || '';
  focusKey = keys.at(-1) || anchorKey;

  scheduleSyncUi();

  return keys;
}

  export function setupDashboardMultiSelect() {
    if (initialized) return;
    initialized = true;
  
    injectCss();
    removeStaleRectangles();
  
    bindSelectionEvents();
    bindActionDescriptionTooltip();
  
    setupMutationObserver();
  
    window.addEventListener('yanta-dashboard-refresh', () => {
      requestAnimationFrame(() => {
        setupMutationObserver();
        scheduleSyncUi();
      });
    });

    window.addEventListener('yanta-dashboard-clear-selection', () => {
      if (!dashboardVisible()) return;
    
      clearSelection();
    });
  
    window.addEventListener('resize', () => {
      removeStaleRectangles();
      scheduleSyncUi();
    });
  
    window.addEventListener('popstate', () => {
      removeStaleRectangles();
      requestAnimationFrame(scheduleSyncUi);
    });
  
    requestAnimationFrame(scheduleSyncUi);
  }
// ============================================================
// YANTA — Dashboard Trash drop target
//
// Fixed-positioned, but aligned to the visible app main/dashboard area,
// not to the viewport-left edge. This prevents overlap with the sidebar.
// ============================================================

import {
    lucide,
  } from './core.js';
  
  let root = null;
  let resizeBound = false;
  
  export function showTrashDropTarget() {
    ensureTrashDropTarget();
    updateTrashDropTargetPosition();
  
    root.hidden = false;
  
    requestAnimationFrame(() => {
      updateTrashDropTargetPosition();
      root.classList.add('visible');
    });
  }
  
  export function hideTrashDropTarget() {
    if (!root) return;
  
    root.classList.remove('visible', 'hot');
  
    window.setTimeout(() => {
      if (!root?.classList.contains('visible')) {
        root.hidden = true;
      }
    }, 180);
  }
  
  export function setTrashDropTargetHot(hot) {
    if (!root) return;
  
    root.classList.toggle('hot', !!hot);
  }
  
  export function isPointOverTrashDropTarget(x, y) {
    if (!root || root.hidden) return false;
  
    const r = root.getBoundingClientRect();
  
    return (
      x >= r.left &&
      x <= r.right &&
      y >= r.top &&
      y <= r.bottom
    );
  }
  
  function visibleRectForTrashTarget() {
    const dashboard = document.getElementById('dashboard');
    const main = document.querySelector('main.main');
  
    /*
      Wichtig:
      #dashboard kann ein scrollender Content-Container sein.
      Sein getBoundingClientRect().bottom kann dadurch am Content-Ende bzw.
      unter der letzten Card liegen. Für fixed positioning wollen wir aber
      den sichtbaren Viewport der App-Fläche.
  
      Priorität:
      1. Dashboard im Side Pane → Side-Pane-Body/Host-Viewport
      2. Normale App → main.main-Viewport
      3. Fallback → Browser viewport
    */
  
    const dashboardPane =
      dashboard?.closest?.('[data-side-pane-host="dashboard"], .yanta-dashboard-side-pane');
  
    if (dashboardPane) {
      const paneBody =
        dashboardPane.querySelector?.('[data-side-pane-body]') ||
        dashboardPane.querySelector?.('.yanta-side-pane-body') ||
        dashboardPane;
  
      const r = paneBody.getBoundingClientRect();
  
      if (r.width > 0 && r.height > 0) {
        return r;
      }
    }
  
    if (main) {
      const r = main.getBoundingClientRect();
  
      if (r.width > 0 && r.height > 0) {
        return r;
      }
    }
  
    return {
      left: 0,
      right: window.innerWidth,
      top: 0,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }
  
  function updateTrashDropTargetPosition() {
    if (!root) return;
  
    const r = visibleRectForTrashTarget();
  
    const safeLeft = Math.max(
      12,
      Math.min(
        window.innerWidth - 72,
        Math.round(r.left + 18)
      )
    );
  
    /*
      Für position: fixed ist bottom relativ zum Browser-Viewport.
      Deshalb:
        bottom = viewportBottom - visibleAreaBottom + margin
  
      Wenn main.main bis zum Viewport-Bottom geht, ist das einfach 18px.
      Wenn Dashboard in einem Side Pane endet, liegt das Target am Pane-Bottom.
    */
    const safeBottom = Math.max(
      12,
      Math.min(
        window.innerHeight - 72,
        Math.round(window.innerHeight - r.bottom + 18)
      )
    );
  
    root.style.setProperty('--trash-drop-left', `${safeLeft}px`);
    root.style.setProperty('--trash-drop-bottom', `${safeBottom}px`);
  }
  
  function ensureTrashDropTarget() {
    if (root) return root;
  
    injectCss();
  
    root = document.createElement('div');
    root.className = 'yanta-trash-drop-target';
    root.hidden = true;
  
    root.innerHTML = `
      <div class="yanta-trash-drop-icon">
        ${lucide('trash', 24)}
      </div>
      <div class="yanta-trash-drop-main">
        <strong>Trash</strong>
        <small>Drop to delete</small>
      </div>
    `;
  
    document.body.append(root);
  
    if (!resizeBound) {
      resizeBound = true;
  
      window.addEventListener('resize', () => {
        updateTrashDropTargetPosition();
      });
  
      window.addEventListener('yanta-sidebar-resized', () => {
        updateTrashDropTargetPosition();
      });
  
      window.addEventListener('yanta-dashboard-refresh', () => {
        requestAnimationFrame(updateTrashDropTargetPosition);
      });
  
      window.addEventListener('yanta-side-pane-opened', () => {
        requestAnimationFrame(updateTrashDropTargetPosition);
      });
  
      window.addEventListener('yanta-side-pane-closed', () => {
        requestAnimationFrame(updateTrashDropTargetPosition);
      });
    }
  
    return root;
  }
  
  function injectCss() {
    if (document.getElementById('yanta-trash-drop-target-css')) return;
  
    const style = document.createElement('style');
    style.id = 'yanta-trash-drop-target-css';
  
    style.textContent = `
  .yanta-trash-drop-target {
    position: fixed;
  
    left: var(--trash-drop-left, max(18px, env(safe-area-inset-left)));
    bottom: var(--trash-drop-bottom, max(18px, env(safe-area-inset-bottom)));
  
    z-index: 180;
  
    display: flex;
    align-items: center;
    gap: 10px;
  
    min-height: 58px;
    padding: 11px 14px;
  
    border: 1px solid color-mix(in srgb, var(--red) 42%, var(--border));
    border-radius: 999px;
  
    background: color-mix(in srgb, var(--red) 10%, var(--bg-elev));
    color: var(--red);
  
    box-shadow:
      0 18px 60px rgba(0,0,0,0.34),
      0 0 0 1px rgba(255,255,255,0.03) inset;
  
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  
    opacity: 0;
    transform: translateY(12px) scale(0.96);
  
    pointer-events: none;
  
    transition:
      opacity 150ms ease,
      transform 180ms cubic-bezier(.2,.8,.2,1),
      border-color 140ms ease,
      background-color 140ms ease,
      left 140ms ease,
      bottom 140ms ease;
  }
  
  .yanta-trash-drop-target[hidden] {
    display: none !important;
  }
  
  .yanta-trash-drop-target.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  
  .yanta-trash-drop-target.hot {
    border-color: var(--red);
    background: color-mix(in srgb, var(--red) 22%, var(--bg-elev));
    transform: translateY(0) scale(1.055);
  }
  
  .yanta-trash-drop-icon {
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
  
    display: inline-flex;
    align-items: center;
    justify-content: center;
  
    border-radius: 999px;
  
    background: color-mix(in srgb, var(--red) 15%, transparent);
  }
  
  .yanta-trash-drop-main {
    display: flex;
    flex-direction: column;
    gap: 1px;
  
    min-width: 0;
  }
  
  .yanta-trash-drop-main strong {
    color: var(--red);
    font-size: 13px;
    line-height: 1.15;
  }
  
  .yanta-trash-drop-main small {
    color: color-mix(in srgb, var(--red) 72%, var(--text-dim));
    font-size: 11px;
    line-height: 1.15;
    white-space: nowrap;
  }
  
  @media (max-width: 720px) {
    .yanta-trash-drop-target {
      padding: 12px;
    }
  
    .yanta-trash-drop-main {
      display: none;
    }
  }
  
  @media (prefers-reduced-motion: reduce) {
    .yanta-trash-drop-target {
      transition: none !important;
    }
  }
    `;
  
    document.head.append(style);
  }
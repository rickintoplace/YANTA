// ============================================================
// YANTA — Mobile bottom tab bar
//
// Why this exists:
// Testers found YANTA overwhelming on the phone. The cause was not the
// amount of features but that the map of them was hidden: every surface
// lived behind the sidebar drawer, so you had to already know what was
// there to get to it. A bottom tab bar is that map, permanently visible,
// and it is the native pattern on both platforms.
//
// Four destinations, deliberately. Three to five is where a tab bar still
// reads at a glance; past that it becomes the thing it was meant to fix.
// Everything else lives behind "More", which reuses the sidebar's own
// overflow menu so there is exactly one list to maintain.
//
// Visibility follows the platform convention rather than being always-on:
// a tab bar belongs to top-level destinations. In a detail view — an open
// note, an event being edited — it is dead weight that costs a thumb's
// worth of screen, so it goes away and comes back when you do.
// ============================================================

import { $, lucide } from './core.js';
import { t } from './i18n/index.js';

const MOBILE_MQ = window.matchMedia('(max-width: 880px)');

let bar = null;
let handlers = {};
let installed = false;

function tabs() {
  return [
    {
      id: 'notes',
      icon: 'library-big',
      label: t('tabbar.notes'),
      surfaces: ['dashboard'],
      onClick: () => handlers.openNotes?.(),
    },
    {
      id: 'calendar',
      icon: 'calendar-days',
      label: t('tabbar.calendar'),
      surfaces: ['calendar'],
      onClick: () => handlers.openCalendar?.(),
    },
    {
      id: 'ai',
      icon: 'bot',
      label: t('tabbar.ai'),
      surfaces: [],
      onClick: () => handlers.openAssistant?.(),
    },
    {
      id: 'more',
      icon: 'ellipsis',
      label: t('tabbar.more'),
      surfaces: [],
      onClick: (event) => handlers.openMore?.(event.currentTarget),
    },
  ];
}

/*
  The on-screen keyboard does not fire resize on every platform, but it
  does shrink visualViewport. A bar pinned to the layout viewport would
  otherwise sit behind the keyboard or push the field being typed into
  out of view.
*/
function keyboardLikelyOpen() {
  const vv = window.visualViewport;
  if (!vv) return false;

  return vv.height < window.innerHeight - 120;
}

function anyModalOpen() {
  /*
    Modals and fullscreen overlays own the screen while they are up. The
    event editor is the case the user named, but the rule is general so a
    new overlay does not have to remember to hide the bar.
  */
  /*
    Context menus are deliberately NOT in this list: they are small,
    transient popovers, and hiding the whole bar under one would just
    make the layout jump.
  */
  return !!document.querySelector(
    '.modal:not([hidden]), .yanta-share-overlay, [data-fullscreen-surface]:not([hidden])'
  );
}

function shouldShow() {
  if (!MOBILE_MQ.matches) return false;

  const app = $('app');
  if (!app) return false;

  // Detail view: an open note is a pushed screen, not a destination.
  if (app.dataset.surface === 'note') return false;

  if (app.classList.contains('sidebar-open')) return false;
  if (anyModalOpen()) return false;
  if (keyboardLikelyOpen()) return false;

  return true;
}

function activeTabId() {
  const surface = $('app')?.dataset?.surface || '';

  for (const tab of tabs()) {
    if (tab.surfaces.includes(surface)) return tab.id;
  }

  return '';
}

function render() {
  if (!bar) return;

  const active = activeTabId();

  bar.innerHTML = '';

  for (const tab of tabs()) {
    const btn = document.createElement('button');

    btn.type = 'button';
    btn.className = 'mobile-tab' + (tab.id === active ? ' active' : '');
    btn.dataset.tab = tab.id;
    btn.setAttribute('aria-label', tab.label);

    if (tab.id === active) btn.setAttribute('aria-current', 'page');

    btn.innerHTML =
      `<span class="mobile-tab-icon">${lucide(tab.icon, 22)}</span>` +
      `<span class="mobile-tab-label">${tab.label}</span>`;

    btn.addEventListener('click', (event) => {
      try {
        tab.onClick(event);
      } catch (err) {
        console.warn('[YANTA] tab bar action failed', tab.id, err);
      }
    });

    bar.append(btn);
  }
}

let refreshQueued = false;

/*
  Coalesce: the observers below can fire many times for one visual change
  (a modal opening toggles attributes and inserts nodes). One recompute
  per frame is both correct and cheap.
*/
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;

  requestAnimationFrame(() => {
    refreshQueued = false;
    refreshMobileTabBar();
  });
}

let lastShown = null;
let lastActive = null;

export function refreshMobileTabBar() {
  if (!bar) return;

  const show = shouldShow();

  /*
    Only touch the DOM when the answer actually changed.

    This is not just tidiness: the `hidden` observer below watches the
    whole body, and the bar is in the body — writing the attribute
    unconditionally would make every refresh trigger the next one.
  */
  if (show !== lastShown) {
    lastShown = show;
    bar.hidden = !show;

    /*
      The class lives on <html> so any surface can reserve space for the
      bar in CSS without knowing this module exists.
    */
    document.documentElement.classList.toggle('has-mobile-tabbar', show);
  }

  if (!show) return;

  const active = activeTabId();

  if (active !== lastActive) {
    lastActive = active;
    render();
  }
}

export function installMobileTabBar(actions = {}) {
  if (installed) return;
  installed = true;

  handlers = actions;

  bar = document.createElement('nav');
  bar.className = 'mobile-tabbar';
  bar.id = 'mobileTabBar';
  bar.hidden = true;
  bar.setAttribute('aria-label', t('tabbar.ariaLabel'));

  ($('app') || document.body).append(bar);

  /*
    One recompute for every way the answer can change. An attribute
    observer on #app covers surface switches and the sidebar drawer
    without those code paths having to call in here.
  */
  const app = $('app');

  if (app) {
    new MutationObserver(scheduleRefresh).observe(app, {
      attributes: true,
      attributeFilter: ['data-surface', 'class'],
    });
  }

  /*
    Overlays reach the screen two different ways: appended to <body>, or
    kept in the DOM and toggled with the `hidden` attribute (the calendar
    event editor does the latter). Watching only insertions would miss
    exactly the case the user asked about, so both are observed — the
    attribute filter keeps the subtree watch cheap.
  */
  new MutationObserver(scheduleRefresh).observe(document.body, {
    childList: true,
    subtree: false,
  });

  new MutationObserver(scheduleRefresh).observe(document.body, {
    attributes: true,
    attributeFilter: ['hidden'],
    subtree: true,
  });

  window.addEventListener('yanta-app-route-change', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('resize', scheduleRefresh);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleRefresh);
  }

  MOBILE_MQ.addEventListener?.('change', scheduleRefresh);

  refreshMobileTabBar();
}

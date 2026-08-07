import {
  lucide,
} from '../core.js';

import {
  LEGAL_LINKS,
  legalLinkLabel,
  legalLinkUrl,
} from './legal-links.js';

function ensureCss() {
  if (document.getElementById('yanta-sidebar-legal-links-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-sidebar-legal-links-css';
  style.textContent = `
.yanta-sidebar-legal {
  width: 100%;
  min-width: 0;
//   margin-block-start: 7px;
  padding-block-start: 7px;
  border-block-start: 1px solid color-mix(
    in srgb,
    var(--border, #d8c7a5) 55%,
    transparent
  );
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
}

.yanta-sidebar-legal__row {
  position: relative;
  min-width: 0;
  overflow: hidden;
  padding-inline-end: 24px;
  padding: 0px 2px 2px 6px;
}

.yanta-sidebar-legal__links {
  display: block;
  display: flex;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
}

.yanta-sidebar-legal__link {
  display: inline-block;
  margin-inline-end: 9px;
  color: var(--text-faint);
  text-decoration: none;
  text-underline-offset: 3px;
  vertical-align: middle;
}

.yanta-sidebar-legal__link:hover {
  color: var(--text-dim);
  text-decoration: underline;
}

.yanta-sidebar-legal__more {
  position: absolute;
  top: 50%;
  right: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  transform: translateY(-50%);
  color: var(--text-faint);
  background: transparent;
  cursor: pointer;
}

.yanta-sidebar-legal__more:hover {
  color: var(--text);
  background: var(--bg-elev-2);
}

.yanta-sidebar-legal__more svg {
  display: block;
  margin: auto;
}

.yanta-sidebar-legal__more[hidden] {
  display: none !important;
}

.yanta-sidebar-legal__link[hidden] {
  display: none !important;
}

/*
  Collapsed sidebar: keep the legal menu reachable without trying to show text links.
*/
.app.sidebar-collapsed .yanta-sidebar-legal {
//   padding-block-start: 6px;
  text-align: center;
}

.app.sidebar-collapsed .yanta-sidebar-legal__row {
  padding-inline-end: 0;
  overflow: visible;
}

.app.sidebar-collapsed .yanta-sidebar-legal__links {
  display: none;
}

.app.sidebar-collapsed .yanta-sidebar-legal__more {
  position: static;
  transform: none;
}
`;
  document.head.append(style);
}

function makeMenuItems(links) {
  return links.map((link) => ({
    label: legalLinkLabel(link),
    action: () => {
      location.href = legalLinkUrl(link.href);
    },
  }));
}

function isSidebarCollapsed() {
  return document.getElementById('app')?.classList.contains('sidebar-collapsed');
}

function schedule(fn) {
  requestAnimationFrame(() => {
    requestAnimationFrame(fn);
  });
}

export function mountSidebarLegalLinks({
  container,
  showMenu,
} = {}) {
  if (!container) return null;

  const existing = container.querySelector('[data-yanta-sidebar-legal]');
  if (existing) return existing;

  ensureCss();

  const root = document.createElement('div');
  root.className = 'yanta-sidebar-legal';
  root.dataset.yantaSidebarLegal = '1';

  const row = document.createElement('div');
  row.className = 'yanta-sidebar-legal__row';

  const linksWrap = document.createElement('nav');
  linksWrap.className = 'yanta-sidebar-legal__links';
  linksWrap.setAttribute('aria-label', 'Legal links');

  const linkNodes = LEGAL_LINKS.map((link, index) => {
    const a = document.createElement('a');

    a.className = 'yanta-sidebar-legal__link';
    a.href = legalLinkUrl(link.href);
    a.textContent = legalLinkLabel(link);
    a.dataset.index = String(index);

    linksWrap.append(a);

    return a;
  });

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'yanta-sidebar-legal__more';
  moreBtn.title = 'More legal links';
  moreBtn.setAttribute('aria-label', 'More legal links');
  moreBtn.hidden = true;
  moreBtn.innerHTML = lucide('section', 16);

  let overflowLinks = [];

  moreBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const links = overflowLinks.length
      ? overflowLinks
      : LEGAL_LINKS;

    const rect = moreBtn.getBoundingClientRect();

    if (typeof showMenu === 'function') {
      showMenu(
        rect.left,
        rect.bottom + 4,
        makeMenuItems(links),
        {
          align: 'end',
        }
      );

      return;
    }

    // Defensive fallback if no menu helper is available.
    if (links[0]) {
      location.href = legalLinkUrl(links[0].href);
    }
  });

  row.append(linksWrap, moreBtn);
  root.append(row);
  container.append(root);

  /* Outer width of a link including the gap the stylesheet puts after it. */
  function linkWidth(node) {
    const rect = node.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(node).marginInlineEnd) || 0;

    return Math.ceil(rect + gap);
  }

  const fit = () => {
    if (!root.isConnected) return;

    if (isSidebarCollapsed()) {
      overflowLinks = [...LEGAL_LINKS];
      moreBtn.hidden = false;
      return;
    }

    const available = Math.floor(row.clientWidth || 0);

    if (available <= 0) return;

    /*
      Measure at natural width, and by summing the links rather than reading
      linksWrap.scrollWidth: the wrap is a full-width flex container, so its
      scrollWidth has a floor of its own clientWidth and never reports that
      the content would fit.
    */
    for (const node of linkNodes) {
      node.hidden = false;
    }

    moreBtn.hidden = false;

    const widths = linkNodes.map(linkWidth);
    const total = widths.reduce((sum, width) => sum + width, 0);

    if (total <= available) {
      overflowLinks = [];
      moreBtn.hidden = true;
      return;
    }

    const budget = Math.max(
      0,
      available - (Math.ceil(moreBtn.getBoundingClientRect().width || 20) + 6)
    );

    /*
      Keep the highest-priority links that still fit — LEGAL_LINKS is ordered
      by priority, so Imprint and Privacy are the last to move into the menu.
      Everything that does not fit stays reachable through the overflow menu,
      including the case where nothing fits at all.
    */
    let used = 0;
    let visibleCount = 0;

    while (visibleCount < widths.length && used + widths[visibleCount] <= budget) {
      used += widths[visibleCount];
      visibleCount += 1;
    }

    linkNodes.forEach((node, index) => {
      node.hidden = index >= visibleCount;
    });

    overflowLinks = LEGAL_LINKS.slice(visibleCount);
  };

  schedule(fit);

  const resizeObserver = new ResizeObserver(() => {
    fit();
  });

  resizeObserver.observe(container);
  resizeObserver.observe(row);

  const mutationObserver = new MutationObserver(() => {
    fit();
  });

  const app = document.getElementById('app');

  if (app) {
    mutationObserver.observe(app, {
      attributes: true,
      attributeFilter: ['class', 'data-sidebar-collapsed'],
    });
  }

  root.__yantaDestroy = () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    root.remove();
  };

  return root;
}
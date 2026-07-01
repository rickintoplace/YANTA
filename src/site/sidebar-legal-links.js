import {
  lucide,
} from '../core.js';

const YANTA_APP_ORIGIN =
  (import.meta.env.VITE_APP_ORIGIN || 'https://yanta.page').replace(/\/+$/, '');

const BILLING_PUBLIC_ORIGIN =
  (import.meta.env.VITE_BILLING_PUBLIC_ORIGIN || YANTA_APP_ORIGIN).replace(/\/+$/, '');

const LEGAL_LINKS = [
  {
    label: 'Imprint',
    href: '/imprint',
  },
  {
    label: 'Privacy',
    href: '/privacy',
  },
  {
    label: 'Terms',
    href: '/terms',
  },
  {
    label: 'Refunds',
    href: '/refund',
  },
  {
    label: 'Pricing',
    href: '/pricing',
  },
];

function absoluteUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;

  const clean = String(path || '/').startsWith('/')
    ? String(path || '/')
    : `/${path}`;

  return `${BILLING_PUBLIC_ORIGIN}${clean}`;
}

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
    label: link.label,
    action: () => {
      location.href = absoluteUrl(link.href);
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
    a.href = absoluteUrl(link.href);
    a.textContent = link.label;
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
      location.href = absoluteUrl(links[0].href);
    }
  });

  row.append(linksWrap, moreBtn);
  root.append(row);
  container.append(root);

  const fit = () => {
    if (!root.isConnected) return;

    if (isSidebarCollapsed()) {
      overflowLinks = [...LEGAL_LINKS];
      moreBtn.hidden = false;
      return;
    }

    for (const node of linkNodes) {
      node.hidden = false;
    }

    overflowLinks = [];
    moreBtn.hidden = true;

    const available = Math.floor(row.clientWidth || 0);

    if (available <= 0) return;

    const fullWidth = Math.ceil(linksWrap.scrollWidth || 0);

    if (fullWidth <= available) {
      return;
    }

    moreBtn.hidden = false;

    const reservedForMore =
      Math.ceil(moreBtn.getBoundingClientRect().width || 22) + 6;

    const targetWidth = Math.max(0, available - reservedForMore);

    /*
      Hide from the end first, preserving:
      1. Imprint
      2. Privacy
      as the highest-priority visible links.
    */
    for (let i = linkNodes.length - 1; i >= 0; i--) {
      const currentWidth = Math.ceil(linksWrap.scrollWidth || 0);

      if (currentWidth <= targetWidth) {
        break;
      }

      linkNodes[i].hidden = true;
      overflowLinks.unshift(LEGAL_LINKS[i]);
    }

    /*
      If the sidebar is extremely narrow, make everything available via the menu.
    */
    if (targetWidth < 68) {
      for (const node of linkNodes) {
        node.hidden = true;
      }

      overflowLinks = [...LEGAL_LINKS];
      moreBtn.hidden = false;
    }

    if (!overflowLinks.length) {
      moreBtn.hidden = true;
    }
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
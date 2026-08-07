import {
  escapeHtml,
  LEGAL_LINKS,
  legalLinkUrl,
  YANTA_LEGAL,
} from './legal-links.js';

export function ensureLegalFooterCss() {
  if (document.getElementById('yanta-legal-footer-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-legal-footer-css';
  style.textContent = `
.yanta-legal-footer {
  width: 100%;
  margin-block-start: clamp(32px, 7vh, 84px);
  padding-block: 0 max(20px, env(safe-area-inset-bottom));
  color: var(--text-faint, #95886f);
  font-size: 12px;
  line-height: 1.65;
}

.yanta-legal-footer__inner {
  width: min(1040px, calc(100% - 32px));
  margin-inline: auto;
  padding-block-start: 18px;
  border-block-start: 1px solid color-mix(
    in srgb,
    var(--border, #d8c7a5) 72%,
    transparent
  );
}

.yanta-legal-footer__links {
  display: block;
  margin-block-end: 7px;
}

.yanta-legal-footer__links a {
  display: inline-block;
  margin-inline-end: 14px;
  margin-block: 2px;
  color: var(--text-dim, #625a49);
  text-decoration: none;
  text-underline-offset: 3px;
}

.yanta-legal-footer__links a:hover {
  color: var(--text, #29251d);
  text-decoration: underline;
}

.yanta-legal-footer__meta {
  margin: 0;
  color: var(--text-faint, #95886f);
}

.yanta-legal-footer__meta a {
  color: inherit;
  text-decoration: none;
  text-underline-offset: 3px;
}

.yanta-legal-footer__meta a:hover {
  color: var(--text-dim, #625a49);
  text-decoration: underline;
}

.yanta-legal-footer--dashboard {
  padding-block-end: 28px;
}

.yanta-legal-footer--app {
  padding-block-end: 14px;
}

/*
  The dashboard renders its own footer inside the scrollable dashboard page.
  This avoids duplicate legal links on the dashboard route.
*/
.app[data-surface="dashboard"] > .main > .yanta-legal-footer--app {
  display: none;
}

@media (max-width: 720px) {
  .yanta-legal-footer {
    margin-block-start: 36px;
    font-size: 11.5px;
  }

  .yanta-legal-footer__inner {
    width: min(100% - 24px, 1040px);
    padding-block-start: 14px;
  }

  .yanta-legal-footer__links a {
    margin-inline-end: 11px;
  }
}
`;
  document.head.append(style);
}

export function legalFooterHtml({
  id = '',
  variant = 'default',
} = {}) {
  const year = new Date().getFullYear();

  /*
    On a share page the reporter is already looking at the thing they want to
    report, so hand the address to the notice form instead of asking them to
    copy it. Art. 16 DSA calls for a mechanism that is easy to use, and the
    exact URL is the one field a reporter is most likely to get wrong.
  */
  const reportContext = variant === 'public'
    ? `?url=${encodeURIComponent(location.href)}`
    : '';

  const linksHtml = LEGAL_LINKS.map((link) => {
    const href = legalLinkUrl(link.href) +
      (link.href === '/report' ? reportContext : '');

    return `<a href="${escapeHtml(href)}">${escapeHtml(link.label)}</a>`;
  }).join('');

  return `
    <footer
      ${id ? `id="${escapeHtml(id)}"` : ''}
      class="yanta-legal-footer yanta-legal-footer--${escapeHtml(variant)}"
      data-yanta-legal-footer
      aria-label="Legal information"
    >
      <div class="yanta-legal-footer__inner">
        <nav class="yanta-legal-footer__links" aria-label="Legal links">
          ${linksHtml}
        </nav>

        <p class="yanta-legal-footer__meta">
          © ${year} ${escapeHtml(YANTA_LEGAL.productName)}
        </p>

      </div>
    </footer>
  `;
}

export function createLegalFooter({
  id = '',
  variant = 'default',
} = {}) {
  ensureLegalFooterCss();

  const template = document.createElement('template');
  template.innerHTML = legalFooterHtml({
    id,
    variant,
  }).trim();

  return template.content.firstElementChild;
}

export function ensureLegalFooter({
  parent = document.body,
  id = 'yanta-legal-footer',
  variant = 'default',
} = {}) {
  if (!parent) return null;

  ensureLegalFooterCss();

  const existing = id ? document.getElementById(id) : null;

  if (existing) {
    return existing;
  }

  const footer = createLegalFooter({
    id,
    variant,
  });

  parent.append(footer);

  return footer;
}
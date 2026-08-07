// ============================================================
// YANTA — shared legal surface plumbing
//
// One source of truth for the public page set and the provider identity.
// The site shell, the app footer and the sidebar link row all render
// LEGAL_LINKS, so adding or renaming a public page happens here only
// (plus the route table in site-pages.js and the host rewrite).
//
// The order is the *priority* order: surfaces that have to truncate drop
// from the end (see sidebar-legal-links.js), so the statutorily required
// pages come first.
// ============================================================

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

export const YANTA_APP_ORIGIN =
  trimTrailingSlashes(import.meta.env.VITE_APP_ORIGIN) || 'https://yanta.page';

export const BILLING_PUBLIC_ORIGIN =
  trimTrailingSlashes(import.meta.env.VITE_BILLING_PUBLIC_ORIGIN) ||
  YANTA_APP_ORIGIN;

/**
 * Provider identity as it has to appear in the imprint and legal pages.
 * `vatId` renders only when set — § 5 Abs. 1 Nr. 6 DDG requires the VAT ID
 * to be shown once one exists, and requires nothing while none does.
 */
export const YANTA_LEGAL = {
  productName: 'YANTA',
  providerName: 'Eirik Heilmann',
  street: 'Neustädter Ring 4',
  city: '37154 Northeim',
  country: 'Germany',
  contactEmail: 'rick@yanta.page',
  portfolioUrl: 'https://rickinto.place',
  sourceUrl: 'https://github.com/rickintoplace/yanta',
  vatId: '',
};

/** Where the AGPL § 13 source offer points. */
export const SOURCE_URL = YANTA_LEGAL.sourceUrl;

/*
  Priority order — surfaces that truncate drop from the end. Imprint and
  Privacy come first because they are the classic prominence duties, and
  "Cancel contract" is third because § 312k BGB wants it permanently
  available and easy to reach, not buried in an overflow menu.
*/
export const LEGAL_LINKS = [
  {
    label: 'Imprint',
    href: '/imprint',
  },
  {
    label: 'Privacy',
    href: '/privacy',
  },
  {
    label: 'Cancel contract',
    href: '/cancel',
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
    label: 'Accessibility',
    href: '/accessibility',
  },
  {
    label: 'Delete account',
    href: '/delete-account',
  },
  {
    label: 'Report content',
    href: '/report',
  },
  {
    label: 'Licences',
    href: '/licenses',
  },
  {
    label: 'Pricing',
    href: '/pricing',
  },
];

/*
  /withdrawal is served by the refunds document (the statutory withdrawal
  notice is its first section) and needs a route, but not a footer entry of
  its own next to "Refunds".
*/
export const EXTRA_SITE_PATHS = ['/withdrawal', '/get-app'];

/*
  Routes the SPA hands to the standalone site shell instead of booting the app.
  Kept here so main.js can decide before it lazily imports site-pages.js, and
  so a new legal page never has to be listed twice.
*/
export const SITE_PAGE_PATHS = new Set([
  ...LEGAL_LINKS.map((link) => link.href),
  ...EXTRA_SITE_PATHS,
]);

/*
  Legal pages are always absolute: the footer and the sidebar row also render
  inside share viewers and inside the app shell, where a relative href would
  resolve against the current route.
*/
export function legalLinkUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;

  const clean = String(path || '/');

  return `${BILLING_PUBLIC_ORIGIN}${clean.startsWith('/') ? clean : `/${clean}`}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

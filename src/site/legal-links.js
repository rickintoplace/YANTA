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

/** Provider identity as it has to appear in the imprint and legal pages. */
export const YANTA_LEGAL = {
  productName: 'YANTA',
  providerName: 'Eirik Heilmann',
  street: 'Neustädter Ring 4',
  city: '37154 Northeim',
  country: 'Germany',
  contactEmail: 'rick@yanta.page',
  portfolioUrl: 'https://rickinto.place',
};

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
    label: 'Pricing',
    href: '/pricing',
  },
];

/*
  Routes the SPA hands to the standalone site shell instead of booting the app.
  Kept here so main.js can decide before it lazily imports site-pages.js, and
  so a new legal page never has to be listed twice.
*/
export const SITE_PAGE_PATHS = new Set([
  ...LEGAL_LINKS.map((link) => link.href),
  '/get-app',
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

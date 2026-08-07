// ============================================================
// YANTA — /accessibility statement
//
// A voluntary accessibility statement in the structure the European
// Accessibility Act / BFSG prescribes (scope, conformance status, known
// barriers, feedback channel, enforcement body). YANTA is operated by a
// microenterprise and therefore outside the BFSG's service obligations —
// the statement is published anyway, and for that reason it must stay
// honest: every claim below is one we can defend, and everything we know
// to be broken is listed as a barrier rather than quietly omitted.
//
// Rendered inside the shared site shell (see site-pages.js).
// ============================================================

import { englishOnlyNotice } from './legal-documents.js';

import {
  escapeHtml,
  YANTA_APP_ORIGIN,
  YANTA_LEGAL,
} from './legal-links.js';

import { getLocale } from '../i18n/index.js';

const UPDATED = '2026-07-30';

/* "yanta.page" rather than the full origin — this reads as prose, not a link. */
const APP_HOST = YANTA_APP_ORIGIN.replace(/^https?:\/\//i, '');

const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

/*
  German market surveillance body for the accessibility of products and
  services (MLBF) and the BFSG conciliation body. Named without a street
  address on purpose — the authorities' own pages are the canonical source
  and outlive any address we would hardcode here.
*/
const ENFORCEMENT = {
  marketSurveillance: {
    name:
      'Marktüberwachungsstelle der Länder für die Barrierefreiheit von ' +
      'Produkten und Dienstleistungen (MLBF)',
    city: 'Magdeburg, Germany',
    url: 'https://www.marktueberwachung-barrierefreiheit.de',
  },
  conciliation: {
    name: 'Schlichtungsstelle nach dem Behindertengleichstellungsgesetz',
    url: 'https://www.schlichtungsstelle-bgg.de',
  },
};

const WORKING_TODAY = [
  `<strong>Keyboard operation.</strong> Notes, the dashboard, search, the
   command palette, dialogs and settings can be reached and operated with
   the keyboard. Focus is visible, and dialogs return focus to where you
   opened them.`,

  `<strong>Remappable shortcuts.</strong> Every editor command can be
   rebound under <em>Settings → Shortcuts</em>, so a chord that your
   assistive technology or keyboard layout intercepts can be moved.`,

  `<strong>Screen-reader labelling.</strong> Interactive controls, icon-only
   buttons, toolbars, dialogs and the navigation regions carry accessible
   names, roles and states.`,

  `<strong>Reduced motion.</strong> With <em>prefers-reduced-motion</em>
   enabled, view transitions, animated panels and decorative motion are
   suppressed.`,

  `<strong>Light, dark and system themes,</strong> plus adjustable editor
   typography and width, so text can be reflowed and re-contrasted to taste.`,

  `<strong>Resizable text.</strong> Layouts are built with relative units
   and reflow to a single column, so browser zoom up to 200% and larger
   default font sizes do not clip content.`,

  `<strong>Five interface languages</strong> (English, German, Spanish,
   French, Japanese) with the document language exposed to assistive
   technology, so screen readers pronounce the interface correctly.`,

  `<strong>Plain-text escape hatch.</strong> Every note is Markdown and can
   be exported as readable <code>.md</code> files, so you can always read
   and edit your content in a tool that suits you better than ours.`,
];

const KNOWN_BARRIERS = [
  `<strong>Drawings are visual.</strong> The drawing canvas (Excalidraw) is
   a third-party graphical editor with no meaningful screen-reader or
   keyboard equivalent. Drawings you receive can only be read visually
   unless the author added a description in the surrounding note.`,

  `<strong>Calendar grid views.</strong> The month, week and day grids
   expose incomplete semantics to screen readers. The <em>List</em> view is
   the accessible alternative and offers the same events.`,

  `<strong>Drag and drop without a keyboard path.</strong> Reordering
   dashboard cards and folders, moving calendar events by dragging, and
   rearranging slides currently require a pointer. Context menus cover
   most, but not all, of these actions.`,

  `<strong>No skip-to-content link</strong> in the application shell, so
   screen-reader and keyboard users pass the sidebar before reaching the
   main region.`,

  `<strong>Contrast.</strong> Some secondary and "faint" text, placeholder
   text and disabled controls have not been verified against the 4.5:1
   contrast requirement and may fall below it in individual themes.`,

  `<strong>No high-contrast or forced-colors tuning.</strong> Operating
   system high-contrast modes are not specifically supported; parts of the
   interface may lose contrast or icon detail.`,

  `<strong>Graph, slides and presentation modes</strong> convey their
   information spatially and have no non-visual equivalent.`,

  `<strong>Rich Markdown editing.</strong> The editor is a custom text
   surface (CodeMirror). Behaviour with screen readers varies by browser
   and assistive-technology combination and is not fully verified.`,

  `<strong>Video and audio</strong> embedded from third-party sources
   (YouTube, podcasts, RSS media) carry whatever captions and transcripts
   the original provider supplies — YANTA cannot add them.`,

  `<strong>The Android app</strong> is a wrapper around the same web
   interface and therefore shares all of the limitations above.`,
];

function listItems(entries) {
  return entries
    .map((entry) => `<li>${entry}</li>`)
    .join('\n');
}

function statusCard(term, value) {
  return `
    <div class="yanta-a11y-status__item">
      <dt>${escapeHtml(term)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function injectAccessibilityCss() {
  if (document.getElementById('yanta-a11y-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-a11y-css';
  style.textContent = `
.yanta-a11y__lead {
  font-size: 17px;
}

.yanta-a11y-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 22px 0 4px;
}

.yanta-a11y-status__item {
  padding: 13px 15px;
  border: 1px solid color-mix(in srgb, var(--border, #d8c7a5) 72%, transparent);
  border-radius: 13px;
  background: color-mix(in srgb, var(--bg, #fff8ef) 60%, transparent);
}

.yanta-a11y-status dt {
  color: var(--text-dim, #625a49);
  font-size: 11.5px;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.yanta-a11y-status dd {
  margin: 4px 0 0;
  color: var(--text, #29251d);
  font-weight: 650;
}

.yanta-a11y__list {
  display: grid;
  gap: 10px;
  padding-inline-start: 20px;
}

.yanta-a11y__list code {
  font-size: 0.92em;
}
`;
  document.head.append(style);
}

/** The /accessibility page body. Static — nothing to wire up. */
export function accessibilityContent() {
  injectAccessibilityCss();

  const { marketSurveillance, conciliation } = ENFORCEMENT;

  /*
    Not translated: a conformance statement is a claim about the product, and
    a shaky translation of "partially conformant" is worse than English.
  */
  return `
    <article class="yanta-legal-doc yanta-a11y">
      ${getLocale() === 'en' ? '' : englishOnlyNotice()}

      <h1>Accessibility</h1>
      <p><strong>Last updated:</strong> ${escapeHtml(UPDATED)}</p>

      <p class="yanta-a11y__lead">
        YANTA is built so that people can work the way that suits them:
        with a keyboard, with a screen reader, with large text, with reduced
        motion, or with none of that. We do not claim to be fully
        accessible yet. This page states plainly what works, what does not,
        and how to reach a human when YANTA gets in your way.
      </p>

      <dl class="yanta-a11y-status">
        ${statusCard('Standard', 'WCAG 2.2 level AA / EN 301 549')}
        ${statusCard('Status', 'Partially conformant')}
        ${statusCard('Assessed by', 'Self-evaluation')}
      </dl>

      <h2>1. Scope</h2>
      <p>
        This statement covers the YANTA web application and its public pages
        at <strong>${escapeHtml(APP_HOST)}</strong>,
        including pricing, legal and share pages, as well as the YANTA
        Android app, which renders the same interface. It does not cover
        content that other people create and share with you, nor
        third-party services YANTA links to or embeds (for example payment
        checkout, video players, or feeds you subscribe to).
      </p>

      <h2>2. Conformance status</h2>
      <p>
        YANTA is <strong>partially conformant</strong> with the Web Content
        Accessibility Guidelines (WCAG) 2.2 at level AA, the standard
        referenced by EN 301 549 and the European Accessibility Act.
        "Partially conformant" means most of the product meets the standard,
        but some parts do not — those are listed in section 4.
      </p>

      <h2>3. What is accessible today</h2>
      <ul class="yanta-a11y__list">
        ${listItems(WORKING_TODAY)}
      </ul>

      <h2>4. Known barriers</h2>
      <p>
        These are the parts we know fall short. They are on the roadmap;
        several depend on third-party components we do not control.
      </p>
      <ul class="yanta-a11y__list">
        ${listItems(KNOWN_BARRIERS)}
      </ul>

      <h2>5. Content you create</h2>
      <p>
        YANTA cannot make your own content accessible for you. Images
        without alternative text, drawings without a written description,
        and low-contrast colours you choose stay that way for the people you
        share them with. Markdown alt text
        (<code>![description](image.png)</code>) and a short caption under a
        drawing go a long way.
      </p>

      <h2>6. Feedback and contact</h2>
      <p>
        If something in YANTA is unusable for you, please tell us — barrier
        reports are treated as bugs, not as feature requests. Write to
        <a href="mailto:${escapeHtml(CONTACT_EMAIL)}">${escapeHtml(CONTACT_EMAIL)}</a>
        and, if you can, include the page or feature, what you were trying
        to do, and the browser, operating system and assistive technology
        you use.
      </p>
      <p>
        We aim to answer within five working days and at the latest within
        one month. If a barrier blocks something you need, ask: we will
        look for a workaround with you, and we can provide your own data in
        an accessible plain-text form.
      </p>

      <h2>7. How this was assessed</h2>
      <p>
        By <strong>self-evaluation</strong> by the provider: manual keyboard
        and screen-reader testing, inspection of the accessibility tree, and
        review of the interface code. There has been no third-party audit
        and no formal conformance certification. This statement was last
        reviewed on ${escapeHtml(UPDATED)} and is updated when we ship
        accessibility fixes or discover new barriers.
      </p>

      <h2>8. Legal status of this statement</h2>
      <p>
        YANTA is operated by ${escapeHtml(YANTA_LEGAL.providerName)}, a
        microenterprise as defined in section 3 of the German
        Barrierefreiheitsstärkungsgesetz (BFSG). Service providers of that
        size are exempt from the accessibility requirements of the BFSG and
        the European Accessibility Act. This statement is therefore
        published <strong>voluntarily</strong> and is not a declaration of
        conformity under the BFSG. We publish it because you should be able
        to find out before signing up whether YANTA will work for you.
      </p>

      <h2>9. Enforcement and complaints</h2>
      <p>
        If we do not respond to your report, or you are not satisfied with
        our answer, you can contact the German market surveillance body for
        the accessibility of products and services:
      </p>
      <p>
        <strong>${escapeHtml(marketSurveillance.name)}</strong><br>
        ${escapeHtml(marketSurveillance.city)}<br>
        <a href="${escapeHtml(marketSurveillance.url)}" target="_blank" rel="noopener">${escapeHtml(marketSurveillance.url)}</a>
      </p>
      <p>
        People with disabilities can also turn to the conciliation body,
        which mediates free of charge:
        <strong>${escapeHtml(conciliation.name)}</strong>,
        <a href="${escapeHtml(conciliation.url)}" target="_blank" rel="noopener">${escapeHtml(conciliation.url)}</a>.
      </p>
    </article>
  `;
}

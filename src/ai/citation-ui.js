// ============================================================
// @i18n-locked
// YANTA AI — how citation checks look (chat answers and Pulse cards)
//
// Shared by the chat (assistant-ui.js) and the Pulse Inbox: the coloured
// [n] markers inside the text and the "3/3 citations verified" pill
// with its fold-out of claims, quotes and sources. Styles are injected
// on first use, so a surface can show a check without the chat loaded.
// ============================================================

import { lucide, escapeHtml, toast } from '../core.js';
import { t } from '../i18n/index.js';
import { CITATION_PROBLEM_TYPES } from './citation-check.js';

/*
  Citation markers in the rendered answer. The model writes "[2]{c3}"
  (source 2 backs claim 3); VeriQuote's display stripping drops the
  claim part, so it is first rewritten to an invisible-to-markdown
  "[2]⟦c3⟧", rendered, and then turned into a coloured marker that
  carries the check's verdict for that claim.
*/
// Where the citation checker lives, linked quietly from the popover and the fold-out.
const VERIQUOTE_URL = 'https://github.com/rickintoplace/veriquote#readme';
// eslint-disable-next-line yanta/no-untranslated-literal -- rel attribute
const EXTERNAL_REL = 'noopener noreferrer';

export const CLAIM_MARK = /((?:\[\d+\])+)⟦c(\d+)⟧/g;

export function keepClaimMarkers(text, { sources = null } = {}) {
  let out = text.replace(/((?:\[\d+\])+)\{c(\d+)\}/g, '$1⟦c$2⟧');

  /*
    Models do not always follow the protocol and write a bare [2]. When 2
    is a source this answer read, it still becomes a citation mark (claim
    0: nothing was checked), so it links to its source like the others.
  */
  if (sources?.length) {
    const known = new Set(sources.map((s) => Number(s.n)));

    out = out.replace(/((?:\[\d{1,3}\])+)(?![[({⟦:])/g, (marker) => {
      const numbers = [...marker.matchAll(/\d+/g)].map(Number);
      return numbers.every((n) => known.has(n)) ? `${marker}⟦c0⟧` : marker;
    });
  }

  return out;
}

/**
 * A citation problem for display. Items store VeriQuote's problem type
 * (citation-check.js); messages saved before that stored English labels,
 * which are shown as they are.
 */
function citationProblemLabel(problem) {
  const code = String(problem || '');

  return CITATION_PROBLEM_TYPES.has(code)
    ? t(`ai.chat.cite.problem.${code}`)
    : code;
}

function citationProblemsText(item) {
  return (item.problems || []).map(citationProblemLabel).join(', ');
}

/*
  Display numbers. The registry numbers sources in the order the tools read
  them, so an answer may cite [4] and [9] and nothing else. On screen the
  cited sources are renumbered 1, 2, 3 … in the order the text first cites
  them, and the source list below follows the same order. Stored text and
  checks keep the registry numbers; only the display maps them.
*/
function displayOrder(nodes) {
  const order = new Map();

  for (const node of nodes) {
    for (const m of node.nodeValue.matchAll(CLAIM_MARK)) {
      for (const [, n] of m[1].matchAll(/\[(\d+)\]/g)) {
        if (!order.has(Number(n))) order.set(Number(n), order.size + 1);
      }
    }
  }

  return order;
}

/** Sources by registry number: the stored list, filled in from the check's items. */
function sourcesByNumber(check, sources) {
  const byN = new Map();

  for (const s of sources || []) {
    if (s && s.n != null) byN.set(Number(s.n), s);
  }

  for (const item of check?.items || []) {
    if (item.source && !byN.has(Number(item.n))) byN.set(Number(item.n), { n: Number(item.n), ...item.source });
  }

  return byN;
}

let groupSeq = 0;

/**
 * Turns the [n]⟦cX⟧ markers under `root` into coloured, clickable
 * citation marks and returns `{ group, order }` for the source list
 * (renderCitationCheckNode), so both use the same numbers and the
 * popover can jump from one to the other.
 */
export function markCitations(root, check, { sources = [] } = {}) {
  injectCitationStyles();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];

  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes('⟦c')) nodes.push(walker.currentNode);
  }

  const order = displayOrder(nodes);
  const group = `cite${++groupSeq}`;
  const byN = sourcesByNumber(check, sources);

  const byClaim = new Map();
  for (const item of check?.items || []) {
    const list = byClaim.get(item.claimId) || [];
    list.push(item);
    byClaim.set(item.claimId, list);
  }

  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    const text = node.nodeValue;
    let last = 0;

    for (const m of text.matchAll(CLAIM_MARK)) {
      frag.append(text.slice(last, m.index));
      last = m.index + m[0].length;

      const claimId = `c${m[2]}`;
      const items = byClaim.get(claimId) || [];
      const state = check?.pending
        ? 'pending'
        : !items.length
          ? 'plain'
          : items.every((i) => i.ok) ? 'ok' : items.some((i) => i.problems?.length || !i.matched) ? 'bad' : 'unknown';

      const numbers = [...m[1].matchAll(/\[(\d+)\]/g)]
        .map(([, n]) => Number(n))
        .sort((a, b) => (order.get(a) || a) - (order.get(b) || b));

      const sup = document.createElement('sup');
      sup.className = `yanta-ai-cite ${state}`;
      sup.textContent = numbers.map((n) => `[${order.get(n) || n}]`).join('');
      sup.tabIndex = 0;
      sup.setAttribute('role', 'button');
      sup.setAttribute('aria-haspopup', 'dialog');
      sup.dataset.citeNumbers = numbers.join(',');
      sup.dataset.citeClaim = claimId;

      const titles = numbers.map((n) => byN.get(n)?.title).filter(Boolean);
      sup.setAttribute('aria-label', titles.length ? titles.join(' · ') : sup.textContent);

      frag.append(sup);
    }

    frag.append(text.slice(last).replace(/⟦c\d+⟧/g, ''));
    node.replaceWith(frag);
  }

  root.dataset.citeGroup = group;

  // One listener per rendered body; the data travels with it.
  root.__yantaCite = { check, byN, byClaim, order, group };
  if (!root.__yantaCiteWired) {
    root.__yantaCiteWired = true;
    root.addEventListener('click', onCiteActivate);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onCiteActivate(e);
    });
  }

  return { group, order, byN };
}

function onCiteActivate(e) {
  const sup = e.target.closest?.('.yanta-ai-cite');
  if (!sup) return;

  const data = e.currentTarget.__yantaCite;
  if (!data) return;

  e.preventDefault();
  e.stopPropagation();
  openCitePopover(sup, data);
}

// ---- The popover behind a citation mark ----

let popover = null;
let popoverCleanup = null;

function closeCitePopover() {
  popoverCleanup?.();
  popoverCleanup = null;
  popover?.remove();
  popover = null;
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const KIND_ICON = { web: 'globe', note: 'file-text', rss: 'rss' };

function actionButton(icon, label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'yanta-cite-pop-action';
  btn.innerHTML = `${lucide(icon, 13)}<span>${escapeHtml(label)}</span>`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** Opens the source list that belongs to `group` and highlights entry `display`. */
function revealInSources(group, display) {
  const details = document.querySelector(`details[data-cite-group="${group}"]`);
  if (!details) return;

  details.open = true;
  const entry = details.querySelector(`[data-cite-n="${display}"]`) || details;
  entry.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  entry.classList.remove('is-flash');
  void entry.offsetWidth;
  entry.classList.add('is-flash');
}

function openCitePopover(sup, { byN, byClaim, order, group }) {
  const wasOpenFor = popover?.__for;
  closeCitePopover();
  if (wasOpenFor === sup) return;

  const numbers = String(sup.dataset.citeNumbers || '').split(',').filter(Boolean).map(Number);
  const items = byClaim.get(sup.dataset.citeClaim) || [];

  const pop = document.createElement('div');
  pop.className = 'yanta-cite-pop';
  pop.setAttribute('role', 'dialog');
  pop.__for = sup;

  for (const n of numbers) {
    const source = byN.get(n) || null;
    const display = order.get(n) || n;
    const item = items.find((i) => Number(i.n) === n) || null;

    const section = document.createElement('section');
    section.className = 'yanta-cite-pop-source';

    const kind = source?.kind || 'web';
    const host = source?.url ? hostLabel(source.url) : '';

    section.innerHTML = `
      <div class="yanta-cite-pop-head">
        <b class="yanta-cite-pop-num">[${display}]</b>
        ${lucide(KIND_ICON[kind] || 'globe', 13)}
        <div class="yanta-cite-pop-title">
          <span>${escapeHtml(source?.title || t('ai.chat.cite.unknownSource'))}</span>
          ${source ? `<small>${escapeHtml(host || t(`ai.chat.cite.kind.${KIND_ICON[kind] ? kind : 'web'}`))}</small>` : ''}
        </div>
      </div>
    `;

    if (item) {
      const verdict = document.createElement('div');
      verdict.className = `yanta-cite-pop-verdict ${item.ok ? 'ok' : 'bad'}`;
      verdict.innerHTML = `${lucide(item.ok ? 'shield-check' : 'shield-alert', 13)}<span>${escapeHtml(
        item.ok ? t('ai.chat.cite.backed') : citationProblemsText(item) || t('ai.chat.cite.notConfirmed')
      )}</span>`;
      section.append(verdict);

      if (item.quote) {
        const quote = document.createElement('blockquote');
        quote.textContent = item.quote;
        section.append(quote);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'yanta-cite-pop-actions';

    if (kind === 'note' && source?.id) {
      actions.append(actionButton('file-text', t('ai.chat.cite.openNote'), async () => {
        closeCitePopover();
        const { openNote } = await import('../notes.js');
        await openNote(source.id);
      }));
    } else if (source?.url) {
      actions.append(actionButton('external-link', t('ai.chat.cite.open'), () => {
        closeCitePopover();
        window.open(source.url, '_blank', 'noopener,noreferrer');
      }));
    }

    if (source?.url) {
      actions.append(actionButton('link', t('ai.chat.cite.copyLink'), async () => {
        try {
          await navigator.clipboard.writeText(source.url);
          toast(t('ai.chat.cite.linkCopied'), 'success');
        } catch {}
        closeCitePopover();
      }));

      actions.append(actionButton('quote', t('ai.chat.cite.addCitation'), async () => {
        closeCitePopover();
        const { openCitationManager } = await import('../citations.js');
        openCitationManager(source.url);
      }));
    }

    // Only when there is a list to show it in.
    if (source && document.querySelector(`details[data-cite-group="${group}"]`)) {
      actions.append(actionButton('list', t('ai.chat.cite.showInSources'), () => {
        closeCitePopover();
        revealInSources(group, display);
      }));
    }

    if (!source) {
      const missing = document.createElement('p');
      missing.className = 'yanta-cite-pop-missing';
      missing.textContent = t('ai.chat.cite.sourceMissing');
      section.append(missing);
    }

    if (actions.childElementCount) section.append(actions);
    pop.append(section);
  }

  const foot = document.createElement('a');
  foot.className = 'yanta-cite-pop-foot';
  foot.href = VERIQUOTE_URL;
  foot.target = '_blank';
  foot.rel = EXTERNAL_REL;
  foot.innerHTML = `${lucide('shield', 11)}<span>${escapeHtml(t('ai.chat.cite.checkedWith'))}</span>`;
  pop.append(foot);

  document.body.append(pop);
  popover = pop;
  placePopover(pop, sup);

  const onDown = (e) => {
    if (!pop.contains(e.target) && e.target !== sup) closeCitePopover();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    // Only the popover closes, not the chat panel behind it.
    e.stopPropagation();
    closeCitePopover();
    sup.focus?.();
  };
  const onMove = () => closeCitePopover();

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onMove);
  document.addEventListener('scroll', onMove, true);

  popoverCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onMove);
    document.removeEventListener('scroll', onMove, true);
  };

  pop.querySelector('button')?.focus({ preventScroll: true });
}

function placePopover(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(340, window.innerWidth - margin * 2);

  pop.style.width = `${width}px`;
  const height = pop.offsetHeight;

  const left = Math.max(margin, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - margin));
  const below = r.bottom + 6;
  const top = below + height > window.innerHeight - margin && r.top - height - 6 > margin
    ? r.top - height - 6
    : Math.min(below, window.innerHeight - height - margin);

  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(Math.max(margin, top))}px`;
}

/**
 * The fold-out under a cited answer: the check's verdict as its summary,
 * and the cited sources in display order, each with the claims it backs.
 * Pass the `{ group, order }` that markCitations returned. Without a check
 * (it failed, or is off) the sources are listed on their own.
 */
export function renderCitationCheckNode(check, { group = '', order = null, sources = [] } = {}) {
  injectCitationStyles();

  const details = document.createElement('details');
  if (group) details.dataset.citeGroup = group;

  if (check?.pending) {
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    details.className = 'yanta-ai-citecheck pending';
    details.innerHTML = `<summary>${lucide('shield', 13)}<span>${escapeHtml(
      check.total
        ? t('ai.chat.cite.checkingCount', { count: Number(check.total) })
        : t('ai.chat.cite.checking')
    )}</span></summary>`;
    return details;
  }

  const byN = sourcesByNumber(check, sources);
  const numbers = order?.size
    ? [...order.keys()]
    : [...new Set((check?.items || []).map((i) => Number(i.n)))];
  const displayOf = (n) => order?.get(n) || n;
  numbers.sort((a, b) => displayOf(a) - displayOf(b));

  const summary = document.createElement('summary');

  if (check) {
    const bad = check.total - check.passed;
    const tone = check.verdict === 'pass' ? 'ok' : bad ? 'bad' : 'unknown';

    details.className = `yanta-ai-citecheck ${tone}`;

    const headline = check.error
      ? t('ai.chat.cite.failed')
      : check.verdict === 'pass'
        ? t('ai.chat.cite.verified', { count: Number(check.total) })
        : bad
          ? t('ai.chat.cite.notBacked', { count: Number(check.total), bad })
          : t('ai.chat.cite.notJudged');

    summary.title = t('ai.chat.cite.explainer');
    summary.innerHTML = `${lucide(tone === 'ok' ? 'shield-check' : tone === 'bad' ? 'shield-alert' : 'shield-question', 13)}<span>${escapeHtml(headline)}${check.revised ? ` · ${escapeHtml(t('ai.chat.cite.fixedOnce'))}` : ''}</span><span class="yanta-ai-citecheck-count">${escapeHtml(t('ai.chat.cite.sourcesCount', { count: numbers.length }))}</span>${lucide('chevron-down', 12)}`;
  } else {
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    details.className = 'yanta-ai-citecheck unknown';
    summary.innerHTML = `${lucide('library', 13)}<span>${escapeHtml(t('ai.chat.cite.sourcesCount', { count: numbers.length }))}</span>${lucide('chevron-down', 12)}`;
  }

  details.append(summary);

  const list = document.createElement('ol');
  list.className = 'yanta-ai-sources';

  for (const n of numbers) {
    const source = byN.get(n) || null;
    const display = displayOf(n);
    const li = document.createElement('li');
    li.dataset.citeN = String(display);

    const kind = source?.kind || 'web';
    const host = source?.url ? hostLabel(source.url) : t(`ai.chat.cite.kind.${KIND_ICON[kind] ? kind : 'web'}`);
    const title = source?.url
      ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a>`
      : escapeHtml(source?.title || t('ai.chat.cite.unknownSource'));

    li.innerHTML = `
      <div class="yanta-ai-source-head">
        <b>[${display}]</b>
        <span class="yanta-ai-source-title">${title}</span>
        <small>${escapeHtml(host)}</small>
      </div>
    `;

    for (const item of (check?.items || []).filter((i) => Number(i.n) === n)) {
      const row = document.createElement('div');
      row.className = `yanta-ai-source-claim ${item.ok ? 'ok' : 'bad'}`;
      row.innerHTML = `
        <div class="yanta-ai-citecheck-claim">${lucide(item.ok ? 'check' : 'x', 12)} <span>${escapeHtml(item.claim)}</span></div>
        <blockquote>${escapeHtml(item.quote)}</blockquote>
        ${item.problems?.length ? `<small>${escapeHtml(citationProblemsText(item))}</small>` : ''}
      `;
      li.append(row);
    }

    list.append(li);
  }

  if (numbers.length) details.append(list);

  if (check) {
    const note = document.createElement('p');
    note.className = 'yanta-ai-citecheck-note';
    note.append(
      check.judged === false ? t('ai.chat.cite.noteUnjudged') : t('ai.chat.cite.noteJudged'),
      ' '
    );
    const link = document.createElement('a');
    link.href = VERIQUOTE_URL;
    link.target = '_blank';
    link.rel = EXTERNAL_REL;
    link.textContent = t('ai.chat.cite.aboutVeriquote');
    note.append(link);
    details.append(note);
  }

  return details;
}


let stylesInjected = false;

function injectCitationStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-citation-styles';
  style.textContent = `
.yanta-ai-citecheck {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-faint);
}

.yanta-ai-citecheck > summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, currentColor 8%, transparent);
  font-weight: 550;
}

.yanta-ai-citecheck[open] > summary > svg:last-child {
  transform: rotate(180deg);
}

.yanta-ai-citecheck.pending > summary {
  cursor: default;
  animation: yanta-cite-pulse 1.4s ease-in-out infinite;
}

@keyframes yanta-cite-pulse {
  50% { opacity: 0.45; }
}

.yanta-ai-cite {
  font-size: 0.72em;
  font-weight: 650;
  padding: 0 2px;
  border-radius: 4px;
  cursor: pointer;
}

.yanta-ai-cite:hover,
.yanta-ai-cite:focus-visible {
  outline: none;
  background: color-mix(in srgb, currentColor 14%, transparent);
}

.yanta-ai-cite.ok { color: var(--green, #3fb950); }
.yanta-ai-cite.bad {
  color: var(--yellow, #d29922);
  background: color-mix(in srgb, var(--yellow, #d29922) 14%, transparent);
}
.yanta-ai-cite.pending { color: var(--text-faint); animation: yanta-cite-pulse 1.4s ease-in-out infinite; }
.yanta-ai-cite.unknown, .yanta-ai-cite.plain { color: var(--text-faint); }

.yanta-ai-citecheck > summary::-webkit-details-marker {
  display: none;
}

.yanta-ai-citecheck.ok > summary { color: var(--green, #3fb950); }
.yanta-ai-citecheck.bad > summary { color: var(--yellow, #d29922); }
.yanta-ai-citecheck.pending > summary,
.yanta-ai-citecheck.unknown > summary { color: var(--text-dim); }

.yanta-ai-citecheck-claim {
  display: flex;
  gap: 6px;
  align-items: baseline;
  color: var(--text-dim);
}


.yanta-ai-citecheck blockquote {
  margin: 4px 0;
  padding-left: 8px;
  border-left: 2px solid var(--border);
  font-style: italic;
}

.yanta-ai-citecheck-note {
  margin: 8px 0 0;
  font-size: 11px;
}

.yanta-ai-citecheck-note a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
  text-underline-offset: 2px;
}

.yanta-ai-citecheck-count {
  color: var(--text-faint);
  font-weight: 450;
}

.yanta-ai-citecheck-count::before {
  content: '·';
  margin-right: 6px;
}

/* Sources, in the order the text cites them */
.yanta-ai-sources {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.yanta-ai-sources > li {
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: background-color 0.4s, border-color 0.4s;
}

.yanta-ai-sources > li.is-flash {
  animation: yanta-cite-flash 1.6s ease-out;
}

@keyframes yanta-cite-flash {
  0%, 30% {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
}

.yanta-ai-source-head {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.yanta-ai-source-head > b {
  flex: none;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.yanta-ai-source-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
}

.yanta-ai-source-title a {
  color: var(--text);
  text-decoration: none;
}

.yanta-ai-source-title a:hover {
  text-decoration: underline;
}

.yanta-ai-source-head > small {
  flex: none;
  margin-left: auto;
  color: var(--text-faint);
}

.yanta-ai-source-claim {
  margin: 5px 0 0 22px;
}

.yanta-ai-source-claim small {
  color: var(--yellow, #d29922);
}

.yanta-ai-source-claim.bad .yanta-ai-citecheck-claim svg { color: var(--yellow, #d29922); }
.yanta-ai-source-claim.ok .yanta-ai-citecheck-claim svg { color: var(--green, #3fb950); }

/* Popover behind a citation mark */
.yanta-cite-pop {
  position: fixed;
  z-index: 10050;
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-strong, var(--border));
  background: var(--bg-elev, var(--bg));
  color: var(--text);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  font-size: 13px;
  line-height: 1.45;
}

.yanta-cite-pop-source + .yanta-cite-pop-source {
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.yanta-cite-pop-head {
  display: flex;
  align-items: flex-start;
  gap: 7px;
}

.yanta-cite-pop-head > svg {
  flex: none;
  margin-top: 3px;
  color: var(--text-faint);
}

.yanta-cite-pop-num {
  flex: none;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.yanta-cite-pop-title {
  display: grid;
  min-width: 0;
}

.yanta-cite-pop-title > span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-weight: 600;
}

.yanta-cite-pop-title > small {
  color: var(--text-faint);
  font-size: 11.5px;
}

.yanta-cite-pop-verdict {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 550;
}

.yanta-cite-pop-verdict.ok { color: var(--green, #3fb950); }
.yanta-cite-pop-verdict.bad { color: var(--yellow, #d29922); }

.yanta-cite-pop blockquote {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  margin: 6px 0 0;
  padding-left: 9px;
  border-left: 2px solid var(--border);
  color: var(--text-dim);
  font-style: italic;
  font-size: 12.5px;
}

.yanta-cite-pop-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 10px;
}

.yanta-cite-pop-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-elev-2, transparent);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.yanta-cite-pop-action:hover,
.yanta-cite-pop-action:focus-visible {
  border-color: var(--border-strong, var(--border));
  background: var(--bg-elev-3, var(--bg-elev-2));
}

.yanta-cite-pop-action svg {
  color: var(--text-dim);
}

.yanta-cite-pop-missing {
  margin: 8px 0 0;
  color: var(--text-dim);
  font-size: 12px;
}

.yanta-cite-pop-foot {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  justify-self: end;
  color: var(--text-faint);
  font-size: 11px;
  text-decoration: none;
}

.yanta-cite-pop-foot:hover {
  color: var(--text-dim);
  text-decoration: underline;
}

`;
  document.head.append(style);
}

// ============================================================
// @i18n-locked
// YANTA AI — how citation checks look (chat answers and Pulse cards)
//
// Shared by the chat (assistant-ui.js) and the Pulse Inbox: the coloured
// [n] markers inside the text and the "3/3 citations verified" pill
// with its fold-out of claims, quotes and sources. Styles are injected
// on first use, so a surface can show a check without the chat loaded.
// ============================================================

import { lucide, escapeHtml } from '../core.js';
import { t } from '../i18n/index.js';
import { CITATION_PROBLEM_TYPES } from './citation-check.js';

/*
  Citation markers in the rendered answer. The model writes "[2]{c3}"
  (source 2 backs claim 3); VeriQuote's display stripping drops the
  claim part, so it is first rewritten to an invisible-to-markdown
  "[2]⟦c3⟧", rendered, and then turned into a coloured marker that
  carries the check's verdict for that claim.
*/
export const CLAIM_MARK = /((?:\[\d+\])+)⟦c(\d+)⟧/g;

export function keepClaimMarkers(text) {
  return text.replace(/((?:\[\d+\])+)\{c(\d+)\}/g, '$1⟦c$2⟧');
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

export function markCitations(root, check) {
  injectCitationStyles();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];

  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes('⟦c')) nodes.push(walker.currentNode);
  }

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

      const items = byClaim.get(`c${m[2]}`) || [];
      const state = check?.pending
        ? 'pending'
        : !items.length
          ? 'plain'
          : items.every((i) => i.ok) ? 'ok' : items.some((i) => i.problems?.length || !i.matched) ? 'bad' : 'unknown';

      const sup = document.createElement('sup');
      sup.className = `yanta-ai-cite ${state}`;
      sup.textContent = m[1];

      if (items.length) {
        sup.title = items.map((i) => [
          i.ok ? `✓ ${t('ai.chat.cite.backed')}` : `⚠ ${citationProblemsText(i) || t('ai.chat.cite.notConfirmed')}`,
          `“${i.quote}”`,
          i.source?.title ? `— ${i.source.title}` : '',
        ].filter(Boolean).join('\n')).join('\n\n');
      } else if (check?.pending) {
        sup.title = t('ai.chat.cite.checkingOne');
      }

      frag.append(sup);
    }

    frag.append(text.slice(last).replace(/⟦c\d+⟧/g, ''));
    node.replaceWith(frag);
  }
}


/** "3 of 4 citations checked out", with each claim, its quote and source. */
export function renderCitationCheckNode(check) {
  injectCitationStyles();

  const details = document.createElement('details');

  if (check.pending) {
    // eslint-disable-next-line yanta/no-untranslated-literal -- CSS class
    details.className = 'yanta-ai-citecheck pending';
    details.innerHTML = `<summary>${lucide('shield', 13)}<span>${escapeHtml(
      check.total
        ? t('ai.chat.cite.checkingCount', { count: Number(check.total) })
        : t('ai.chat.cite.checking')
    )}</span></summary>`;
    return details;
  }

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

  const summary = document.createElement('summary');
  summary.title = t('ai.chat.cite.explainer');
  summary.innerHTML = `${lucide(tone === 'ok' ? 'shield-check' : tone === 'bad' ? 'shield-alert' : 'shield-question', 13)}<span>${escapeHtml(headline)}${check.revised ? ` · ${escapeHtml(t('ai.chat.cite.fixedOnce'))}` : ''}</span>${lucide('chevron-down', 12)}`;
  details.append(summary);

  const list = document.createElement('ol');
  list.className = 'yanta-ai-citecheck-list';

  for (const item of check.items || []) {
    const li = document.createElement('li');
    li.className = item.ok ? 'ok' : 'bad';

    const source = item.source
      ? item.source.url
        ? `<a href="${escapeHtml(item.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.source.title)}</a>`
        : escapeHtml(item.source.title)
      : escapeHtml(t('ai.chat.cite.unknownSource'));

    li.innerHTML = `
      <div class="yanta-ai-citecheck-claim">${lucide(item.ok ? 'check' : 'x', 12)} <span>${escapeHtml(item.claim)}</span> <b>[${item.n}]</b></div>
      <blockquote>${escapeHtml(item.quote)}</blockquote>
      <small>${source}${item.problems?.length ? ` · ${escapeHtml(citationProblemsText(item))}` : ''}</small>
    `;

    list.append(li);
  }

  if (check.items?.length) details.append(list);

  const note = document.createElement('p');
  note.className = 'yanta-ai-citecheck-note';
  note.textContent = check.judged === false
    ? t('ai.chat.cite.noteUnjudged')
    : t('ai.chat.cite.noteJudged');
  details.append(note);

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
  cursor: help;
}

.yanta-ai-cite.ok { color: var(--success, #3fb950); }
.yanta-ai-cite.bad {
  color: var(--warning, #d29922);
  background: color-mix(in srgb, var(--warning, #d29922) 14%, transparent);
}
.yanta-ai-cite.pending { color: var(--text-faint); animation: yanta-cite-pulse 1.4s ease-in-out infinite; }
.yanta-ai-cite.unknown, .yanta-ai-cite.plain { color: var(--text-faint); }

.yanta-ai-citecheck > summary::-webkit-details-marker {
  display: none;
}

.yanta-ai-citecheck.ok > summary { color: var(--success, #3fb950); }
.yanta-ai-citecheck.bad > summary { color: var(--warning, #d29922); }
.yanta-ai-citecheck.pending > summary,
.yanta-ai-citecheck.unknown > summary { color: var(--text-dim); }

.yanta-ai-citecheck-list {
  margin: 8px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
}

.yanta-ai-citecheck-claim {
  display: flex;
  gap: 6px;
  align-items: baseline;
  color: var(--text-dim);
}

.yanta-ai-citecheck-list li.bad .yanta-ai-citecheck-claim svg { color: var(--warning, #d29922); }
.yanta-ai-citecheck-list li.ok .yanta-ai-citecheck-claim svg { color: var(--success, #3fb950); }

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

`;
  document.head.append(style);
}

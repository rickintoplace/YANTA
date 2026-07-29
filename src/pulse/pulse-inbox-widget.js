// ============================================================
// YANTA Pulse — the Inbox widget
//
// One dashboard surface for everything the routines produced, instead
// of a notification per result. Each card names the routine that wrote
// it and carries the controls to act on it, learn from it, or shut it
// up — so a card the user resents is one tap away from never happening
// again.
//
// Contract shared with dashboard-info-panel.js: the widget hides itself
// when there is nothing to say.
// ============================================================

import {
  el,
  lucide,
  escapeHtml,
  toast,
} from '../core.js';

import { registerDashboardWidget } from '../dashboard-widgets.js';
import { renderBlocksInline } from '../markdown.js';
import { t } from '../i18n/index.js';

import { executeToolCall } from '../ai/tool-registry.js';
import { writeBrainNote } from '../ai/brain.js';

import {
  listInboxItems,
  updateInboxItem,
  updateInboxProposal,
  dismissInboxItem,
  markInboxRead,
  INBOX_STATUS,
} from './pulse-store.js';

import { setRoutineEnabled } from './pulse-routines.js';
import { injectPulseCss } from './pulse-styles.js';
import { openPulseOverview } from './pulse-overview.js';

const CSS_ID = 'yanta-pulse-inbox-css';

function injectCss() {
  injectPulseCss();

  if (document.getElementById(CSS_ID)) return;

  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
.yanta-pulse-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-pulse-card {
  display: flex;
  flex-direction: column;
  gap: 8px;

  padding: 12px 14px;

  background: var(--bg-elev);
  border-left: 2px solid transparent;
}

.yanta-pulse-card.is-new {
  border-left-color: var(--accent);
}

.yanta-pulse-card-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.yanta-pulse-card-head strong {
  flex: 1;
  min-width: 0;

  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}

.yanta-pulse-source {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.4;
}

.yanta-pulse-source button {
  padding: 0;
  border: 0;
  background: transparent;

  color: var(--text-dim);
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}

.yanta-pulse-source button:hover {
  color: var(--text);
}

.yanta-pulse-body {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
}

.yanta-pulse-body > :first-child { margin-top: 0; }
.yanta-pulse-body > :last-child { margin-bottom: 0; }

.yanta-pulse-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.yanta-pulse-btn {
  padding: 5px 11px;

  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;

  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.yanta-pulse-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg);
}

.yanta-pulse-btn:disabled {
  opacity: .55;
  cursor: default;
}

.yanta-pulse-btn.primary {
  border-color: transparent;
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}

.yanta-pulse-btn.primary:hover:not(:disabled) {
  filter: brightness(1.05);
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}

.yanta-pulse-spacer { flex: 1; }


.yanta-pulse-proposal-error {
  color: var(--red, #ef4444);
  font-size: 11px;
}
`;

  document.head.append(style);
}

function relativeTime(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);

  if (minutes < 1) return t('pulse.time.justNow');
  if (minutes < 60) return t('pulse.time.minutesAgo', { count: minutes });

  const hours = Math.round(minutes / 60);

  if (hours < 24) return t('pulse.time.hoursAgo', { count: hours });

  return t('pulse.time.daysAgo', { count: Math.round(hours / 24) });
}

/**
 * Feedback becomes durable memory rather than a counter: the next run
 * of any routine sees it in the AI Brain and can act on it. This is the
 * loop that makes Pulse quieter over time instead of noisier.
 */
async function recordFeedback(item, verdict) {
  await updateInboxItem(item.id, { feedback: verdict });

  const line = verdict === 'useful'
    ? `- Pulse routine "${item.routineName}" produced a useful result: "${item.title}". Keep this kind of output.`
    : `- Pulse routine "${item.routineName}" produced an unwanted result: "${item.title}". Raise the bar for this routine or stay silent in this situation.`;

  await writeBrainNote({
    target: 'memory',
    mode: 'append',
    body: `## Pulse feedback\n${line}`,
  }).catch((err) => console.warn('[YANTA Pulse] feedback write failed', err));
}

function renderProposal(item, proposal, onChange) {
  const row = el('div', { class: 'yanta-pulse-actions' });

  const run = el('button', {
    type: 'button',
    class: 'yanta-pulse-btn primary',
  });

  run.textContent = proposal.status === 'done'
    ? t('pulse.proposal.done')
    : proposal.label;

  run.disabled = proposal.status === 'done';

  run.addEventListener('click', async () => {
    run.disabled = true;
    run.textContent = t('pulse.proposal.running');

    try {
      await executeToolCall({
        id: proposal.id,
        function: {
          name: proposal.tool,
          arguments: JSON.stringify(proposal.args || {}),
        },
      }, { source: `pulse-inbox:${item.routineName}` });

      await updateInboxProposal(item.id, proposal.id, { status: 'done', error: '' });
      toast(t('pulse.proposal.executed'), 'ok');
    } catch (err) {
      await updateInboxProposal(item.id, proposal.id, {
        status: 'failed',
        error: err?.message || String(err),
      });
    }

    onChange();
  });

  const skip = el('button', { type: 'button', class: 'yanta-pulse-btn' });
  skip.textContent = t('pulse.proposal.skip');
  skip.disabled = proposal.status !== 'pending';

  skip.addEventListener('click', async () => {
    await updateInboxProposal(item.id, proposal.id, { status: 'skipped' });
    onChange();
  });

  row.append(run, skip);

  if (proposal.error) {
    const error = el('div', { class: 'yanta-pulse-proposal-error' });
    error.textContent = proposal.error;
    row.append(error);
  }

  return row;
}

function renderCard(item, onChange) {
  const card = el('article', {
    class: `yanta-pulse-card${item.status === INBOX_STATUS.NEW ? ' is-new' : ''}`,
  });

  const head = el('div', { class: 'yanta-pulse-card-head' });
  head.innerHTML = `<strong>${escapeHtml(item.title || t('pulse.untitledResult'))}</strong>`;

  const dismiss = el('button', {
    type: 'button',
    class: 'yanta-pulse-icon-btn',
    title: t('pulse.dismiss'),
    'aria-label': t('pulse.dismiss'),
  });

  dismiss.innerHTML = lucide('x', 14);
  dismiss.addEventListener('click', async () => {
    await dismissInboxItem(item.id);
    onChange();
  });

  head.append(dismiss);
  card.append(head);

  if (item.body) {
    const body = el('div', { class: 'yanta-pulse-body' });
    body.innerHTML = renderBlocksInline(item.body);
    card.append(body);
  }

  for (const proposal of item.proposals || []) {
    card.append(renderProposal(item, proposal, onChange));
  }

  // Provenance + the off switch, on the card that caused the annoyance.
  const source = el('div', { class: 'yanta-pulse-source' });
  source.innerHTML = `
    ${lucide('activity', 11)}
    <span>${escapeHtml(item.routineName || t('pulse.unknownRoutine'))} · ${escapeHtml(relativeTime(item.createdAt))}</span>
  `;

  const spacer = el('span', { class: 'yanta-pulse-spacer' });

  const useful = el('button', { type: 'button' });
  useful.textContent = item.feedback === 'useful'
    ? t('pulse.feedback.markedUseful')
    : t('pulse.feedback.useful');
  useful.disabled = !!item.feedback;

  useful.addEventListener('click', async () => {
    await recordFeedback(item, 'useful');
    onChange();
  });

  const notUseful = el('button', { type: 'button' });
  notUseful.textContent = item.feedback === 'not-useful'
    ? t('pulse.feedback.markedNotUseful')
    : t('pulse.feedback.notUseful');
  notUseful.disabled = !!item.feedback;

  notUseful.addEventListener('click', async () => {
    await recordFeedback(item, 'not-useful');
    onChange();
  });

  const pause = el('button', { type: 'button' });
  pause.textContent = t('pulse.pauseRoutine');

  pause.addEventListener('click', async () => {
    try {
      await setRoutineEnabled(item.routineName, false);
      toast(t('pulse.routinePaused', { routine: item.routineName }), 'ok');
      onChange();
    } catch (err) {
      toast(err?.message || String(err), 'err');
    }
  });

  source.append(spacer, useful, notUseful, pause);
  card.append(source);

  return card;
}

async function renderPulseInbox() {
  injectCss();

  const section = el('section', {
    class: 'yanta-dash-widget yanta-dash-widget-pulse',
  });

  const head = el('div', { class: 'yanta-dash-widget-head' });
  head.innerHTML = `
    ${lucide('activity', 15)}
    <span class="yanta-dash-widget-title">${escapeHtml(t('pulse.inboxTitle'))}</span>
    <span class="yanta-pulse-spacer"></span>
  `;

  // The card answers "what happened"; the overview answers "what is
  // running and what did it do" — one tap from where the question forms.
  const overview = el('button', {
    type: 'button',
    class: 'yanta-pulse-mini',
    title: t('pulse.openOverview'),
  }, t('pulse.openOverview'));

  overview.addEventListener('click', () => openPulseOverview());
  head.append(overview);

  const host = el('div');
  section.append(head, host);

  // markInboxRead() emits the same event this widget listens to. The
  // guard keeps that from bouncing into a second render pass.
  let rendering = false;

  const refresh = async () => {
    if (rendering) return 0;

    rendering = true;

    try {
      return await renderPass();
    } finally {
      rendering = false;
    }
  };

  const renderPass = async () => {
    const items = await listInboxItems();

    // Same self-hide caveat as the info panel: [hidden] loses to the
    // explicit display rules on widget sections.
    section.style.display = items.length ? '' : 'none';

    if (!items.length) {
      host.replaceChildren();
      return 0;
    }

    const list = el('div', { class: 'yanta-pulse-list' });

    for (const item of items) {
      list.append(renderCard(item, () => { refresh().catch(() => {}); }));
    }

    host.replaceChildren(list);

    return items.length;
  };

  /*
    Read state follows the eye, not the render.

    The dashboard keeps its widgets mounted while other surfaces are
    open, so "we rendered" is not evidence anyone saw anything — marking
    read there would clear the AI-button badge for cards nobody looked
    at. An observer ties it to the cards actually being on screen, which
    also gets the below-the-fold case right.
  */
  const seen = new IntersectionObserver((entries) => {
    if (document.visibilityState !== 'visible') return;
    if (!entries.some((entry) => entry.isIntersecting)) return;

    markInboxRead().catch(() => {});
  }, { threshold: 0.35 });

  seen.observe(section);

  const onChanged = () => {
    if (!section.isConnected) {
      window.removeEventListener('yanta-pulse-inbox-changed', onChanged);
      seen.disconnect();
      return;
    }

    refresh().catch(() => {});
  };

  window.addEventListener('yanta-pulse-inbox-changed', onChanged);

  await refresh();

  return section;
}

registerDashboardWidget({
  id: 'pulse-inbox',
  titleKey: 'pulse.inboxTitle',
  icon: 'activity',
  order: 6,
  render: renderPulseInbox,
});

// ============================================================
// YANTA — what to do with text that names events
//
// One decision for the share sheet, drag and drop and paste:
//   - it moves or cancels an event already in the calendar → offer
//     exactly that change (old → new), not a second event;
//   - it lists several events (a school letter) → a checklist, all of
//     them added in one go;
//   - otherwise → the prefilled editor for the one event.
//
// Every change is confirmed first and can be undone from the toast.
// ============================================================

import { actionToast, escapeHtml, lucide, state } from '../core.js';
import { getLocale, t } from '../i18n/index.js';
import { draftEventFromText, draftEventsFromText, looksLikeSeveral } from '../calendar-text-event.js';
import { dateOrderForLocale } from '../calendar-text-parse.js';
import { findEventToChange, movedTimes, rescheduleTarget } from '../calendar-text-match.js';

function whenLabel(start, allDay) {
  const d = new Date(start);
  const day = { weekday: 'short', day: 'numeric', month: 'short' };
  return allDay
    ? d.toLocaleDateString(getLocale(), day)
    : d.toLocaleString(getLocale(), { ...day, hour: '2-digit', minute: '2-digit' });
}

function eventWhen(ev) {
  const raw = String(ev.start || '');
  const start = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  return whenLabel(start, !!ev.allDay);
}

/**
 * Decides what the text does. `draft` may be a refined one (the AI may
 * have said it is a move); without it the local parser drafts one.
 * Resolves null when the text names no moment.
 */
export async function planEventText(text, { draft = null } = {}) {
  const options = { dateOrder: dateOrderForLocale(getLocale()) };
  const base = draft || draftEventFromText(text, options);
  if (!base) return null;

  const calendar = await import('../calendar.js');
  calendar.hydrateCalendarStateFromVault?.({ silent: true });

  const match = findEventToChange(base, [...state.calendarEvents.values()]);

  if (match?.kind === 'reschedule') {
    return { mode: 'reschedule', draft: base, event: match.event, to: movedTimes(match.event, rescheduleTarget(base, match.event)) };
  }

  if (match?.kind === 'cancel') {
    return { mode: 'cancel', draft: base, event: match.event };
  }

  const drafts = draftEventsFromText(text, options);
  if (looksLikeSeveral(drafts, text)) return { mode: 'several', draft: base, drafts };

  return { mode: 'single', draft: base };
}

/** What the share sheet's chip promises for a plan, or '' for a single event. */
export function planLabel(plan) {
  if (!plan) return '';
  if (plan.mode === 'reschedule') {
    return t('eventText.moveLabel', { title: plan.event.title, from: eventWhen(plan.event), to: whenLabel(plan.to.start, plan.to.allDay) });
  }
  if (plan.mode === 'cancel') return t('eventText.cancelLabel', { title: plan.event.title, when: eventWhen(plan.event) });
  if (plan.mode === 'several') {
    return t('eventText.severalLabel', { count: plan.drafts.length, titles: plan.drafts.map((d) => d.title).join(', ') });
  }
  return '';
}

function undoToast(message, undo) {
  actionToast(message, {
    actionLabel: t('eventText.undo'),
    onAction: undo,
    type: 'success',
  });
}

async function runChange(plan, openSingle) {
  const { yantaChoice } = await import('../dialogs.js');
  const calendar = await import('../calendar.js');
  const { event } = plan;
  const original = { ...event };

  const moving = plan.mode === 'reschedule';
  const choice = await yantaChoice({
    title: moving ? t('eventText.moveTitle') : t('eventText.cancelTitle'),
    message: moving
      ? `${event.title}: ${eventWhen(event)} → ${whenLabel(plan.to.start, plan.to.allDay)}`
      : `${event.title} · ${eventWhen(event)}`,
    icon: moving ? 'calendar-clock' : 'calendar-x',
    choices: [
      moving
        ? { id: 'apply', icon: 'calendar-clock', primary: true, label: t('eventText.moveAction') }
        : { id: 'apply', icon: 'calendar-x', danger: true, label: t('eventText.cancelAction') },
      { id: 'new', icon: 'calendar-plus', label: t('eventText.asNew') },
    ],
    cancelLabel: t('common.cancel'),
  });

  if (choice === 'new') return openSingle(plan.draft);
  if (choice !== 'apply') return false;

  const restore = () => calendar.putCalendarEvent(original);

  if (moving) {
    calendar.putCalendarEvent({ id: event.id, start: plan.to.start, end: plan.to.end, allDay: plan.to.allDay });
    undoToast(t('eventText.moveDone', { title: event.title, when: whenLabel(plan.to.start, plan.to.allDay) }), restore);
  } else {
    // Cancelled, not deleted: a deletion is final across devices, and
    // the toast promises an undo.
    calendar.putCalendarEvent({ id: event.id, status: 'cancelled' });
    undoToast(t('eventText.cancelDone', { title: event.title }), restore);
  }

  return true;
}

async function runSeveral(plan) {
  const { yantaDialog } = await import('../dialogs.js');
  const calendar = await import('../calendar.js');

  const picked = await yantaDialog({
    title: t('eventText.severalTitle'),
    message: t('eventText.severalMessage'),
    icon: 'calendar-plus',
    build: ({ body, actions, done, button }) => {
      const list = document.createElement('div');
      list.className = 'yanta-event-pick-list';
      list.innerHTML = plan.drafts.map((d, i) => `
        <label class="yanta-event-pick-row">
          <input type="checkbox" data-pick="${i}" checked />
          <span class="yanta-event-pick-when">${lucide('calendar', 13)} ${escapeHtml(whenLabel(d.start, d.allDay))}</span>
          <input class="text-input" data-pick-title="${i}" value="${escapeHtml(d.title)}" aria-label="${escapeHtml(t('eventText.titleLabel'))}" />
        </label>`).join('');

      const style = document.createElement('style');
      style.textContent = `
        .yanta-event-pick-list { display: grid; gap: 8px; margin-top: 4px; }
        .yanta-event-pick-row {
          display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; align-items: center;
          padding: 8px 10px; border: 1px solid var(--border); border-radius: 11px;
        }
        .yanta-event-pick-row input[type="checkbox"] { grid-row: span 2; accent-color: var(--accent); width: 17px; height: 17px; }
        .yanta-event-pick-when { display: inline-flex; gap: 6px; align-items: center; color: var(--text-dim); font-size: 12px; }
        .yanta-event-pick-row .text-input { min-width: 0; }`;
      body.append(style, list);

      const add = button({ label: '', icon: 'check', kind: 'primary' });
      const cancel = button({ label: t('common.cancel'), kind: 'ghost' });
      const count = () => list.querySelectorAll('[data-pick]:checked').length;
      const refresh = () => {
        add.querySelector('span').textContent = t('eventText.severalAdd', { count: count() });
        add.disabled = !count();
      };
      list.addEventListener('change', refresh);
      refresh();

      cancel.addEventListener('click', () => done(null));
      add.addEventListener('click', () => done(
        [...list.querySelectorAll('[data-pick]:checked')].map((box) => {
          const i = Number(box.dataset.pick);
          const title = list.querySelector(`[data-pick-title="${i}"]`)?.value.trim();
          return { ...plan.drafts[i], title: title || plan.drafts[i].title };
        })
      ));
      actions.append(cancel, add);
    },
  });

  if (!picked?.length) return false;

  const saved = calendar.createCalendarEventsFromDrafts(picked);
  undoToast(t('eventText.severalAdded', { count: saved.length }), () => {
    for (const ev of saved) calendar.deleteCalendarEvent(ev.id);
  });
  return true;
}

/**
 * Carries a plan out. `openSingle(draft)` opens the editor for one event
 * (the share router's, which also takes the AI's second look).
 */
export async function runEventPlan(plan, { openSingle }) {
  if (!plan) return false;
  if (plan.mode === 'reschedule' || plan.mode === 'cancel') return runChange(plan, openSingle);
  if (plan.mode === 'several') return runSeveral(plan);
  return openSingle(plan.draft);
}

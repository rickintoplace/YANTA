// ============================================================
// YANTA — Web Share Target router
//
// Opened at boot when the OS share sheet posted content to YANTA (see the
// service-worker /share-target handler and the boot consumer in main.js).
//
// One overlay, two zones:
//   - Chats (top):   multi-select broadcast to chat partners (needs Matrix).
//   - Targets (bottom): one-tap smart destinations, context-ranked by payload.
//
// Open vs. background is a deliberate per-target property:
//   - background → routes silently, toasts "Saved", overlay closes.
//   - open       → routes, then navigates into that surface (note/event/AI).
//
// Everything reuses existing primitives — this file only orchestrates.
// ============================================================
import {
  escapeHtml,
  lucide,
  toast,
} from '../core.js';

import { getLocale, t } from '../i18n/index.js';
import { openSurface } from '../ui/surface.js';

import { isChatEnabled } from '../chat/chat-enabled.js';
import { draftEventFromText } from '../calendar-text-event.js';
import { dateOrderForLocale } from '../calendar-text-parse.js';
import { planEventText, planLabel, runEventPlan } from './event-text-actions.js';

// Chat modules load only when chat is on (see chat/chat-enabled.js); the
// chats zone renders once the client is there, by which time this is set.
let chatSend = null;

const raf = () => new Promise((r) => requestAnimationFrame(r));

// ---------------------------------------------------------------
// Payload shaping
// ---------------------------------------------------------------

function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/\S+/);
  return m ? m[0] : '';
}

function isFeedLike(url) {
  return /(youtube\.com|youtu\.be|\/feed\b|feeds?\.|\.rss\b|\.atom\b|\/rss\b)/i.test(url);
}

/*
  A clean text/markdown body from the shared fields.

  The title/subject is deliberately NOT merged into the body: Android share
  sources (e.g. Firefox sharing selected text) often put a source label or the
  chooser title into EXTRA_SUBJECT, which would otherwise be saved as a noisy
  prefix. The title survives separately (see shapePayload) for note/event use.
*/
function composeText(payload) {
  const text = String(payload?.text || '').trim();
  const url = String(payload?.url || '').trim();

  const parts = [];
  if (text) parts.push(text);
  if (url && !text.includes(url)) parts.push(url);

  return parts.join('\n').trim();
}

/*
  Calendar files arrive with an honest MIME type from most senders, but
  plenty of mail clients hand over application/octet-stream — so the file
  name decides too.
*/
function isCalendarFile(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();

  return type === 'text/calendar' ||
    type === 'application/ics' ||
    type === 'text/x-vcalendar' ||
    /\.(ics|ical|ifb|vcs)$/.test(name);
}

function shapePayload(payload) {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const imageFile =
    files.find((f) => String(f?.type || '').startsWith('image/')) || null;
  const calendarFile = files.find(isCalendarFile) || null;

  const title = String(payload?.title || '').trim();
  const text = composeText(payload);
  const linkUrl = String(payload?.url || '').trim() || firstUrl(payload?.text);
  const hasSnippet = Boolean(title || (payload?.text || '').trim());

  const kind = calendarFile
    ? 'calendar'
    : imageFile ? 'image' : (linkUrl ? 'link' : 'text');

  /*
    A message that names a moment ("3.12. Um 17:15 uhr, ok?") gets a
    ready event draft. Parsed here, on the device — the text goes nowhere
    to find its date.
  */
  const eventDraft = !calendarFile && !imageFile && text
    ? draftEventFromText(text, { dateOrder: dateOrderForLocale(getLocale()) })
    : null;

  return { title, text, linkUrl, imageFile, calendarFile, hasSnippet, kind, eventDraft };
}

/** "Thu 3 Dec, 17:15 · Zahnarzt" — what the event chip promises. */
function eventDraftLabel(draft) {
  const start = new Date(draft.start);
  const day = { weekday: 'short', day: 'numeric', month: 'short' };
  let when = start.toLocaleString(getLocale(), draft.allDay ? day : { ...day, hour: '2-digit', minute: '2-digit' });

  if (draft.allDay && draft.end) {
    when += ` – ${new Date(draft.end).toLocaleDateString(getLocale(), day)}`;
  } else if (!draft.allDay && draft.end) {
    const end = new Date(draft.end);
    // Only a range the text actually gave, not the default hour.
    if (draft.source.text.match(/[-–]|bis|und|to|until|zwischen|between/i)) {
      when += `–${end.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })}`;
    }
  }

  return draft.title ? `${when} · ${draft.title}` : when;
}

// The guesses worth a second look before saving, most important first.
const EVENT_HINT_FLAGS = [
  'weekday-mismatch',
  'meridiem-guessed',
  'next-weekday-ambiguous',
  'date-assumed',
  'month-assumed',
  'regional-time',
  'time-missing',
];

function eventDraftHint(draft) {
  const flag = EVENT_HINT_FLAGS.find((f) => draft.flags.includes(f));
  return flag ? t(`shareTarget.eventHint.${flag}`) : '';
}

/*
  The second look (calendar-text-ai.js): a decision model picks among
  the parser's own options — which date, which title, morning or
  afternoon — and only writes a title when none fits. Off when the user
  turned it off in the AI settings; any failure keeps the local draft.
*/
async function refineSharedEventDraft(text, draft) {
  const [{ getAiSettings }, { refineEventDraft, needsRefinement }, client] = await Promise.all([
    import('../ai/ai-settings.js'),
    import('../calendar-text-ai.js'),
    import('../ai/openrouter-client.js'),
  ]);

  if (getAiSettings().permissions?.allowRefineSharedEvents === false) return draft;
  if (!needsRefinement(draft) || !client.decisionsAvailable()) return draft;

  return refineEventDraft(text, draft, {
    decide: (request) => client.openRouterDecide({ ...request, fast: true }),
    complete: (messages) => client.openRouterChatCompletion({ messages, source: 'share-event' }),
    locale: getLocale(),
  });
}

// How long a tap on the chip waits for the second look before it goes
// ahead with the local draft.
const REFINE_WAIT_MS = 1500;

function within(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/**
 * Opens the event editor for text that names a moment, after a second
 * look by the AI (at most REFINE_WAIT_MS). Used by drag and drop too.
 * Resolves false when the text names no moment.
 */
export async function openEventFromText(text, { draft = null, refined = false } = {}) {
  const local = draft || draftEventFromText(text, { dateOrder: dateOrderForLocale(getLocale()) });
  if (!local) return false;

  let chosen = local;
  if (!refined) {
    await within(
      refineSharedEventDraft(text, local).then((next) => { chosen = next || local; }).catch(() => {}),
      REFINE_WAIT_MS
    );
  }

  await openEventDraft(chosen);
  return true;
}

/**
 * Text that names events, end to end: the AI's second look (at most
 * REFINE_WAIT_MS), then a move or cancellation of an existing event,
 * a checklist of several, or the editor for one (event-text-actions.js).
 * Used by the share sheet, drag and drop and paste.
 */
export async function handleEventText(text, { draft = null, plan = null, refined = false } = {}) {
  let chosen = draft || draftEventFromText(text, { dateOrder: dateOrderForLocale(getLocale()) });
  if (!chosen) return false;

  if (!refined && !plan) {
    await within(
      refineSharedEventDraft(text, chosen).then((next) => { chosen = next || chosen; }).catch(() => {}),
      REFINE_WAIT_MS
    );
  }

  const resolved = plan || await planEventText(text, { draft: chosen });

  return runEventPlan(resolved, {
    openSingle: (d) => openEventFromText(text, { draft: d, refined: true }),
  });
}

function openEventDraft(draft) {
  return import('../calendar.js').then(async ({ openCalendar, openNewCalendarEvent, cycleCalendarForQuickLog }) => {
    openCalendar?.({ push: true });
    await raf();
    await raf();

    // "Periode heute", "period started yesterday": an entry in the cycle
    // calendar, for those who keep one.
    const { looksLikePeriodText } = await import('../cycle/cycle-calendar.js');
    const cycleCat = draft.allDay && looksLikePeriodText(`${draft.title} ${draft.description || ''}`)
      ? cycleCalendarForQuickLog()
      : null;
    if (cycleCat) {
      const { t } = await import('../i18n/index.js');
      openNewCalendarEvent({
        title: t('cycle.entry.period'),
        start: draft.start,
        end: draft.end,
        allDay: true,
        categoryId: cycleCat.id,
        cycle: { kind: 'period' },
        reminders: [],
      });
      return;
    }

    openNewCalendarEvent({
      title: draft.title,
      start: draft.start,
      end: draft.end,
      allDay: draft.allDay,
      location: draft.location,
      description: draft.description,
      status: draft.status,
      recurrence: draft.recurrence || null,
    });
  });
}

/** Short label for the preview chip. */
function previewLabel(shaped) {
  if (shaped.kind === 'calendar') {
    return shaped.calendarSummary || shaped.calendarFile?.name || t('shareTarget.calendarFile');
  }
  if (shaped.kind === 'image') {
    return shaped.imageFile?.name || t('shareTarget.previewImage');
  }
  return shaped.linkUrl || shaped.text || '';
}

function previewIcon(shaped) {
  if (shaped.kind === 'calendar') return 'calendar-plus';
  if (shaped.kind === 'image') return 'image';
  if (shaped.kind === 'link') return 'link';
  return 'file-text';
}

// Context-ranked target list. Background targets carry mode:'background'.
function buildTargets(shaped) {
  const targets = [];

  /*
    A shared .ics has exactly one sensible destination, so it leads and
    the generic text targets stay out of the way.
  */
  if (shaped.kind === 'calendar') {
    targets.push({ id: 'ics', icon: 'calendar-plus', mode: 'open' });
    targets.push({ id: 'note', icon: 'file-text', mode: 'open' });

    return targets;
  }

  if (shaped.kind !== 'image' && shaped.text) {
    targets.push({ id: 'capture', icon: 'zap', mode: 'background' });
  }

  targets.push({ id: 'note', icon: 'file-text', mode: 'open' });

  if (shaped.text) {
    targets.push({ id: 'ai', icon: 'sparkles', mode: 'open' });
  }

  if (shaped.eventDraft) {
    // A recognised date is the most likely reason to share this text.
    targets.unshift({
      id: 'event',
      icon: 'calendar-check',
      mode: 'open',
      wide: true,
      label: planLabel(shaped.eventPlan) || eventDraftLabel(shaped.eventDraft),
      hint: shaped.eventPlan && shaped.eventPlan.mode !== 'single' ? '' : eventDraftHint(shaped.eventDraft),
    });
  } else if (shaped.hasSnippet) {
    targets.push({ id: 'event', icon: 'calendar', mode: 'open' });
  }

  if (shaped.linkUrl && isFeedLike(shaped.linkUrl)) {
    targets.push({ id: 'rss', icon: 'rss', mode: 'background' });
  }

  return targets;
}

// ---------------------------------------------------------------
// Target actions — each reuses an existing primitive.
// ---------------------------------------------------------------

async function runTarget(id, shaped) {
  if (id === 'ics') {
    const { importCalendarFile } = await import('../calendar.js');

    location.hash = '#calendar';
    await importCalendarFile(shaped.calendarFile);

    return;
  }

  if (id === 'capture') {
    const { captureToJournal } = await import('../journal.js');
    await captureToJournal(shaped.text, { source: 'share-target' });
    return;
  }

  if (id === 'note') {
    const { runCreateAction } = await import('../create-actions.js');
    await runCreateAction('note', { source: 'share-target' });
    await raf();

    if (shaped.imageFile) {
      const { insertImageAsRef } = await import('../image.js');
      await insertImageAsRef(shaped.imageFile);
    } else if (shaped.text) {
      const { insertAtCursor } = await import('../editor.js');
      insertAtCursor(shaped.text + '\n');
    }
    return;
  }

  if (id === 'event' && shaped.eventDraft) {
    await handleEventText(shaped.text, { draft: shaped.eventDraft, plan: shaped.eventPlan, refined: true });
    return;
  }

  if (id === 'event') {
    const { openCalendar, openNewCalendarEvent } = await import('../calendar.js');
    openCalendar?.({ push: true });
    await raf();
    await raf();
    openNewCalendarEvent({ title: (shaped.title || shaped.text || '').slice(0, 140) });
    return;
  }

  if (id === 'ai') {
    window.dispatchEvent(new CustomEvent('yanta-open-ai-assistant', {
      detail: { attachment: shaped.text },
    }));
    return;
  }

  if (id === 'rss') {
    const { addRssFeedFromUniversalInput } = await import('../rss/rss-actions.js');
    await addRssFeedFromUniversalInput(shaped.linkUrl);
    return;
  }

  throw new Error(`Unknown share target: ${id}`);
}

// ---------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------

/**
 * Open the share router for a shared payload. Resolves when it closes.
 * @param {{title?:string,text?:string,url?:string,files?:File[]}} payload
 */
export function openShareRouter(payload) {
  return new Promise((resolve) => {
    const shaped = shapePayload(payload);
    let dialog = null;

    /*
      A calendar file is named by what is in it ("Dentist, Tue 14 Oct"),
      not by whatever filename the sender gave it ("attachment").
    */
    if (shaped.calendarFile) {
      shaped.calendarFile.text()
        .then(async (text) => {
          const { parseIcsEvents } = await import('../calendar-ics.js');
          const events = parseIcsEvents(text);
          if (!events.length) return;

          const first = events[0];
          const when = new Date(first.allDay ? `${first.start}T12:00:00` : first.start).toLocaleString(getLocale(), first.allDay
            ? { weekday: 'short', day: 'numeric', month: 'short' }
            : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

          shaped.calendarSummary = `${first.title} · ${when}${events.length > 1 ? ` (+${events.length - 1})` : ''}`;
          const label = dialog?.body.querySelector('.ysr-preview span');
          if (label) label.textContent = shaped.calendarSummary;
        })
        .catch(() => {});
    }

    // Nothing usable was shared — do not open an empty router. (A lone
    // .ics carries no text, image or link: it used to end here unseen.)
    if (!shaped.text && !shaped.imageFile && !shaped.linkUrl && !shaped.calendarFile) {
      resolve(false);
      return;
    }

    /*
      "As event" from the text selection menu (Android PROCESS_TEXT): the
      user already said what they want — straight to the prefilled editor,
      which is the confirmation. Without a date the router opens as usual.
    */
    const refining = shaped.eventDraft
      ? refineSharedEventDraft(shaped.text, shaped.eventDraft)
        .then((next) => { shaped.eventDraft = next || shaped.eventDraft; })
        // What the text does with the calendar: one event, several, or a
        // change to one already there — the chip says which.
        .then(() => planEventText(shaped.text, { draft: shaped.eventDraft }))
        .then((plan) => { shaped.eventPlan = plan; })
        .catch((err) => console.warn('[YANTA Share] event refinement failed', err))
      : null;

    if (payload?.intent === 'event' && shaped.eventDraft) {
      within(refining, REFINE_WAIT_MS)
        .then(() => handleEventText(shaped.text, { draft: shaped.eventDraft, plan: shaped.eventPlan, refined: true }))
        .then(() => resolve(true))
        .catch((err) => {
          console.error('[YANTA Share] event draft failed', err);
          resolve(false);
        });
      return;
    }

    let client = null;
    let refiningBusy = !!refining;
    let query = '';
    let sending = false;
    let outcome = false;
    const selected = new Set();

    dialog = openSurface({
      kind: 'dialog',
      title: t('shareTarget.title'),
      width: 480,
      className: 'ysr',
      historyId: 'share-target-picker',
      onClose: () => resolve(outcome),
    });

    const { body } = dialog;

    const close = (result) => {
      outcome = result;
      dialog.close();
    };

    // A background target routes silently; an open target navigates away.
    const applyTarget = async (target) => {
      try {
        if (target.id === 'event' && refining) await within(refining, REFINE_WAIT_MS);
        await runTarget(target.id, shaped);
        if (target.mode === 'background') {
          toast(t(`shareTarget.saved.${target.id}`), 'success');
        }
        close(true);
      } catch (err) {
        console.error('[YANTA Share] target failed', target.id, err);
        toast(t('shareTarget.failed'), 'error');
      }
    };

    const sendToSelected = async () => {
      if (!client || sending || !selected.size) return;
      sending = true;
      renderSendBtn();
      try {
        for (const roomId of selected) {
          if (shaped.text) await chatSend.sendTextToRoom(client, roomId, shaped.text);
          if (shaped.imageFile) await chatSend.sendFileToRoom(client, roomId, shaped.imageFile);
        }
        toast(t('shareTarget.sentToChats', { count: selected.size }), 'success');
        close(true);
      } catch (err) {
        sending = false;
        renderSendBtn();
        console.warn('[YANTA Share] chat send failed', err);
        toast(t('shareTarget.failed'), 'error');
      }
    };

    const renderSendBtn = () => {
      const btn = body.querySelector('[data-send]');
      if (!btn) return;
      btn.disabled = sending || !selected.size;
      btn.textContent = selected.size
        ? t('shareTarget.sendToChats', { count: selected.size })
        : t('shareTarget.selectChats');
    };

    const renderRows = () => {
      const list = body.querySelector('[data-list]');
      if (!list) return;

      const rooms = chatSend.visibleRooms(client)
        .filter((room) =>
          !query || chatSend.roomDisplayName(client, room).toLowerCase().includes(query))
        .sort((a, b) =>
          Number(b.getLastActiveTimestamp?.() || 0) -
          Number(a.getLastActiveTimestamp?.() || 0))
        .slice(0, 60);

      list.innerHTML = rooms.length
        ? rooms.map((room) => {
            const name = chatSend.roomDisplayName(client, room);
            const on = selected.has(room.roomId);
            return `
              <button class="ysr-row${on ? ' is-selected' : ''}" type="button" data-room-id="${escapeHtml(room.roomId)}" aria-pressed="${on}">
                <span class="ysr-avatar">${escapeHtml(name.slice(0, 2).toUpperCase())}</span>
                <span class="ysr-name">${escapeHtml(name)}</span>
                <span class="ysr-check">${on ? lucide('check-circle-2', 18) : lucide('circle', 18)}</span>
              </button>`;
          }).join('')
        : `<p class="ys-dim">${escapeHtml(t('shareTarget.noChats'))}</p>`;

      list.querySelectorAll('[data-room-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.roomId;
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          renderRows();
          renderSendBtn();
        });
      });
    };

    const chatsMarkup = () => `
      <section class="ys-section">
        <h3 class="ys-section-title">${escapeHtml(t('shareTarget.sendToChatsLabel'))}</h3>
        <label class="ysr-search">
          ${lucide('search', 15)}
          <input data-search value="${escapeHtml(query)}" placeholder="${escapeHtml(t('shareTarget.searchChats'))}" aria-label="${escapeHtml(t('shareTarget.searchChats'))}" autocomplete="off" spellcheck="false">
        </label>
        <button class="btn primary ysr-send" data-send type="button"></button>
        <div class="ysr-list" data-list></div>
      </section>`;

    const render = () => {
      const targets = buildTargets(shaped);

      body.innerHTML = `
        <p class="ysr-preview">
          ${lucide(previewIcon(shaped), 16)}
          <span>${escapeHtml(previewLabel(shaped))}</span>
        </p>

        ${client ? chatsMarkup() : ''}

        <section class="ys-section ysr-targets">
          ${targets.map((target) => `
            <button class="ysr-target${target.wide ? ' is-wide' : ''}" type="button" data-target="${escapeHtml(target.id)}">
              ${lucide(target.icon, 18)}
              ${target.label
                ? `<span class="ysr-target-text">
                    <small>${escapeHtml(t('shareTarget.target.eventDetected'))}</small>
                    <b>${escapeHtml(target.label)}</b>
                    ${target.hint ? `<small>${escapeHtml(target.hint)}</small>` : ''}
                  </span>`
                : `<span class="ysr-target-text"><b>${escapeHtml(t(`shareTarget.target.${target.id}`))}</b></span>`}
            </button>`).join('')}
        </section>`;

      body.querySelector('[data-search]')?.addEventListener('input', (e) => {
        query = String(e.target.value || '').trim().toLowerCase();
        renderRows();
        requestAnimationFrame(() => {
          const input = body.querySelector('[data-search]');
          input?.focus();
          input?.setSelectionRange(input.value.length, input.value.length);
        });
      });

      body.querySelector('[data-send]')?.addEventListener('click', sendToSelected);

      body.querySelectorAll('[data-target]').forEach((btn) => {
        const target = targets.find((tg) => tg.id === btn.dataset.target);
        btn.addEventListener('click', () => applyTarget(target));
      });

      renderRows();
      renderSendBtn();
      if (refiningBusy) renderEventChip(true);
    };

    // The chip says the AI is still looking, then shows what it settled on.
    const renderEventChip = (busy) => {
      const host = body.querySelector('.ysr-target.is-wide .ysr-target-text');
      if (!host || !shaped.eventDraft) return;
      const changes = shaped.eventPlan && shaped.eventPlan.mode !== 'single';
      const hint = busy ? t('shareTarget.eventRefining') : changes ? '' : eventDraftHint(shaped.eventDraft);
      host.innerHTML = `
        <small>${escapeHtml(t('shareTarget.target.eventDetected'))}</small>
        <b>${escapeHtml(planLabel(shaped.eventPlan) || eventDraftLabel(shaped.eventDraft))}</b>
        ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}`;
    };

    render();

    refining?.finally(() => {
      refiningBusy = false;
      if (!dialog.closed) renderEventChip(false);
    });

    /*
      Resolve the Matrix client lazily; re-render to reveal the chats zone
      once it's ready (a share must not wait on chat to be usable).

      With chat off there is no homeserver to reach, so this is skipped
      entirely: no SDK load, no failing login, and the chats zone simply
      never appears. Every other share target is unaffected.
    */
    if (isChatEnabled()) Promise.all([
      import('../chat/chat-actions.js'),
      import('../chat/chat-send.js'),
    ])
      .then(([actions, send]) => {
        chatSend = send;
        return actions.resolveMatrixClient();
      })
      .then((c) => {
        if (!c || dialog.closed) return;
        client = c;
        render();
        requestAnimationFrame(() => body.querySelector('[data-search]')?.focus());
      })
      .catch(() => {});
  });
}

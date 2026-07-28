// ============================================================
// YANTA — Calendar editor date/time input
//
// Google-Calendar-style segmented entry: one masked date field plus
// separate hour/minute (and AM/PM) segments.
//
// Warum getrennte Segmente: mobile Nummern-Tastaturen haben weder
// ":" noch "/" — ein einzelnes Textfeld ist dort schlicht nicht
// tippbar. Die Segmente kommen mit reinen Ziffern aus und setzen
// Trenner selbst.
// ============================================================

import { el, lucide } from './core.js';
import { getCalendarPreferences } from './calendar-preferences.js';

import {
  calendarEditorDateFormat,
  calendarEditorDateGroups,
  maskCalendarEditorDatePart,
  joinCalendarEditorSegments,
  splitCalendarEditorSegments,
} from './calendar-datetime-format.js';

const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function wrap(n, min, max) {
  const span = max - min + 1;
  return min + ((((n - min) % span) + span) % span);
}

function normalizeHourText(raw, hour12) {
  const digits = onlyDigits(raw).slice(0, 2);
  if (!digits) return '';

  const n = clamp(Number(digits), hour12 ? 1 : 0, hour12 ? 12 : 23);

  return hour12 ? String(n) : String(n).padStart(2, '0');
}

function normalizeMinuteText(raw) {
  const digits = onlyDigits(raw).slice(0, 2);
  if (!digits) return '';

  return String(clamp(Number(digits), 0, 59)).padStart(2, '0');
}

function caretAtStart(input) {
  return input.selectionStart === 0 && input.selectionEnd === 0;
}

function caretAtEnd(input) {
  const end = input.value.length;
  return input.selectionStart === end && input.selectionEnd === end;
}

function focusSegment(input) {
  input.focus();
  // Tippen ersetzt den Inhalt — wie bei nativen Zeit-Segmenten.
  input.select();
}

/**
 * Hour/minute (+ AM/PM) segments.
 *
 * Reused by the inline editor field and by the keyboard mode of the
 * date/time picker, so both behave identically.
 */
export function createCalendarTimeSegments({
  hour12 = getCalendarPreferences().timeFormat === '12',
  value = null,
  labelPrefix = '',
  onInput = null,
  onChange = null,
} = {}) {
  const hourEl = el('input', {
    class: 'yanta-dtf-seg',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: '2',
    placeholder: hour12 ? 'hh' : 'HH',
    'aria-label': `${labelPrefix}Hours`.trim(),
  });

  const minuteEl = el('input', {
    class: 'yanta-dtf-seg',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: '2',
    placeholder: 'mm',
    'aria-label': `${labelPrefix}Minutes`.trim(),
  });

  const meridiemEl = hour12
    ? el('button', {
        type: 'button',
        class: 'yanta-dtf-meridiem',
        'aria-label': `${labelPrefix}AM or PM`.trim(),
      }, 'AM')
    : null;

  const root = el(
    'div',
    {
      class: 'yanta-dtf-time',
      role: 'group',
      'aria-label': `${labelPrefix}Time`.trim(),
    },
    hourEl,
    el('span', { class: 'yanta-dtf-colon', 'aria-hidden': 'true' }, ':'),
    minuteEl,
    meridiemEl
  );

  const readSegments = () => ({
    hour: hourEl.value,
    minute: minuteEl.value,
    meridiem: meridiemEl ? meridiemEl.textContent : '',
  });

  const serialize = ({ hour, minute, meridiem }) => `${hour}|${minute}|${meridiem}`;

  let committed = serialize(readSegments());

  const emitInput = () => onInput?.(readSegments());

  /*
    onChange nur bei echter Änderung — sonst würde blosses
    Durchtabben (focusout) als Bearbeitung gelten.
  */
  const emitChange = () => {
    const segments = readSegments();
    const next = serialize(segments);

    if (next === committed) return;

    committed = next;
    onChange?.(segments);
  };

  const setMeridiem = (next) => {
    if (!meridiemEl) return;

    meridiemEl.textContent = next;
    emitInput();
    emitChange();
  };

  /*
    Auto-advance sobald die Stunde nicht mehr wachsen kann:
    im 24h-Modus ab "3", im 12h-Modus ab "2" — genau wie im
    Material-Time-Picker.
  */
  const hourIsComplete = (digits) =>
    digits.length >= 2 ||
    (digits.length === 1 && Number(digits) >= (hour12 ? 2 : 3));

  hourEl.addEventListener('input', () => {
    const digits = onlyDigits(hourEl.value).slice(0, 2);
    const complete = hourIsComplete(digits);

    hourEl.value = complete ? normalizeHourText(digits, hour12) : digits;
    emitInput();

    if (complete) {
      emitChange();
      focusSegment(minuteEl);
    }
  });

  minuteEl.addEventListener('input', () => {
    const digits = onlyDigits(minuteEl.value).slice(0, 2);
    const complete = digits.length >= 2;

    minuteEl.value = complete ? normalizeMinuteText(digits) : digits;
    emitInput();

    if (complete) emitChange();
  });

  const step = (input, delta) => {
    const isHour = input === hourEl;
    const min = isHour ? (hour12 ? 1 : 0) : 0;
    const max = isHour ? (hour12 ? 12 : 23) : 59;

    const current = input.value === ''
      ? (isHour ? (hour12 ? 12 : 9) : 0)
      : Number(onlyDigits(input.value));

    const next = wrap(current + delta, min, max);

    input.value = isHour
      ? normalizeHourText(String(next), hour12)
      : normalizeMinuteText(String(next));

    input.select();
    emitInput();
    emitChange();
  };

  const onSegmentKeydown = (e) => {
    const input = e.currentTarget;
    const isHour = input === hourEl;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(input, e.key === 'ArrowUp' ? 1 : -1);
      return;
    }

    // Der Doppelpunkt (Desktop-Gewohnheit) springt einfach weiter.
    if (e.key === ':' || e.key === '.' || e.key === ',' || e.key === ' ') {
      e.preventDefault();

      if (isHour) {
        hourEl.value = normalizeHourText(hourEl.value, hour12);
        emitInput();
        focusSegment(minuteEl);
      }

      return;
    }

    if (meridiemEl && /^[ap]$/i.test(e.key)) {
      e.preventDefault();
      setMeridiem(e.key.toLowerCase() === 'a' ? 'AM' : 'PM');
      return;
    }

    if (e.key === 'ArrowRight' && isHour && caretAtEnd(input)) {
      e.preventDefault();
      focusSegment(minuteEl);
      return;
    }

    if (e.key === 'ArrowLeft' && !isHour && caretAtStart(input)) {
      e.preventDefault();
      focusSegment(hourEl);
      return;
    }

    if (e.key === 'Backspace' && !isHour && input.value === '') {
      e.preventDefault();
      hourEl.focus();
      hourEl.setSelectionRange(hourEl.value.length, hourEl.value.length);
    }
  };

  hourEl.addEventListener('keydown', onSegmentKeydown);
  minuteEl.addEventListener('keydown', onSegmentKeydown);

  hourEl.addEventListener('focus', () => hourEl.select());
  minuteEl.addEventListener('focus', () => minuteEl.select());

  meridiemEl?.addEventListener('click', () => {
    setMeridiem(meridiemEl.textContent === 'AM' ? 'PM' : 'AM');
  });

  meridiemEl?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

    e.preventDefault();
    setMeridiem(meridiemEl.textContent === 'AM' ? 'PM' : 'AM');
  });

  /*
    Beim Verlassen der Gruppe auffüllen: "9" -> "09:00".
    Ein komplett leeres Zeitfeld bleibt leer (End-Datum darf leer sein).
  */
  root.addEventListener('focusout', (e) => {
    if (root.contains(e.relatedTarget)) return;

    const hadValue = !!(hourEl.value || minuteEl.value);

    hourEl.value = normalizeHourText(hourEl.value, hour12);
    minuteEl.value = normalizeMinuteText(minuteEl.value);

    if (hadValue) {
      if (!hourEl.value) hourEl.value = hour12 ? '12' : '00';
      if (!minuteEl.value) minuteEl.value = '00';
    }

    emitInput();
    emitChange();
  });

  const setValue = (segments) => {
    hourEl.value = segments?.hour ?? '';
    minuteEl.value = segments?.minute ?? '';

    if (meridiemEl) {
      meridiemEl.textContent = segments?.meridiem === 'PM' ? 'PM' : 'AM';
    }

    committed = serialize(readSegments());
  };

  setValue(value);

  return {
    el: root,
    hour12,
    get value() {
      return readSegments();
    },
    setValue,
    focus: () => focusSegment(hourEl),
  };
}

/**
 * Digit-only date typing: inserts the format separators as the user
 * types, so a mobile number pad is enough to enter a full date.
 *
 * `onComplete` fires once all digits of the format are typed — handy to
 * jump to the next field.
 */
export function attachCalendarDateMask(input, {
  prefs = getCalendarPreferences(),
  onInput = null,
  onChange = null,
  onComplete = null,
} = {}) {
  const digitCount = calendarEditorDateGroups(prefs).reduce((a, b) => a + b, 0);

  input.addEventListener('input', (e) => {
    /*
      Nur beim Tippen maskieren. Einfügen (Paste) bleibt roh, damit
      Formate wie "2026-05-30" weiterhin geparst werden können.
    */
    const typed =
      e.inputType === 'insertText' ||
      e.inputType === 'deleteContentBackward';

    if (typed && caretAtEnd(input)) {
      const masked = maskCalendarEditorDatePart(input.value, prefs);

      if (masked !== input.value) {
        input.value = masked;
      }

      if (
        e.inputType === 'insertText' &&
        onlyDigits(masked).length >= digitCount
      ) {
        onInput?.();
        onComplete?.();
        return;
      }
    }

    onInput?.();
  });

  input.addEventListener('change', () => onChange?.());

  return input;
}

/**
 * Full "date + time" editor field.
 *
 * Renders into `host` (the `.yanta-calendar-date-input-row` element) and
 * keeps a hidden input carrying the canonical editor text, so everything
 * reading `[data-field="start"]` keeps working.
 */
export function attachCalendarDateTimeField(host, {
  name,
  label = '',
  value = '',
  allDay = false,
  pickerTitle = 'Pick date/time',
  onInput = null,
  onChange = null,
  onPicker = null,
} = {}) {
  const prefs = getCalendarPreferences();
  const hour12 = prefs.timeFormat === '12';
  let isAllDay = !!allDay;

  const hidden = el('input', {
    type: 'hidden',
    'data-field': name,
  });

  const dateEl = el('input', {
    class: 'text-input yanta-dtf-date',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: calendarEditorDateFormat(prefs),
    'aria-label': `${label} date`.trim(),
  });

  const time = createCalendarTimeSegments({
    hour12,
    labelPrefix: label ? `${label} ` : '',
    onInput: () => emitInput(),
    onChange: () => emitChange(),
  });

  const pickerBtn = el('button', {
    type: 'button',
    class: 'icon-btn yanta-dtf-picker',
    title: pickerTitle,
    'aria-label': pickerTitle,
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPicker?.();
    },
  });

  pickerBtn.innerHTML = lucide('calendar-clock', 16);

  host.classList.add('yanta-dtf');
  host.replaceChildren(
    hidden,
    el('div', { class: 'yanta-dtf-inputs' }, dateEl, time.el),
    pickerBtn
  );

  const syncHidden = () => {
    hidden.value = joinCalendarEditorSegments({
      datePart: dateEl.value,
      ...time.value,
      allDay: isAllDay,
    });

    return hidden.value;
  };

  let committedValue = null;

  const emitInput = () => onInput?.(syncHidden());

  /*
    Das versteckte Input ist das eigentliche Formularfeld: es feuert
    "change", damit bestehende Listener (z. B. die Wiederholungs-
    Zusammenfassung) unverändert daran hängen können.
  */
  const announceChange = () => {
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Auch hier: nur echte Wertänderungen melden.
  const emitChange = () => {
    const next = syncHidden();

    if (next === committedValue) return;

    committedValue = next;
    onChange?.(next);
    announceChange();
  };

  attachCalendarDateMask(dateEl, {
    prefs,
    onInput: () => emitInput(),
    onChange: () => emitChange(),
    onComplete: () => {
      if (isAllDay) return;

      emitChange();
      time.focus();
    },
  });

  dateEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || isAllDay) return;

    e.preventDefault();
    time.focus();
  });

  const applyAllDay = () => {
    time.el.hidden = isAllDay;
    host.classList.toggle('is-all-day', isAllDay);
  };

  const setValue = (next) => {
    /*
      Immer mit Zeit-Erkennung splitten: so landet nach einem
      All-Day-Wechsel nie eine Uhrzeit im Datumsfeld.
    */
    const segments = splitCalendarEditorSegments(next, {
      allDay: false,
      prefs,
    });

    dateEl.value = segments.datePart;

    time.setValue(
      isAllDay
        ? { hour: '', minute: '', meridiem: segments.meridiem }
        : segments
    );

    const canonical = syncHidden();

    if (canonical === committedValue) return;

    committedValue = canonical;
    announceChange();
  };

  applyAllDay();
  setValue(value);

  return {
    el: host,
    input: hidden,

    get value() {
      return hidden.value;
    },

    set value(next) {
      setValue(next);
    },

    get allDay() {
      return isAllDay;
    },

    set allDay(next) {
      if (isAllDay === !!next) return;

      isAllDay = !!next;
      applyAllDay();
      committedValue = syncHidden();
    },

    focus: () => dateEl.focus(),
    focusTime: () => time.focus(),
  };
}

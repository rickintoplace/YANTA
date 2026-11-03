// ============================================================
// YANTA — when does a piece of text say something happens?
//
// "Ich habe dir einen Termin beim Zahnarzt gemacht. Nur kontrolle.
// 3.12. Um 17:15 uhr, ok?" → Thu 3 Dec, 17:15.
//
// Deterministic and local on purpose: shared text (chat messages,
// mails) never leaves the device to find a date, it costs nothing, and
// the same text always gives the same answer. Every result carries the
// spans of text it came from, so the confirmation sheet can show them
// and a later model step can only pick among them, never invent one.
//
// German and English for now. chrono-node was measured first and
// missed the cases that matter most here — a date without a year
// ("3.12."), "halb 5", "viertel nach 3", "17.15 Uhr", "vom 24.–28.12."
// — and its German locale alone is larger than this file.
//
// Pure: no DOM, no app state. `now` and the date order come in as
// options, which is also what the tests pin.
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = {
  januar: 1, jan: 1, jänner: 1, january: 1,
  februar: 2, feb: 2, february: 2,
  märz: 3, maerz: 3, mär: 3, mrz: 3, march: 3, mar: 3,
  april: 4, apr: 4,
  mai: 5, may: 5,
  juni: 6, jun: 6, june: 6,
  juli: 7, jul: 7, july: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  oktober: 10, okt: 10, october: 10, oct: 10,
  november: 11, nov: 11,
  dezember: 12, dez: 12, december: 12, dec: 12,
};

// 0 = Sunday, like Date#getDay.
const WEEKDAYS = {
  sonntag: 0, sunday: 0,
  montag: 1, monday: 1,
  dienstag: 2, tuesday: 2,
  mittwoch: 3, wednesday: 3,
  donnerstag: 4, thursday: 4,
  freitag: 5, friday: 5,
  samstag: 6, sonnabend: 6, saturday: 6,
};

// Short forms collide with words ("so", "sat", "wed"), so they only
// count when a date or time follows (see WEEKDAY_SHORT_RX).
const WEEKDAYS_SHORT = {
  so: 0, sun: 0,
  mo: 1, mon: 1,
  di: 2, tue: 2, tues: 2,
  mi: 3, wed: 3,
  do: 4, thu: 4, thur: 4, thurs: 4,
  fr: 5, fri: 5,
  sa: 6, sat: 6,
};

const NUMBER_WORDS = {
  eins: 1, ein: 1, one: 1,
  zwei: 2, two: 2,
  drei: 3, three: 3,
  vier: 4, four: 4,
  fünf: 5, fuenf: 5, five: 5,
  sechs: 6, six: 6,
  sieben: 7, seven: 7,
  acht: 8, eight: 8,
  neun: 9, nine: 9,
  zehn: 10, ten: 10,
  elf: 11, eleven: 11,
  zwölf: 12, zwoelf: 12, twelve: 12,
  dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17,
  achtzehn: 18, neunzehn: 19, zwanzig: 20, einundzwanzig: 21,
  zweiundzwanzig: 22, dreiundzwanzig: 23,
};

// "am fünften März", "der einundzwanzigste": ordinal stems for 1–31.
const ORDINAL_STEMS = (() => {
  const units = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
  const stems = {
    erst: 1, zweit: 2, dritt: 3, viert: 4, fünft: 5, sechst: 6, siebt: 7, acht: 8, neunt: 9,
    zehnt: 10, elft: 11, zwölft: 12, dreizehnt: 13, vierzehnt: 14, fünfzehnt: 15, sechzehnt: 16,
    siebzehnt: 17, achtzehnt: 18, neunzehnt: 19, zwanzigst: 20, dreißigst: 30,
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  };
  for (let u = 1; u <= 9; u++) stems[`${units[u]}undzwanzigst`] = 20 + u;
  stems.einunddreißigst = 31;
  return stems;
})();
const ORDINAL_RX = `(?:${Object.keys(ORDINAL_STEMS).sort((a, b) => b.length - a.length).join('|')})(?:en|er|e|es|em)?`;

function ordinal(word) {
  const w = String(word || '').toLowerCase();
  const stem = Object.keys(ORDINAL_STEMS).sort((a, b) => b.length - a.length).find((k) => w.startsWith(k));
  return stem ? ORDINAL_STEMS[stem] : NaN;
}

const MINUTE_WORDS = { fünfzehn: 15, dreißig: 30, dreissig: 30, fünfundvierzig: 45, zehn: 10, zwanzig: 20, vierzig: 40, fünfzig: 50 };

const PARTS_OF_DAY = [
  [/^(?:morgens|früh|frueh|vormittags?|am vormittag|morning|in the morning)$/i, 'morning'],
  [/^(?:mittags?|noon|at noon)$/i, 'noon'],
  [/^(?:nachmittags?|am nachmittag|afternoon|in the afternoon)$/i, 'afternoon'],
  [/^(?:abends?|am abend|evening|in the evening|tonight)$/i, 'evening'],
  [/^(?:nachts|in der nacht|at night)$/i, 'night'],
];

const MONTH_RX = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const WEEKDAY_RX = Object.keys(WEEKDAYS).join('|');
const WEEKDAY_SHORT_RX = Object.keys(WEEKDAYS_SHORT).sort((a, b) => b.length - a.length).join('|');
const NUMWORD_RX = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|');
const HOUR_RX = `(?:\\d{1,2}|${NUMWORD_RX})`;

// Letters on both sides, so "Mai" in "Maier" is no month.
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';

function rx(source) {
  return new RegExp(source, 'giu');
}

function num(raw) {
  const s = String(raw || '').toLowerCase();
  return NUMBER_WORDS[s] ?? Number(s);
}

function validDayMonth(d, m) {
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

function fullYear(raw) {
  if (raw == null || raw === '') return null;
  const y = Number(raw);
  return raw.length === 2 ? 2000 + y : y;
}

// ---------------------------------------------------------------
// Mentions: everything that names a day, a time, or a part of a day.
// ---------------------------------------------------------------

function scan(text, { dateOrder }) {
  const out = [];
  const add = (kind, match, data, { from = match.index, to = match.index + match[0].length } = {}) => {
    out.push({ kind, from, to, ...data });
  };
  const each = (source, fn) => {
    for (const m of text.matchAll(rx(source))) fn(m);
  };

  // --- day ranges -------------------------------------------------
  // "24.-28.12.", "24.–28.12.2026", "vom 24. bis 28.12."
  each(`${B}(?:vom\\s+)?(\\d{1,2})\\.?\\s*(?:-|–|bis(?:\\s+zum)?)\\s*(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?(?!\\d)`, (m) => {
    const [, d1, d2, mo, y] = m;
    if (!validDayMonth(+d1, +mo) || !validDayMonth(+d2, +mo) || +d1 > +d2) return;
    add('range', m, { from1: { d: +d1, m: +mo }, to1: { d: +d2, m: +mo }, y: fullYear(y) });
  });
  // "24. bis 28. Dezember", "24.-28. Dez"
  each(`${B}(?:vom\\s+)?(\\d{1,2})\\.?\\s*(?:-|–|bis(?:\\s+zum)?|to|until)\\s*(\\d{1,2})\\.?\\s*(${MONTH_RX})\\.?(?:\\s+(\\d{4}))?${E}`, (m) => {
    const [, d1, d2, name, y] = m;
    const mo = MONTHS[name.toLowerCase()];
    if (!validDayMonth(+d1, mo) || +d1 > +d2) return;
    add('range', m, { from1: { d: +d1, m: mo }, to1: { d: +d2, m: mo }, y: fullYear(y) });
  });
  // "Dec 24-28"
  each(`${B}(${MONTH_RX})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${E}`, (m) => {
    const [, name, d1, d2, y] = m;
    const mo = MONTHS[name.toLowerCase()];
    if (!validDayMonth(+d1, mo) || +d1 > +d2) return;
    add('range', m, { from1: { d: +d1, m: mo }, to1: { d: +d2, m: mo }, y: fullYear(y) });
  });

  // --- dates ------------------------------------------------------
  // ISO 2026-12-03
  each(`${B}(\\d{4})-(\\d{2})-(\\d{2})(?![\\d])`, (m) => {
    const [, y, mo, d] = m;
    if (validDayMonth(+d, +mo)) add('date', m, { d: +d, m: +mo, y: +y });
  });
  // 3.12. / 03.12.2026 / 3.12.26 — never "1.2.3" (a version number),
  // and "7.11. 20 Uhr" is no year 2020: a short year sits right at the dot.
  each(`(?<![\\d.])(\\d{1,2})\\.\\s?(\\d{1,2})\\.(?:\\s?(\\d{4})(?![\\d.:])|(\\d{2})(?![\\d.:]))?(?!\\d)`, (m) => {
    const [, d, mo, y4, y2] = m;
    if (validDayMonth(+d, +mo)) add('date', m, { d: +d, m: +mo, y: fullYear(y4 || y2) });
  });
  // 3.12 without the closing dot: a date unless it is a clock time
  // ("um 17.15", "17.15 Uhr") — those are found below and win on overlap.
  each(`(?<![\\d.])(\\d{1,2})\\.(\\d{1,2})(?![\\d.:])(?!\\s*(?:uhr|h${E}))`, (m) => {
    const [, d, mo] = m;
    const before = text.slice(Math.max(0, m.index - 6), m.index).toLowerCase();
    if (/(?:um|ab|gegen|bis)\s+$/.test(before)) return;
    if (validDayMonth(+d, +mo)) add('date', m, { d: +d, m: +mo, y: null, weak: true });
  });
  // 12/3, 12/3/2026 — order from the locale
  each(`(?<![\\d/])(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\d/])`, (m) => {
    const [, a, b, y] = m;
    const [d, mo] = dateOrder === 'mdy' ? [+b, +a] : [+a, +b];
    if (validDayMonth(d, mo)) add('date', m, { d, m: mo, y: fullYear(y) });
  });
  // 3. Dezember 2026 / 3 Dec / 3rd of December
  each(`${B}(\\d{1,2})(?:\\.|st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_RX})\\.?(?:,?\\s+(\\d{4}))?${E}`, (m) => {
    const [, d, name, y] = m;
    const mo = MONTHS[name.toLowerCase()];
    if (validDayMonth(+d, mo)) add('date', m, { d: +d, m: mo, y: fullYear(y) });
  });
  // am fünften März / the third of December
  each(`${B}(?:(?:am|den|der|vom|on the|the)\\s+)?(${ORDINAL_RX})\\s+(?:of\\s+)?(${MONTH_RX})\\.?(?:\\s+(\\d{4}))?${E}`, (m) => {
    const d = ordinal(m[1]);
    const mo = MONTHS[m[2].toLowerCase()];
    if (validDayMonth(d, mo)) add('date', m, { d, m: mo, y: fullYear(m[3]) });
  });
  // December 3rd, 2026 / Dec 3
  each(`${B}(${MONTH_RX})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${E}(?!\\s*(?::|uhr))`, (m) => {
    const [, name, d, y] = m;
    const mo = MONTHS[name.toLowerCase()];
    if (validDayMonth(+d, mo)) add('date', m, { d: +d, m: mo, y: fullYear(y) });
  });

  // "am 21." / "on the 21st": a day of this month, or the next one.
  each(`${B}(?:am|den|on the|the)\\s+(\\d{1,2})(?:\\.|st|nd|rd|th)(?![\\d.])(?!\\s*(?:${MONTH_RX})${E})`, (m) => {
    const d = +m[1];
    if (d >= 1 && d <= 31) add('date', m, { d, m: null, y: null });
  });

  // --- relative days ---------------------------------------------
  each(`${B}(heute|today|tonight|übermorgen|uebermorgen|morgen|morgigen|morgige|morgiges|morgigem|tomorrow|the day after tomorrow|day after tomorrow)${E}`, (m) => {
    const word = m[1].toLowerCase().replace(/^morgig\w*$/, 'tomorrow');

    // "Dienstag morgen" / "am Morgen" is a part of the day, not tomorrow.
    if (word === 'morgen') {
      const before = text.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
      if (new RegExp(`(?:${WEEKDAY_RX}|heute|am|jeden)\\s+$`, 'iu').test(before)) {
        add('part', m, { part: 'morning' });
        return;
      }
    }

    const offset = /^(?:heute|today|tonight)$/.test(word) ? 0
      : /^(?:übermorgen|uebermorgen|the day after tomorrow|day after tomorrow)$/.test(word) ? 2
        : 1;
    add('relday', m, { offset });
    if (word === 'tonight') add('part', m, { part: 'evening' });
  });
  // in 2 Wochen / in 3 Tagen / in einer Woche / in two weeks
  each(`${B}in\\s+(\\d{1,2}|einer|einem|a|one|${NUMWORD_RX})\\s+(tag(?:en)?|woche(?:n)?|days?|weeks?)${E}`, (m) => {
    const n = /^(?:einer|einem|a|one)$/i.test(m[1]) ? 1 : num(m[1]);
    const days = /^(?:woche|week)/i.test(m[2]) ? n * 7 : n;
    if (n > 0) add('relspan', m, { days });
  });

  // --- weekdays ---------------------------------------------------
  const modRx = '(?:(nächsten|nächste|naechsten|kommenden|kommende|diesen|diese|this|next|coming|jeden|jede|every|immer|jeden\\s+zweiten|alle\\s+zwei\\s+wochen|every\\s+other)\\s+)?';
  const weekRx = '(?:\\s+(nächste|naechste|kommende|next)\\s+woche|\\s+next\\s+week)?';
  each(`${B}(?:(nächste|naechste|kommende|next)\\s+(?:woche|week)\\s+)?${modRx}(${WEEKDAY_RX})(morgen|vormittag|mittag|nachmittag|abend|nacht)?(s)?${E}${weekRx}`, (m) => {
    const [, weekBefore, mod, name, partWord, plural, weekAfter] = m;
    const repeat = recurrenceFor(mod, plural);
    add('weekday', m, {
      wd: WEEKDAYS[name.toLowerCase()],
      mod: weekBefore || weekAfter || /next\s+week$/i.test(m[0]) ? 'nextweek' : modifier(mod),
      repeat,
    });
    if (partWord) {
      const part = { morgen: 'morning', vormittag: 'morning', mittag: 'noon', nachmittag: 'afternoon', abend: 'evening', nacht: 'night' }[partWord.toLowerCase()];
      add('part', m, { part });
    }
  });
  // täglich / jeden Tag / every day; jedes Jahr / every year
  each(`${B}(täglich|taeglich|jeden\\s+tag|every\\s+day|daily|jedes\\s+jahr|jährlich|jaehrlich|every\\s+year|yearly|annually)${E}`, (m) => {
    add('repeat', m, { repeat: /tag|day|daily|täglich|taeglich/i.test(m[1]) ? { freq: 'DAILY' } : { freq: 'YEARLY' } });
  });
  // Mo, Di., Thu — only right before a date or time
  each(`(?<![\\p{L}\\d])${modRx}(${WEEKDAY_SHORT_RX})\\.?(?=,?\\s*\\d)`, (m) => {
    const word = m[2];
    // Two-letter German forms are common words in lower case ("so 5").
    if (word.length === 2 && word[0] !== word[0].toUpperCase()) return;
    add('weekday', m, { wd: WEEKDAYS_SHORT[word.toLowerCase()], mod: modifier(m[1]) });
  });

  // --- times ------------------------------------------------------
  const ampm = '(?:\\s*(am|pm|a\\.m\\.|p\\.m\\.))';
  const uhr = '(?:\\s*(uhr|h)(?![\\p{L}]))';

  // 17:15 (Uhr) / 5:30 pm
  each(`${B}(\\d{1,2}):(\\d{2})(?:${ampm}|${uhr})?${E}`, (m) => {
    const [, h, mi, mer] = m;
    if (+h <= 24 && +mi < 60) add('time', m, { h: +h, mi: +mi, mer: meridiem(mer), lead0: h.length === 2 && h[0] === '0' });
  });
  // 17.15 Uhr / um 17.15
  each(`${B}(?:(um|ab|gegen|bis)\\s+)?(\\d{1,2})\\.(\\d{2})${uhr}?${E}`, (m) => {
    const [, prep, h, mi, u] = m;
    if (!prep && !u) return;
    if (+h <= 24 && +mi < 60) add('time', m, { h: +h, mi: +mi, mer: null });
  });
  // 17 Uhr / 5pm / um 5 / gegen 9 / at 5
  each(`${B}(?:(um|ab|gegen|at|by)\\s+)?(\\d{1,2})(?:${ampm}|${uhr})${E}`, (m) => {
    const [, , h, mer] = m;
    if (+h <= 24) add('time', m, { h: +h, mi: 0, mer: meridiem(mer) });
  });
  each(`${B}(um|gegen|at)\\s+(\\d{1,2}|${NUMWORD_RX})(?![\\d.:/])${E}(?!\\s*(?:tage|tagen|wochen|minuten|min|stunden|jahre|euro|€|%|days|weeks|minutes|hours|years|uhr|am|pm|h${E}))`, (m) => {
    const h = num(m[2]);
    if (h <= 24) add('time', m, { h, mi: 0, mer: null });
  });
  // vierzehn Uhr / zwölf Uhr dreißig / 17 Uhr 30
  each(`${B}(?:(um|ab|gegen)\\s+)?(${HOUR_RX})\\s+uhr(?:\\s+(\\d{2}|${Object.keys(MINUTE_WORDS).join('|')}))?${E}`, (m) => {
    const h = num(m[2]);
    const mi = m[3] ? (MINUTE_WORDS[m[3].toLowerCase()] ?? Number(m[3])) : 0;
    if (h <= 24 && mi < 60) add('time', m, { h, mi, mer: null, exact24: h > 12 });
  });

  // halb 5 → 4:30, viertel nach 3, viertel vor 4, dreiviertel 8, 10 nach 3
  each(`${B}(?:(um|gegen|ab)\\s+)?halb\\s+(${HOUR_RX})${E}`, (m) => {
    add('time', m, { h: num(m[2]) - 1 || 12, mi: 30, mer: null, colloquial: true });
  });
  each(`${B}(?:(um|gegen|ab)\\s+)?(viertel|\\d{1,2}|${NUMWORD_RX})\\s+(nach|vor)\\s+(halb\\s+)?(${HOUR_RX})${E}`, (m) => {
    const [, , amount, dir, half, hourWord] = m;
    const minutes = amount.toLowerCase() === 'viertel' ? 15 : num(amount);
    if (!(minutes > 0 && minutes < 30)) return;
    let total = num(hourWord) * 60 - (half ? 30 : 0) + (dir.toLowerCase() === 'nach' ? minutes : -minutes);
    total = (total + 12 * 60) % (12 * 60) || 12 * 60;
    add('time', m, { h: Math.floor(total / 60) || 12, mi: total % 60, mer: null, colloquial: true });
  });
  each(`${B}(?:(um|gegen|ab)\\s+)?dreiviertel\\s+(${HOUR_RX})${E}`, (m) => {
    add('time', m, { h: num(m[2]) - 1 || 12, mi: 45, mer: null, colloquial: true });
  });
  // "viertel 8" is 7:15 in parts of Germany and unknown elsewhere.
  each(`${B}(?:(um|gegen|ab)\\s+)?viertel\\s+(${HOUR_RX})${E}`, (m) => {
    add('time', m, { h: num(m[2]) - 1 || 12, mi: 15, mer: null, colloquial: true, regional: true });
  });
  each(`${B}(?:(at|around)\\s+)?(half|quarter)\\s+(past|to)\\s+(${HOUR_RX})${E}`, (m) => {
    const [, , amount, dir, hourWord] = m;
    const minutes = amount.toLowerCase() === 'half' ? 30 : 15;
    let total = num(hourWord) * 60 + (dir.toLowerCase() === 'past' ? minutes : -minutes);
    total = (total + 12 * 60) % (12 * 60) || 12 * 60;
    add('time', m, { h: Math.floor(total / 60) || 12, mi: total % 60, mer: null, colloquial: true });
  });
  each(`${B}(noon|midday|mittag|midnight|mitternacht)${E}`, (m) => {
    const word = m[1].toLowerCase();
    if (word === 'mittag') {
      // "zu Mittag essen" is a meal; "um/gegen Mittag" a time.
      const before = text.slice(Math.max(0, m.index - 6), m.index).toLowerCase();
      if (!/(?:um|gegen|ab)\s+$/.test(before)) return;
    }
    add('time', m, { h: /mid?night|mitternacht/.test(word) ? 0 : 12, mi: 0, mer: null, exact24: true });
  });

  // --- time ranges ------------------------------------------------
  // 14-16 Uhr / 10–11:30 / 10-11am (the unit after the second time)
  each(`${B}(\\d{1,2})(?::(\\d{2}))?\\s*(?:-|–|bis|to)\\s*(\\d{1,2})(?::(\\d{2}))?(?:${ampm}|${uhr})${E}`, (m) => {
    const [, h1, m1, h2, m2, mer] = m;
    if (+h1 > 24 || +h2 > 24) return;
    const merid = meridiem(mer);
    add('time', m, {
      h: +h1, mi: +(m1 || 0), mer: merid && +h1 <= +h2 ? merid : null,
      end: { h: +h2, mi: +(m2 || 0), mer: merid },
    });
  });

  // zwischen 14 und 18 Uhr / von 10 bis 12
  each(`${B}(?:zwischen|von|from|between)\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(?:uhr\\s+)?(?:und|bis|and|to)\\s+(\\d{1,2})(?::(\\d{2}))?(?:${ampm}|${uhr})?${E}`, (m) => {
    const [, h1, m1, h2, m2, mer] = m;
    if (+h1 > 24 || +h2 > 24) return;
    const merid = meridiem(mer);
    add('time', m, {
      h: +h1, mi: +(m1 || 0), mer: merid && +h1 <= +h2 ? merid : null,
      end: { h: +h2, mi: +(m2 || 0), mer: merid },
    });
  });

  // --- parts of the day -------------------------------------------
  each(`${B}(morgens|früh|frueh|vormittags?|am vormittag|mittags|nachmittags?|am nachmittag|abends?|am abend|nachts|in der nacht|in the morning|in the afternoon|in the evening|at night)${E}`, (m) => {
    const word = m[1].toLowerCase();
    const part = PARTS_OF_DAY.find(([test]) => test.test(word))?.[1];
    if (part) add('part', m, { part });
  });

  return pruneOverlaps(out);
}

function recurrenceFor(mod, plural) {
  const w = String(mod || '').toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:jeden zweiten|alle zwei wochen|every other)$/.test(w)) return { freq: 'WEEKLY', interval: 2 };
  if (/^(?:jeden|jede|every|immer)$/.test(w) || plural) return { freq: 'WEEKLY' };
  return null;
}

function modifier(raw) {
  const w = String(raw || '').toLowerCase();
  if (!w) return null;
  if (/^(?:jeden|jede|every|immer|jeden zweiten|alle zwei wochen|every other)$/.test(w.replace(/\s+/g, ' '))) return null;
  return /^(?:diese|diesen|this)$/.test(w) ? 'this' : 'next';
}

function meridiem(raw) {
  const w = String(raw || '').toLowerCase().replace(/\./g, '');
  return w === 'am' ? 'am' : w === 'pm' ? 'pm' : null;
}

const KIND_RANK = { range: 5, date: 4, time: 3, weekday: 2, relday: 2, relspan: 2, repeat: 1, part: 1 };

/*
  Overlapping finds: the longer one wins ("17.15 Uhr" over the date
  reading of "17.15"), then the more specific kind. Parts of the day may
  sit inside a weekday ("Dienstagabend") and are kept.
*/
function pruneOverlaps(mentions) {
  const sorted = mentions
    .map((m) => ({ ...m, rank: (m.to - m.from) * 10 + (KIND_RANK[m.kind] || 0) - (m.weak ? 5 : 0) }))
    .sort((a, b) => b.rank - a.rank);

  const kept = [];

  for (const m of sorted) {
    const clash = kept.some((k) =>
      m.from < k.to && k.from < m.to &&
      !(m.kind === 'part' && k.kind === 'weekday' && m.from === k.from) &&
      !(m.kind === 'part' && k.kind === 'relday' && m.from === k.from));
    if (!clash) kept.push(m);
  }

  return kept.sort((a, b) => a.from - b.from || a.to - b.to);
}

// ---------------------------------------------------------------
// Grouping: neighbouring mentions describe one moment.
// ---------------------------------------------------------------

// What may sit between two parts of one moment: "3.12. Um 17:15",
// "Do., 3.12., 17:15", "am Donnerstag, den 3. Dezember um 17 Uhr",
// "tomorrow at 5", "Do 14-16 Uhr".
const JOIN_RX = /^[\s,;:–-]*(?:(?:am|um|ab|den|der|vom|von|gegen|at|on|from|the|,|-|–)[\s,]*)*$/iu;

const DAY_KINDS = ['date', 'range', 'relday', 'relspan', 'weekday'];

function group(mentions, text) {
  const groups = [];
  let current = null;

  for (const m of mentions) {
    // "23.12. und 24.12.", "24.12.–2.1.": two dates make one span of days.
    const last = current?.items[current.items.length - 1];
    if (
      last?.kind === 'date' && m.kind === 'date' && last.m && m.m &&
      /^\s*(?:und|and|&|bis(?:\s+zum)?|-|–|to|until)\s*$/iu.test(text.slice(last.to, m.from))
    ) {
      current.items[current.items.length - 1] = {
        kind: 'range', from: last.from, to: m.to,
        from1: { d: last.d, m: last.m }, to1: { d: m.d, m: m.m }, y: last.y || m.y,
      };
      current.to = m.to;
      continue;
    }

    const gap = current ? text.slice(current.to, m.from) : '';
    const fits = current &&
      gap.length <= 24 &&
      JOIN_RX.test(gap) &&
      compatible(current, m);

    if (fits) {
      current.items.push(m);
      current.to = m.to;
    } else {
      current = { from: m.from, to: m.to, items: [m] };
      groups.push(current);
    }
  }

  return mergeDayAndTime(groups, text);
}

const hasKinds = (g, kinds) => g.items.some((i) => kinds.includes(i.kind));

/*
  "morgen die Kinder um viertel vor 3 abholen", "Mittwoch! Gegen 18 Uhr",
  "28.11. Feier ab 15 Uhr": a day and a time a few words apart are one
  moment when nothing else names a day in between.
*/
function mergeDayAndTime(groups, text) {
  const out = [];

  for (const g of groups) {
    const prev = out[out.length - 1];
    const gap = prev ? text.slice(prev.to, g.from) : '';
    const dayOnly = (x) => hasKinds(x, DAY_KINDS) && !hasKinds(x, ['time']);
    const timeOnly = (x) => hasKinds(x, ['time']) && !hasKinds(x, DAY_KINDS);

    if (
      prev && gap.length <= 50 && !/\n\s*\n/.test(gap) &&
      (gap.match(/[.!?]/g) || []).length <= 1 &&
      ((dayOnly(prev) && timeOnly(g)) || (timeOnly(prev) && dayOnly(g)))
    ) {
      prev.items.push(...g.items);
      prev.to = g.to;
      continue;
    }

    out.push(g);
  }

  return out;
}

// One group holds at most one day, one weekday, one time and one part.
function compatible(groupSoFar, m) {
  const has = (kinds) => groupSoFar.items.some((i) => kinds.includes(i.kind));
  if (['date', 'range', 'relday', 'relspan'].includes(m.kind)) return !has(['date', 'range', 'relday', 'relspan']);
  if (m.kind === 'weekday') return !has(['weekday', 'relday', 'relspan']);
  if (m.kind === 'time') return !has(['time']);
  if (m.kind === 'part') return !has(['part']);
  if (m.kind === 'repeat') return !has(['repeat']);
  return true;
}

// ---------------------------------------------------------------
// Resolution: a group becomes a concrete start (and maybe end).
// ---------------------------------------------------------------

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function atTime(day, h, mi) {
  const d = new Date(day);
  d.setHours(h, mi, 0, 0);
  return d;
}

function mondayOf(date) {
  const d = startOfDay(date.getTime());
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** The year a day without one most likely means: this one, unless it has passed. */
function chooseYear({ d, m }, today, weekday) {
  const y = today.getFullYear();
  const options = [y, y + 1].map((year) => new Date(year, m - 1, d));

  if (weekday != null) {
    const match = options.find((o) => o.getDay() === weekday && o >= addDays(today, -1));
    if (match) return { date: match, weekdayChecked: true };
  }

  return { date: options[0] >= today ? options[0] : options[1], weekdayChecked: false };
}

/*
  Hours from 1 to 7 without am/pm or a part of the day are almost always
  afternoon in an appointment ("um 5", "halb 5"); 8 to 11 morning. Both
  are guesses and say so, with the other reading as an alternative.
*/
function resolveHour(t, part, flags) {
  const { h, mer } = t;
  if (mer === 'pm') return h % 12 + 12;
  if (mer === 'am') return h % 12;
  if (t.exact24 || h === 0 || h >= 13 || t.lead0) return h % 24;
  if (part === 'morning') return h === 12 ? 12 : h;
  if (part === 'noon') return h <= 2 ? h + 12 : h;
  if (part === 'afternoon' || part === 'evening' || part === 'night') return h === 12 ? 12 : h + 12;
  if (h === 12) return 12;
  if (h <= 7) {
    flags.add('meridiem-guessed');
    return h + 12;
  }
  if (t.colloquial) flags.add('meridiem-guessed');
  return h;
}

function resolve(groupItem, text, now) {
  const today = startOfDay(now);
  const flags = new Set();
  const alternatives = [];

  const pick = (kind) => groupItem.items.find((i) => i.kind === kind);
  const date = pick('date');
  const range = pick('range');
  const relday = pick('relday');
  const relspan = pick('relspan');
  const weekday = pick('weekday');
  const time = pick('time');
  const part = pick('part')?.part || null;

  let day = null;
  let endDay = null;

  if (range) {
    const y = range.y;
    const from = y ? { date: new Date(y, range.from1.m - 1, range.from1.d) } : chooseYear(range.from1, today, null);
    day = from.date;
    endDay = new Date(day.getFullYear(), range.to1.m - 1, range.to1.d);
    if (endDay < day) endDay = new Date(day.getFullYear() + 1, range.to1.m - 1, range.to1.d);
  } else if (date) {
    if (!date.m) {
      // "am 21.": this month if still ahead, else next month.
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), date.d);
      day = thisMonth >= today ? thisMonth : new Date(today.getFullYear(), today.getMonth() + 1, date.d);
      flags.add('month-assumed');
    } else if (date.y) {
      day = new Date(date.y, date.m - 1, date.d);
    } else {
      const chosen = chooseYear(date, today, weekday?.wd);
      day = chosen.date;
    }
    if (weekday && day.getDay() !== weekday.wd) flags.add('weekday-mismatch');
  } else if (relday) {
    day = addDays(today, relday.offset);
  } else if (relspan) {
    day = addDays(today, relspan.days);
  } else if (weekday) {
    let delta = (weekday.wd - today.getDay() + 7) % 7;
    if (weekday.mod === 'nextweek') {
      // That weekday in the coming Monday-to-Sunday week.
      delta = (weekday.wd + 6) % 7 + 7 - (today.getDay() + 6) % 7;
    } else if (delta === 0) {
      // "Dienstag" on a Tuesday: later today if a time says so, else next week.
      const later = time && atTime(today, resolveHour(time, part, new Set()), time.mi) > new Date(now);
      if (!later || weekday.mod === 'next') delta = 7;
      flags.add('weekday-is-today');
    }
    day = addDays(today, delta);
    // "nächsten Freitag" in the same week: this Friday or the one after?
    if (weekday.mod === 'next' && mondayOf(day).getTime() === mondayOf(today).getTime()) {
      flags.add('next-weekday-ambiguous');
      alternatives.push({ shiftDays: 7 });
    }
  }

  let start = null;
  let end = null;
  let allDay = false;

  if (time) {
    const h = resolveHour(time, part, flags);
    if (flags.has('meridiem-guessed')) alternatives.push({ shiftHours: h >= 12 ? -12 : 12 });
    if (time.regional) flags.add('regional-time');

    if (!day) {
      // Only a clock time: today if it is still ahead, else tomorrow.
      const candidate = atTime(today, h, time.mi);
      day = candidate > new Date(now) ? today : addDays(today, 1);
      flags.add('date-assumed');
    }

    start = atTime(day, h % 24, time.mi);

    if (time.end) {
      let eh = time.end.mer ? resolveHour(time.end, part, new Set()) : time.end.h;
      // "14-16 Uhr" / "von 2 bis 4": the end follows the start's half of the day.
      if (!time.end.mer && eh < 13 && h >= 12 && eh + 12 > h) eh += 12;
      end = atTime(day, eh % 24, time.end.mi);
      if (end <= start) end = null;
    }
  } else if (day) {
    allDay = true;
    start = day;
    if (endDay) end = endDay;
    if (part) flags.add('time-missing');
  } else {
    return null;
  }

  const repeatItem = pick('repeat');
  const repeat = weekday?.repeat || repeatItem?.repeat || null;
  let recurrence = null;
  if (repeat) {
    const parts = [`FREQ=${repeat.freq}`];
    if (repeat.interval) parts.push(`INTERVAL=${repeat.interval}`);
    if (repeat.freq === 'WEEKLY' && weekday) parts.push(`BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][weekday.wd]}`);
    recurrence = { rrule: parts.join(';') };
  }

  // Said as past ("Letztes Mal am 3.11.", "gestern"): context, not the event.
  const before = text.slice(Math.max(0, groupItem.from - 30), groupItem.from).toLowerCase();
  const after = text.slice(groupItem.to, groupItem.to + 12).toLowerCase();
  const clauseAfter = text.slice(groupItem.to, groupItem.to + 40).split(/[,;.!?\n]/)[0].toLowerCase();
  const past = /(?:letzte[nms]?|vorige[nms]?|gestern|last|yesterday)\s+(?:\S+\s+){0,2}$/iu.test(before) ||
    /^\s*(?:war|waren|hatten|was|were)\b/iu.test(after) ||
    // "Am 3.12. habe ich keine Zeit": a day ruled out, not proposed.
    /\b(?:keine zeit|kann ich nicht|geht (?:es |das )?nicht|nicht da|can't|cannot|can not|not available|doesn't work)\b/iu.test(clauseAfter) ||
    (start < startOfDay(now) && !allDay) ||
    (allDay && (end || start) < startOfDay(now));

  return {
    start,
    end,
    allDay,
    recurrence,
    from: groupItem.from,
    to: groupItem.to,
    text: text.slice(groupItem.from, groupItem.to),
    spans: groupItem.items.map((i) => [i.from, i.to]),
    flags: [...flags],
    alternatives,
    past,
    hasDay: !!(date || range || relday || relspan || weekday),
    hasTime: !!time,
  };
}

/*
  Most useful first: a day and a time beat a day alone, which beats a
  time alone; anything in the past goes last; ties keep text order.
*/
function score(c, text) {
  const near = text.slice(Math.max(0, c.from - 40), c.to + 10).toLowerCase();
  return (c.hasDay ? 2 : 0) +
    (c.hasTime ? 2 : 0) +
    (/termin|treffen|appointment|meeting|verabredung|reserviert|reservation|booked|gebucht/.test(near) ? 1 : 0) -
    (c.flags.includes('date-assumed') ? 1 : 0) -
    (c.past ? 10 : 0);
}

/**
 * Every moment the text names, best first.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.now]  reference time (ms), default Date.now()
 * @param {'dmy'|'mdy'} [options.dateOrder]  how to read "12/3"
 * @returns {Array<{start: Date, end: Date|null, allDay: boolean, text: string,
 *   from: number, to: number, spans: number[][], flags: string[],
 *   alternatives: object[], past: boolean}>}
 */
export function findWhen(text, { now = Date.now(), dateOrder = 'dmy' } = {}) {
  const source = String(text || '');
  if (!source.trim()) return [];

  const candidates = group(scan(source, { dateOrder }), source)
    .map((g) => resolve(g, source, now))
    .filter(Boolean);

  return candidates
    .map((c, i) => ({ c, i, s: score(c, source) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ c }) => c);
}

/** "dmy" or "mdy" for a BCP 47 locale, from how it formats a date. */
export function dateOrderForLocale(locale) {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric' }).formatToParts(new Date(2026, 11, 3));
    return parts.findIndex((p) => p.type === 'month') < parts.findIndex((p) => p.type === 'day') ? 'mdy' : 'dmy';
  } catch {
    return 'dmy';
  }
}

export const _private = { scan, DAY_MS };

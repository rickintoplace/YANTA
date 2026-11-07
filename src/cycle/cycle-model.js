// ============================================================
// YANTA — cycle calendar: the arithmetic
//
// Pure functions, no DOM, no state: logged entries in, an honest
// forecast out. What it does is deliberately the boring, well-tested
// core of what the big trackers do with calendar data alone:
//
// - Cycle length is the gap between two logged period starts. The
//   typical length is a recency-weighted median of the last cycles,
//   shrunk towards a population prior while there are few of them
//   (29 days: the median in the Clue and Natural Cycles datasets,
//   Li et al. 2020, Bull et al. 2019).
// - A gap that looks like two cycles is most likely a period nobody
//   logged, not a 58-day cycle (Li et al. 2022, JAMIA: modelling
//   skipped tracking is what beats mean/median predictors). Such gaps
//   are left out of the statistics until someone confirms them.
// - Predictions are distributions over days, not dates. The next start
//   is conditioned on the days that already passed without a period
//   (a late period moves the forecast instead of leaving it stuck in
//   the past), and every later cycle adds its own uncertainty.
// - Ovulation is counted back from the next start: the luteal phase
//   (~12 days) varies far less than the follicular phase (Bull 2019,
//   Najmabadi 2020). The fertile window is the five days before it
//   and the day itself (Wilcox 1995). A confirmed ovulation (LH test,
//   temperature shift) replaces the guess for its cycle.
//
// Nothing here is stored: the forecast is recomputed from the entries
// every time, so a period that comes early or late simply moves
// everything after it.
// ============================================================

const DAY_MS = 86400000;

export const CYCLE_PRIOR = Object.freeze({
  cycle: 29, // days, population median
  spread: 4, // days, typical within-person SD (Apple Women's Health Study: 4–6)
  period: 5, // days of bleeding
  luteal: 12, // days from ovulation to the next period
  lutealSpread: 2,
  weight: 1, // the prior counts like one observed cycle
});

export const CYCLE_LIMITS = Object.freeze({
  sameBleed: 10, // starts closer than this are one period logged twice
  shortest: 15, // a shorter gap is a stray entry, not a cycle
  longest: 90, // a longer gap is a gap in tracking (Li et al. 2022)
  history: 12, // cycles that count
  halfLife: 6, // cycles until a cycle counts half
  maxPeriod: 12,
});

// ---------------- days ----------------------------------------------

/** 'YYYY-MM-DD' → whole days since the epoch (UTC, DST-proof). */
export function dayOf(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
  if (!m) return NaN;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function keyOf(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

// ---------------- small statistics ------------------------------------

function weightedMedian(values, weights) {
  const pairs = values.map((v, i) => [v, weights[i]]).sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [v, w] of pairs) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return pairs.at(-1)?.[0];
}

function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function normal(x, mu, sd) {
  const z = (x - mu) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/*
  Cycle lengths have heavier tails than a normal curve: most cycles sit
  near the typical length, a few are much longer or shorter. A narrow
  core plus a wide shoulder keeps a late period from being "due
  tomorrow" forever.
*/
function lengthDensity(x, center, spread) {
  return 0.85 * normal(x, center, spread) + 0.15 * normal(x, center, spread * 2.5 + 3);
}

// ---------------- distributions over days ----------------------------
// { from: firstDay, p: [probabilities] } — always normalized.

function makeDist(from, p) {
  let lo = 0;
  let hi = p.length - 1;
  while (lo < hi && p[lo] < 1e-7) lo++;
  while (hi > lo && p[hi] < 1e-7) hi--;
  const q = p.slice(lo, hi + 1);
  const total = q.reduce((s, v) => s + v, 0) || 1;
  return { from: from + lo, p: q.map((v) => v / total) };
}

/** Length of one cycle, in days, as a distribution starting at 0. */
export function cycleLengthDist(center, spread) {
  const max = Math.ceil(center + 6 * (spread * 2.5 + 3));
  const p = [];
  for (let l = 0; l <= max; l++) p.push(l < CYCLE_LIMITS.shortest ? 0 : lengthDensity(l, center, spread));
  return makeDist(0, p);
}

function shift(dist, days) {
  return { from: dist.from + days, p: dist.p };
}

function convolve(a, b) {
  const p = new Array(a.p.length + b.p.length - 1).fill(0);
  for (let i = 0; i < a.p.length; i++) {
    if (a.p[i] < 1e-9) continue;
    for (let j = 0; j < b.p.length; j++) p[i + j] += a.p[i] * b.p[j];
  }
  return makeDist(a.from + b.from, p);
}

/** Condition on "not before `day`". */
function notBefore(dist, day) {
  const cut = day - dist.from;
  if (cut <= 0) return dist;
  if (cut >= dist.p.length) return { from: day, p: [1] };
  const p = dist.p.map((v, i) => (i < cut ? 0 : v));
  if (p.reduce((s, v) => s + v, 0) < 1e-9) return { from: day, p: [1] };
  return makeDist(dist.from, p);
}

export function quantile(dist, q) {
  let acc = 0;
  for (let i = 0; i < dist.p.length; i++) {
    acc += dist.p[i];
    if (acc >= q - 1e-12) return dist.from + i;
  }
  return dist.from + dist.p.length - 1;
}

function probAt(dist, day) {
  const i = day - dist.from;
  return i >= 0 && i < dist.p.length ? dist.p[i] : 0;
}

/** P(the event falls in [day, day + width)) for each day — e.g. "bleeding today". */
function windowProb(dist, day, width) {
  let s = 0;
  for (let d = day - width + 1; d <= day; d++) s += probAt(dist, d);
  return s;
}

/*
  The days a forecast bar covers: the run of days around the most likely
  one whose probability reaches a threshold. Sure forecasts give short,
  strong bars; unsure ones give long, faint bars (the threshold drops
  with the peak, so there is always something to see).
*/
function confidentRun(probAtDay, from, to) {
  let peakDay = from;
  let peak = 0;
  for (let d = from; d <= to; d++) {
    const p = probAtDay(d);
    if (p > peak) { peak = p; peakDay = d; }
  }
  const threshold = Math.min(0.4, 0.6 * peak);
  let a = peakDay;
  let b = peakDay;
  while (a > from && probAtDay(a - 1) >= threshold) a--;
  while (b < to && probAtDay(b + 1) >= threshold) b++;
  return { start: a, end: b, peak };
}

// ---------------- entries --------------------------------------------

/**
 * Entries, as the calendar hands them over:
 *   { id, kind: 'period'|'spotting'|'ovulation'|'pause', start, end?,
 *     open?, reason?, confirmed?, by? }
 * with `start`/`end` as local date keys (end inclusive).
 */
function normalizeEntries(entries) {
  const out = { periods: [], ovulations: [], pauses: [] };

  for (const e of entries || []) {
    const start = dayOf(e?.start);
    if (!Number.isFinite(start)) continue;
    const endRaw = dayOf(e.end);
    const end = Number.isFinite(endRaw) && endRaw >= start ? endRaw : null;

    if (e.kind === 'pause') out.pauses.push({ id: e.id, start, end: e.open ? null : (end ?? start), reason: e.reason || 'other' });
    else if (e.kind === 'ovulation') out.ovulations.push({ id: e.id, day: start });
    else if (e.kind === 'period' || !e.kind) out.periods.push({ id: e.id, start, end, confirmed: !!e.confirmed, by: e.by || null });
  }

  out.periods.sort((a, b) => a.start - b.start);
  out.pauses.sort((a, b) => a.start - b.start);
  out.ovulations.sort((a, b) => a.day - b.day);

  // One period logged twice (two devices, two people, a corrected
  // date) becomes one: the earliest start, the latest end.
  const merged = [];
  for (const p of out.periods) {
    const last = merged.at(-1);
    if (last && p.start - last.start < CYCLE_LIMITS.sameBleed) {
      last.ids.push(p.id);
      if (p.end != null) last.end = Math.max(last.end ?? p.end, p.end);
      last.confirmed ||= p.confirmed;
      continue;
    }
    merged.push({ ...p, ids: [p.id] });
  }
  out.periods = merged.map((p) => ({
    ...p,
    end: p.end != null && p.end - p.start < CYCLE_LIMITS.maxPeriod ? p.end : null,
  }));

  return out;
}

function pauseBetween(pauses, from, to, today) {
  return pauses.find((p) => p.start < to && (p.end ?? today) >= from) || null;
}

// ---------------- analysis -------------------------------------------

/**
 * @param entries  see normalizeEntries
 * @param options  { today: 'YYYY-MM-DD', typicalLength?, typicalPeriod?, horizonDays? }
 */
export function analyzeCycle(entries, options = {}) {
  const today = dayOf(options.today) || Math.floor(Date.now() / DAY_MS);
  const horizon = today + (options.horizonDays ?? 400);
  const { periods, ovulations, pauses } = normalizeEntries(entries);

  const userCycle = Number(options.typicalLength);
  const prior = {
    cycle: userCycle >= 18 && userCycle <= 60 ? userCycle : CYCLE_PRIOR.cycle,
    weight: userCycle >= 18 && userCycle <= 60 ? 2 : CYCLE_PRIOR.weight,
  };

  // ---- cycles between consecutive starts
  const cycles = [];
  for (let i = 0; i + 1 < periods.length; i++) {
    const a = periods[i];
    const b = periods[i + 1];
    const length = b.start - a.start;
    const pause = pauseBetween(pauses, a.start, b.start, today);
    let flag = null;
    if (pause) flag = 'pause';
    else if (length > CYCLE_LIMITS.longest && !b.confirmed) flag = 'gap';
    else if (length < CYCLE_LIMITS.shortest && !b.confirmed) flag = 'short';
    cycles.push({ start: a.start, next: b.start, length, flag, confirmed: b.confirmed, periodId: b.ids[0] });
  }

  // ---- a first look, to tell missed entries from long cycles
  const plausible = cycles.filter((c) => !c.flag && c.length <= 60).map((c) => c.length);
  const roughCenter = plausible.length >= 2 ? median(plausible) : prior.cycle;
  const roughSpread = plausible.length >= 3
    ? Math.max(2, 1.4826 * median(plausible.map((l) => Math.abs(l - roughCenter))))
    : CYCLE_PRIOR.spread;

  for (const c of cycles) {
    if (c.flag || c.confirmed) continue;
    // One cycle, or two (three) with the period(s) in between not logged?
    const like = [1, 2, 3].map((k) => {
      const prior = k === 1 ? 0.9 : k === 2 ? 0.08 : 0.02;
      const dens = k === 1
        ? lengthDensity(c.length, roughCenter, roughSpread)
        : normal(c.length, k * roughCenter, Math.sqrt(k) * roughSpread);
      return prior * dens;
    });
    const total = like[0] + like[1] + like[2];
    c.missedProbability = total > 0 ? (like[1] + like[2]) / total : 0;
    if (c.missedProbability > 0.5) c.flag = 'missed';
  }

  // ---- the statistics, from the cycles that count
  const used = cycles.filter((c) => !c.flag).slice(-CYCLE_LIMITS.history);
  const weights = used.map((_, i) => 0.5 ** ((used.length - 1 - i) / CYCLE_LIMITS.halfLife));
  const W = weights.reduce((s, w) => s + w, 0);

  let center = prior.cycle;
  let rawSpread = null;
  if (used.length) {
    const lengths = used.map((c) => c.length);
    const med = weightedMedian(lengths, weights);
    const mad = 1.4826 * median(lengths.map((l) => Math.abs(l - med)));
    const clip = Math.max(3, 2.5 * mad);
    const variance = used.length >= 2
      ? lengths.reduce((s, l, i) => s + weights[i] * Math.min((l - med) ** 2, clip * clip), 0) / W
      : null;
    center = (W * med + prior.weight * prior.cycle) / (W + prior.weight);
    rawSpread = variance != null ? Math.sqrt(variance) : null;
  }
  const spread = Math.max(1.2, Math.sqrt(
    ((rawSpread != null ? W * rawSpread ** 2 : 0) + prior.weight * CYCLE_PRIOR.spread ** 2) /
    ((rawSpread != null ? W : 0) + prior.weight),
  ));

  // Variability as Li et al. measure it: the median difference between
  // consecutive cycle lengths.
  const diffs = [];
  for (let i = 1; i < used.length; i++) {
    if (used[i - 1].next === used[i].start) diffs.push(Math.abs(used[i].length - used[i - 1].length));
  }
  const medianDifference = diffs.length ? median(diffs) : null;

  let regularity = 'learning';
  if (used.length >= 3) {
    if ((medianDifference ?? 0) > 9 || (rawSpread ?? 0) > 7) regularity = 'irregular';
    else if ((rawSpread ?? 0) > 3.5 || (medianDifference ?? 0) > 4) regularity = 'variable';
    else regularity = 'regular';
  }

  const periodLengths = periods.filter((p) => p.end != null).map((p) => p.end - p.start + 1).slice(-CYCLE_LIMITS.history);
  const userPeriod = Number(options.typicalPeriod);
  const periodLength = periodLengths.length
    ? Math.round(median(periodLengths))
    : userPeriod >= 1 && userPeriod <= CYCLE_LIMITS.maxPeriod ? Math.round(userPeriod) : CYCLE_PRIOR.period;

  // Luteal phase: personal when ovulations were confirmed.
  const luteals = [];
  for (const o of ovulations) {
    const next = periods.find((p) => p.start > o.day);
    const prev = [...periods].reverse().find((p) => p.start <= o.day);
    if (!next || !prev) continue;
    const l = next.start - o.day;
    if (l >= 7 && l <= 18) luteals.push(l);
  }
  const luteal = luteals.length
    ? (luteals.reduce((s, l) => s + l, 0) + 2 * CYCLE_PRIOR.luteal) / (luteals.length + 2)
    : CYCLE_PRIOR.luteal;
  const lutealSpread = luteals.length >= 2 ? 1.5 : CYCLE_PRIOR.lutealSpread;

  const stats = {
    cycle: Math.round(center * 10) / 10,
    spread: Math.round(spread * 10) / 10,
    rawSpread: rawSpread != null ? Math.round(rawSpread * 10) / 10 : null,
    period: periodLength,
    luteal: Math.round(luteal * 10) / 10,
    counted: used.length,
    medianDifference,
    regularity,
    usual: [
      quantile(cycleLengthDist(center, spread), 0.1),
      quantile(cycleLengthDist(center, spread), 0.9),
    ],
  };

  const base = {
    stats,
    periods: periods.map((p) => ({ ids: p.ids, start: keyOf(p.start), end: p.end != null ? keyOf(p.end) : null, by: p.by })),
    cycles: cycles.map((c) => ({
      start: keyOf(c.start),
      next: keyOf(c.next),
      length: c.length,
      flag: c.flag,
      periodId: c.periodId,
      missedProbability: c.missedProbability != null ? Math.round(c.missedProbability * 100) / 100 : undefined,
    })),
    pause: null,
    current: null,
    forecasts: [],
  };

  // ---- paused (pregnancy, hormonal contraception, …)
  const openPause = pauses.find((p) => p.end == null && p.start <= today);
  if (openPause) {
    return { ...base, status: 'paused', pause: { id: openPause.id, since: keyOf(openPause.start), reason: openPause.reason } };
  }

  const anchor = periods.at(-1);
  if (!anchor) return { ...base, status: 'empty' };

  const lastPause = [...pauses].reverse().find((p) => p.end != null && p.end >= anchor.start);
  if (lastPause) {
    // The first period after a pause restarts the arithmetic.
    return { ...base, status: 'after-pause', pause: { id: lastPause.id, since: keyOf(lastPause.start), until: keyOf(lastPause.end), reason: lastPause.reason } };
  }

  // A few cycles after a pause are less predictable.
  const afterPause = pauses.some((p) => p.end != null && p.end < anchor.start && periods.filter((x) => x.start > p.end).length <= 3);
  const effSpread = afterPause ? spread * 1.3 : spread;

  const lengthDist = cycleLengthDist(center, effSpread);
  const elapsed = today - anchor.start;
  const cycleDay = elapsed + 1;
  const periodEnd = anchor.end ?? anchor.start + periodLength - 1;
  const inPeriod = today >= anchor.start && today <= periodEnd && elapsed < CYCLE_LIMITS.maxPeriod;

  // This cycle's ovulation, if someone confirmed it.
  const confirmedOvulation = ovulations.filter((o) => o.day > anchor.start && o.day <= today).at(-1) || null;

  // Next start: conditioned on every day that passed without one.
  const lutealDist = makeDist(0, Array.from({ length: 19 }, (_, l) => (l < 7 ? 0 : normal(l, luteal, lutealSpread))));
  let next = confirmedOvulation
    ? shift(lutealDist, confirmedOvulation.day)
    : shift(lengthDist, anchor.start);
  next = notBefore(next, today);

  const expectedStart = Math.round(anchor.start + center);
  const lateBy = !inPeriod && today > quantile(shift(lengthDist, anchor.start), 0.9) ? today - expectedStart : 0;

  base.current = {
    start: keyOf(anchor.start),
    day: cycleDay,
    inPeriod,
    periodDay: inPeriod ? elapsed + 1 : null,
    periodEnd: keyOf(periodEnd),
    periodEndLogged: anchor.end != null,
    lateBy,
    confirmedOvulation: confirmedOvulation ? keyOf(confirmedOvulation.day) : null,
    nextLikely: keyOf(quantile(next, 0.5)),
    nextRange: [keyOf(quantile(next, 0.15)), keyOf(quantile(next, 0.85))],
  };

  // ---- forecasts
  const fc = base.forecasts;
  const reversedLuteal = { from: -(lutealDist.from + lutealDist.p.length - 1), p: [...lutealDist.p].reverse() };

  // The rest of a period that is running and has no logged end.
  if (anchor.end == null && today - anchor.start < periodLength) {
    if (periodLength > 1) {
      fc.push({
        kind: 'period-ongoing',
        cycle: 0,
        start: keyOf(anchor.start + 1),
        end: keyOf(anchor.start + periodLength - 1),
        likely: keyOf(anchor.start),
        prob: 1,
      });
    }
  }

  let startDist = next;
  let prevStart = anchor.start;
  for (let k = 1; k <= 16; k++) {
    // Fertile window and ovulation of the cycle that ends with startDist.
    const ovDist = k === 1 && confirmedOvulation
      ? { from: confirmedOvulation.day, p: [1] }
      : convolve(startDist, reversedLuteal);
    const ovLikely = quantile(ovDist, 0.5);
    // Fertile on day x: ovulation on x … x+5 (the five days before and the day itself).
    const fertile = confidentRun(
      (x) => windowProb(ovDist, x + 5, 6),
      quantile(ovDist, 0.02) - 5,
      quantile(ovDist, 0.98),
    );
    if (ovLikely > prevStart + 5) {
      fc.push({
        kind: 'fertile',
        cycle: k,
        start: keyOf(Math.max(fertile.start, prevStart + 1)),
        end: keyOf(fertile.end),
        likely: keyOf(ovLikely),
        prob: Math.round(Math.min(1, fertile.peak) * 100) / 100,
        confirmed: k === 1 && !!confirmedOvulation,
      });
      if (!(k === 1 && confirmedOvulation)) {
        fc.push({
          kind: 'ovulation',
          cycle: k,
          start: keyOf(ovLikely),
          end: keyOf(ovLikely),
          likely: keyOf(ovLikely),
          range: [keyOf(quantile(ovDist, 0.15)), keyOf(quantile(ovDist, 0.85))],
          prob: Math.round(probAt(ovDist, ovLikely) * 100) / 100,
        });
      }
    }

    const likely = quantile(startDist, 0.5);
    // Bleeding on day x: the period started within the last periodLength days.
    const bar = confidentRun(
      (x) => windowProb(startDist, x, periodLength),
      quantile(startDist, 0.02),
      quantile(startDist, 0.98) + periodLength - 1,
    );
    const from = bar.start;
    const peak = bar.peak;
    fc.push({
      kind: 'period',
      cycle: k,
      start: keyOf(bar.start),
      end: keyOf(bar.end),
      likely: keyOf(likely),
      range: [keyOf(quantile(startDist, 0.15)), keyOf(quantile(startDist, 0.85))],
      wide: [keyOf(quantile(startDist, 0.05)), keyOf(quantile(startDist, 0.95))],
      prob: Math.round(peak * 100) / 100,
    });

    if (from > horizon) break;
    prevStart = likely;
    startDist = convolve(startDist, lengthDist);
  }

  return { ...base, status: used.length ? 'tracking' : 'learning' };
}

/** Forecasts overlapping [fromKey, toKey] (inclusive keys). */
export function forecastsInRange(analysis, fromKey, toKey) {
  const a = dayOf(fromKey);
  const b = dayOf(toKey);
  return (analysis?.forecasts || []).filter((f) => dayOf(f.end) >= a && dayOf(f.start) <= b);
}

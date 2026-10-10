// ============================================================
// YANTA Pulse — suggested starter routines
//
// Seeded as normal skill notes so they are readable, editable and
// deletable like anything the user or the AI writes later. They are
// seeded **disabled**: background runs spend real AI budget, and
// nothing should start spending it before someone said yes.
//
// Settings → Pulse presents them as one-tap suggestions.
// ============================================================

import { getRoutine, patchPulseBlock } from './pulse-routines.js';
import { skillManageAction } from '../ai/skills.js';
import { writeBrainNote } from '../ai/brain.js';

const SEEDED_KEY = 'yanta.pulse.starters.seeded.v1';

export const STARTER_ROUTINES = [
  {
    name: 'morning-brief',
    markdown: `---
name: morning-brief
description: A short weekday overview before the day starts
version: 1.1.0
metadata:
  yanta:
    category: pulse
pulse:
  enabled: false
  when: "0 7 * * 1-5"
  on: [calendar-soon]
  output: [inbox, journal]
  tools: read
  cooldown: 8h
  maxPerDay: 1
---

# morning-brief

## Goal

Give the user a calm, honest picture of the day in the time it takes to drink the first coffee.

## Procedure

1. Call \`search_events\` with range "today" to get the day's calendar.
2. Call \`rss_search_items\` with unreadOnly=true, limit 20, to see what arrived overnight.
3. Find what changes how the day should go: the first appointment, overlaps, a tight gap, a deadline, a free afternoon worth protecting.
4. From the feeds take at most two items, and only ones that need attention today (a security issue, a disruption, something the user's notes show they follow). General news belongs in the feed digest, not here.
5. Call \`pulse_emit\` with a headline naming the shape of the day and a body of at most five short lines, calendar first.

## Stay silent when

- There are no events and nothing unread that needs attention today.
- The day is unremarkable and the brief would just restate an empty calendar.
`,
  },

  {
    name: 'loose-ends',
    markdown: `---
name: loose-ends
description: Weekly sweep for things that were started and quietly dropped
version: 1.1.0
metadata:
  yanta:
    category: pulse
pulse:
  enabled: false
  when: "0 17 * * 5"
  output: [inbox]
  tools: read
  cooldown: 3d
  maxPerDay: 1
---

# loose-ends

## Goal

Surface work that was begun and abandoned, before it turns into a pile the user avoids looking at.

## Procedure

1. Call \`search_notes\` with an empty query and limit 30 to get the most recently edited notes, then \`read_notes\` on the ones edited in the last 30 days. Skip Pulse logs, AI Brain notes and plain lists like shopping lists.
2. In them, look for: open questions and undecided choices, TODOs, deadlines in the next weeks, and drafts that stop mid-sentence.
3. Call \`search_events\` for the past 7 days. For meetings and workshops, check with \`search_notes\` (the event's key words) whether any note records the outcome; a meeting without one is a loose end.
4. Pick at most five items. Prefer the ones with a date coming up, or that are cheap to finish, or expensive to forget.
5. Call \`pulse_emit\` with one line per item: what it is, the smallest next step, and the date if there is one.

## Stay silent when

- Fewer than two genuine loose ends are found.
- The same items were already reported in the last run and nothing moved.
`,
  },

  {
    name: 'feed-digest',
    markdown: `---
name: feed-digest
description: Groups new unread articles into one digest instead of many alerts
version: 1.1.0
metadata:
  yanta:
    category: pulse
pulse:
  enabled: false
  on: [rss-new]
  output: [inbox]
  tools: read
  cooldown: 6h
  maxPerDay: 2
---

# feed-digest

## Goal

Turn a stream of unread articles into one thing worth reading, so the feed never becomes a second inbox.

## Procedure

1. Call \`rss_search_items\` with unreadOnly=true, limit 30.
2. Group the items by topic, not by source; several articles on one story are one topic.
3. Keep at most five topics, the ones the user is most likely to act on or talk about. Leave out sports results, gossip and routine product news unless the user's notes show they follow it.
4. Call \`pulse_emit\` with one line per topic, most important first: what happened, in one sentence, with its citation. No intro, no "if you read only one", no list of what was left out.

## Stay silent when

- Fewer than three new unread items exist.
- Everything new is routine coverage with nothing the user would act on.
`,
  },
];

/*
  Earlier versions of the starters, by a hash of their text with the
  enabled flag normalised. A seeded starter that still matches one was
  never edited, so it moves to the current version (keeping on/off);
  one the user changed is left alone.
*/
const FORMER_STARTERS = {
  'morning-brief': new Set(['im1wru']),
  'loose-ends': new Set(['85we1g']),
  'feed-digest': new Set(['18v85m']),
};

function starterHash(markdown) {
  const text = String(markdown || '')
    .replace(/^(\s+enabled\s*:\s*)(true|false)\s*$/m, '$1false')
    .trim();

  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36);
}

/** Brings untouched seeded starters up to the current version. */
export async function upgradeStarterRoutines() {
  let upgraded = 0;

  for (const starter of STARTER_ROUTINES) {
    const routine = await getRoutine(starter.name);
    if (!routine?.noteId) continue;
    if (!FORMER_STARTERS[starter.name]?.has(starterHash(routine.markdown))) continue;

    try {
      await writeBrainNote({
        noteId: routine.noteId,
        body: patchPulseBlock(starter.markdown, 'enabled', routine.enabled ? 'true' : 'false'),
        mode: 'replace',
        target: 'skill',
      });
      upgraded++;
    } catch (err) {
      console.warn('[YANTA Pulse] starter upgrade failed', starter.name, err);
    }
  }

  if (upgraded) {
    window.dispatchEvent(new CustomEvent('yanta-pulse-routines-changed', {
      detail: { upgraded },
    }));
  }

  return upgraded;
}

/** Grace period for a first sync to deliver routines another device seeded. */
const HYDRATION_TIMEOUT_MS = 20_000;

/**
 * Resolves once the vault has hydrated, or after a grace period when no
 * sync is configured and the event will never come.
 */
function vaultHydrated() {
  return new Promise((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('yanta-vault-hydrated', finish);
      resolve();
    };

    window.addEventListener('yanta-vault-hydrated', finish);
    window.setTimeout(finish, HYDRATION_TIMEOUT_MS);
  });
}

/**
 * Creates any starter routine the user does not already have.
 *
 * Waits for hydration first: seeding before the vault arrives makes a
 * second device create its own copy of every starter, which then shows
 * up twice and cannot be toggled (the switch reaches only one copy).
 * The seeded marker is device-local, so the name check is what actually
 * prevents duplicates — and deleting a starter keeps it deleted.
 */
export async function ensureStarterRoutines() {
  const { store } = await import('../core.js');

  if (await store.settings.get(SEEDED_KEY, false).catch(() => false)) {
    await vaultHydrated();
    await upgradeStarterRoutines();
    return;
  }

  await vaultHydrated();

  let created = 0;

  for (const starter of STARTER_ROUTINES) {
    if (await getRoutine(starter.name)) continue;

    try {
      await skillManageAction({
        action: 'create',
        name: starter.name,
        content: starter.markdown,
      });

      created++;
    } catch (err) {
      console.warn('[YANTA Pulse] starter seed failed', starter.name, err);
    }
  }

  await store.settings.set(SEEDED_KEY, true);

  if (created) {
    window.dispatchEvent(new CustomEvent('yanta-pulse-routines-changed', {
      detail: { seeded: created },
    }));
  }
}

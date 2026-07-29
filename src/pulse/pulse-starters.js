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

import { getRoutine } from './pulse-routines.js';
import { skillManageAction } from '../ai/skills.js';

const SEEDED_KEY = 'yanta.pulse.starters.seeded.v1';

export const STARTER_ROUTINES = [
  {
    name: 'morning-brief',
    markdown: `---
name: morning-brief
description: A short weekday overview before the day starts
version: 1.0.0
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
3. Look for the two or three things that actually change how the day should go: a first meeting earlier than usual, a conflict, a deadline, something genuinely notable in the feeds.
4. Call \`pulse_emit\` with a headline naming the shape of the day and a body of at most five short lines.

## Stay silent when

- There are no events and nothing unread.
- The day is unremarkable and the brief would just restate an empty calendar.
`,
  },

  {
    name: 'loose-ends',
    markdown: `---
name: loose-ends
description: Weekly sweep for things that were started and quietly dropped
version: 1.0.0
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

1. Use \`semantic_search_notes\` for open questions, decisions that were never made, and drafts that trail off.
2. Use \`search_events\` over the past week to find meetings that produced no note.
3. Pick at most five items. Prefer the ones that are cheap to finish or expensive to forget.
4. Call \`pulse_emit\` with a short list. For each item, one line: what it is, and the smallest next step.

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
version: 1.0.0
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
2. Group the items by topic, not by source.
3. Drop anything that is a rewrite of a story already covered by another item.
4. Call \`pulse_emit\` with one line per topic: what happened, and which item to read if the user only reads one.

## Stay silent when

- Fewer than three new unread items exist.
- Everything new is routine coverage with nothing the user would act on.
`,
  },
];

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

  if (await store.settings.get(SEEDED_KEY, false).catch(() => false)) return;

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

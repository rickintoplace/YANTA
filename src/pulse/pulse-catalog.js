// ============================================================
// YANTA Pulse — the routine catalog
//
// Ready-made routines, shipped with the app. No server, no fetch, no
// moderation queue: the curated set is code, and everything beyond it
// arrives person-to-person through a share link (pulse-library.js).
//
// Loaded lazily by the Library tab so none of this text sits in the
// boot bundle.
//
// Writing a good entry:
// - The procedure must work unattended: no questions, no assumptions
//   about what is on screen, no "ask the user".
// - Every entry needs a "Stay silent when" section. A routine that
//   cannot stay quiet is a routine that gets switched off.
// - Default to `tools: read`. Ask for more only where the routine's
//   whole point is to write.
// ============================================================

export const PULSE_CATEGORIES = Object.freeze({
  DAILY: 'daily',
  FOCUS: 'focus',
  READING: 'reading',
  CARE: 'care',
});

function entry({ name, icon, category, description, pulse, goal, procedure, silentWhen }) {
  return {
    name,
    icon,
    category,
    description,

    markdown: [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      'version: 1.0.0',
      'metadata:',
      '  yanta:',
      '    category: pulse',
      'pulse:',
      ...Object.entries(pulse).map(([key, value]) => `  ${key}: ${value}`),
      '---',
      '',
      `# ${name}`,
      '',
      '## Goal',
      '',
      goal,
      '',
      '## Procedure',
      '',
      procedure,
      '',
      '## Stay silent when',
      '',
      silentWhen,
    ].join('\n'),
  };
}

export const PULSE_CATALOG = [
  entry({
    name: 'evening-close',
    icon: 'moon',
    category: PULSE_CATEGORIES.DAILY,
    description: 'Closes the day: what happened, and the one thing waiting tomorrow',
    pulse: {
      enabled: false,
      when: '"0 18 * * 1-5"',
      output: '[inbox, journal]',
      tools: 'read',
      cooldown: '8h',
      maxPerDay: '1',
    },
    goal: 'Let the user stop thinking about work by showing that nothing important is unaccounted for.',
    procedure: [
      '1. Call `search_events` for today to see what actually happened.',
      '2. Use `semantic_search_notes` for notes touched today that end mid-thought.',
      '3. Name at most three things that moved, and exactly one thing that needs them tomorrow.',
      '4. Call `pulse_emit`. Keep it under five lines. End with the single next action.',
    ].join('\n'),
    silentWhen: [
      '- Nothing happened today worth restating.',
      '- The only "next action" would be generic advice.',
    ].join('\n'),
  }),

  entry({
    name: 'meeting-prep',
    icon: 'users',
    category: PULSE_CATEGORIES.FOCUS,
    description: 'Pulls together what you already know before a meeting starts',
    pulse: {
      enabled: false,
      on: '[calendar-soon]',
      output: '[inbox]',
      tools: 'read',
      cooldown: '30m',
      maxPerDay: '6',
    },
    goal: 'Walk into the meeting already holding the context, instead of searching for it during the first five minutes.',
    procedure: [
      '1. Call `search_events` with range "today" and find the event starting soonest.',
      '2. Use `semantic_search_notes` on its title and attendees for related notes and past decisions.',
      '3. If the attendees appear in chats, use `chat_search_messages` for the last relevant exchange.',
      '4. Call `pulse_emit`: what this is about, what was decided last time, and any open question.',
      '5. Reference concrete notes with {{note:NOTE_ID}} so they are one tap away.',
    ].join('\n'),
    silentWhen: [
      '- No event starts within the hour.',
      '- Nothing relevant exists beyond the calendar entry itself — restating the invite helps nobody.',
    ].join('\n'),
  }),

  entry({
    name: 'weekly-review',
    icon: 'calendar-check',
    category: PULSE_CATEGORIES.FOCUS,
    description: 'A short, honest Friday summary of the week',
    pulse: {
      enabled: false,
      when: '"0 16 * * 5"',
      output: '[inbox, journal]',
      tools: 'read',
      cooldown: '3d',
      maxPerDay: '1',
    },
    goal: 'Give the week a shape the user can remember, and make the next one easier to start.',
    procedure: [
      '1. Call `search_events` for the past week.',
      '2. Use `semantic_search_notes` for what was created or changed in that period.',
      '3. Group into: what got finished, what moved, what stalled.',
      '4. Call `pulse_emit` with those three groups, at most three lines each.',
      '5. Be honest about the stalled group. A review that only lists wins is not useful.',
    ].join('\n'),
    silentWhen: [
      '- The week holds fewer than three notable items.',
    ].join('\n'),
  }),

  entry({
    name: 'reading-queue',
    icon: 'book-open',
    category: PULSE_CATEGORIES.READING,
    description: 'Saves the few unread articles actually worth your time as a note',
    pulse: {
      enabled: false,
      on: '[rss-new]',
      output: '[inbox]',
      tools: 'write',
      cooldown: '12h',
      maxPerDay: '1',
    },
    goal: 'Turn an endless feed into a short, deliberate reading list.',
    procedure: [
      '1. Call `rss_search_items` with unreadOnly=true, limit 40.',
      '2. Judge against the interests recorded in the AI Brain user profile — read it with `ai_brain_read` first.',
      '3. Pick at most five. Prefer depth over novelty; drop anything that is coverage of coverage.',
      '4. Save them with `rss_save_item_as_note` into one reading note.',
      '5. Call `pulse_emit` with one line per item saying why it made the cut.',
    ].join('\n'),
    silentWhen: [
      '- Fewer than five unread items exist.',
      '- Nothing clears the bar. An empty reading list is a valid outcome.',
    ].join('\n'),
  }),

  entry({
    name: 'birthday-watch',
    icon: 'cake',
    category: PULSE_CATEGORIES.CARE,
    description: 'Reminds you a few days early, while there is still time to act',
    pulse: {
      enabled: false,
      when: '"0 9 * * *"',
      output: '[inbox]',
      tools: 'read',
      cooldown: '20h',
      maxPerDay: '1',
    },
    goal: 'Catch the birthday while a card can still arrive, not on the morning of.',
    procedure: [
      '1. Call `search_events` for the next seven days.',
      '2. Keep entries that are birthdays or anniversaries.',
      '3. For each person, use `semantic_search_notes` for anything you know about them.',
      '4. Call `pulse_emit` with the date, the person, and one concrete idea grounded in those notes.',
      '5. If a message would be the right move, use `pulse_propose` with `chat_send_message` and a draft — never send it yourself.',
    ].join('\n'),
    silentWhen: [
      '- Nothing is coming up in the next seven days.',
      '- The same occasion was already reported this week.',
    ].join('\n'),
  }),

  entry({
    name: 'note-gardener',
    icon: 'sprout',
    category: PULSE_CATEGORIES.CARE,
    description: 'Finds notes that drifted apart and suggests where they belong',
    pulse: {
      enabled: false,
      when: '"0 11 * * 0"',
      output: '[inbox]',
      tools: 'read',
      cooldown: '5d',
      maxPerDay: '1',
    },
    goal: 'Keep the workspace from silently turning into a pile, without reorganising anything behind the user\'s back.',
    procedure: [
      '1. Use `semantic_search_notes` to find clusters of notes that clearly belong together but sit apart.',
      '2. Look for untitled notes, notes with no links, and near-duplicates.',
      '3. Pick at most four concrete suggestions.',
      '4. Call `pulse_emit` with each suggestion as one line: what you found, what you would do.',
      '5. Suggest. Do not reorganise — the user decides what their structure means.',
    ].join('\n'),
    silentWhen: [
      '- Fewer than four genuine suggestions exist.',
      '- The workspace is small enough that structure is not yet a problem.',
    ].join('\n'),
  }),
];

/** Catalog entries the user does not already have, newest interest first. */
export function catalogFor(installedNames = new Set()) {
  return PULSE_CATALOG.map((item) => ({
    ...item,
    installed: installedNames.has(item.name),
  }));
}

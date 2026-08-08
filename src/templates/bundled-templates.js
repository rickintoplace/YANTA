/*
  The templates YANTA ships with.

  Two rules held the selection down to nine:

  1. Every one produces something USABLE on the first click. The IKEA-effect
     research (Norton, Mochon & Ariely, JCP 2012) found that self-made things
     are valued more highly only when the task is actually completed — a
     half-filled scaffold that leaves the user staring at placeholders is the
     failure case, not a lighter version of the success case. So these carry
     real prompts and real structure, and where a date belongs, a date appears.

  2. They are plain markdown notes with a `template:` block. No registry, no
     schema, no migration path to maintain — see template-format.js.

  Three niches, deliberately the three with the clearest willingness to pay,
  and all three lean on the notes-plus-calendar link that is YANTA's wedge.
*/

export const BUNDLED_TEMPLATES = [
  {
    id: 'client-call',
    markdown: `---
template:
  name: Client conversation
  description: A first call captured so the follow-up writes itself
  category: freelance
---

# Client conversation — {{date}}

**Who** ·
**What they asked for** ·

## What they actually need

_The stated request and the real problem are rarely the same sentence. Write the second one here._

## Constraints they named

- Budget:
- Deadline:
- Who else decides:

## What I said I would do

- [ ]
- [ ]

## What I did not promise

_Worth writing down while it is fresh._

## Next step

- [ ] Follow up by
`,
  },

  {
    id: 'proposal',
    markdown: `---
template:
  name: Proposal
  description: Scope, price and the boundary — on one page
  category: freelance
---

# Proposal — {{date}}

**For** ·
**Valid until** ·

## The problem in their words

## What I will deliver

1.
2.
3.

## What is not included

_The most valuable section. Everything you leave out here, you do for free later._

-

## Price and terms

| | |
| --- | --- |
| Fee | |
| Payment | |
| Start | |
| Delivery | |

## Assumptions this rests on

-
`,
  },

  {
    id: 'week-review',
    markdown: `---
template:
  name: Weekly review
  description: Twenty minutes that make the next week cheaper
  category: freelance
---

# Week in review — {{date}}

## Shipped

-

## Did not ship, and why

-

## Where the time actually went

_Compare with the calendar before writing this. The gap is the finding._

## One thing to stop

## One thing to keep

## Next week's single priority
`,
  },

  {
    id: 'lesson-plan',
    markdown: `---
template:
  name: Lesson plan
  description: One session, timed, with the fallback already thought through
  category: teaching
---

# Lesson — {{date}} ({{weekday}})

**Group** ·
**Topic** ·

## They should leave being able to

1.
2.

## Timing

| Min | What | Who is doing something |
| --- | --- | --- |
| 0–5 | Arrival, hook | |
| 5–20 | | |
| 20–40 | | |
| 40–45 | Close, what carries over | |

## Material needed

- [ ]

## If it runs short

## If it runs long

_Which part gets cut — decide now, not at minute 42._

## Afterwards

_What actually happened. Write two lines before you leave the room._
`,
  },

  {
    id: 'course-notes',
    markdown: `---
template:
  name: Course session notes
  description: A running record of one course, session by session
  category: teaching
---

# Session — {{date}}

**Course** ·
**Session number** ·

## Covered

## What they struggled with

_This is the section next term's version of this course is built from._

## Questions I could not answer

- [ ]

## For next time

- [ ]
`,
  },

  {
    id: 'literature-note',
    markdown: `---
template:
  name: Literature note
  description: One source, read so you never have to read it twice
  category: research
---

# {{date}} —

**Authors** ·
**Year** ·
**Where it appeared** ·
**Link / DOI** ·

## The claim, in one sentence

_If it takes more than one sentence, you have not finished reading._

## How they show it

**Method** ·
**Sample / data** ·

## What would have to be true for this to hold

## Where it disagrees with what I already have

_Link the other notes here — this is where a literature review comes from._

## Quotes worth keeping

>

## My use for it
`,
  },

  {
    id: 'supervision',
    markdown: `---
template:
  name: Supervision meeting
  description: Prepared before, decided during, actionable after
  category: research
---

# Supervision — {{date}}

## Since last time

-

## Where I am stuck

_Name it precisely. Vague stuckness gets vague advice._

## What I need a decision on

1.
2.

## Agreed

## Explicitly not agreed

## Before the next meeting

- [ ]
- [ ] Book next meeting
`,
  },

  {
    id: 'decision',
    markdown: `---
template:
  name: Decision record
  description: Why you chose this, written for the version of you that forgets
  category: personal
---

# Decision — {{date}}

## What is being decided

## Options considered

| Option | For | Against |
| --- | --- | --- |
| | | |
| | | |

## Chosen

## Why, in one sentence

## What would make this the wrong call

_Write it now, while you can still be honest about it._

## Revisit on

`,
  },

  {
    id: 'trip',
    markdown: `---
template:
  name: Trip
  description: Everything about one trip in one place, offline
  category: personal
---

# Trip — {{date}}

**Where** ·
**When** ·

## Getting there

| | Time | Reference |
| --- | --- | --- |
| Out | | |
| Back | | |

## Staying

## Packed

- [ ] Documents
- [ ]

## Worth doing

-

## Notes from the trip

_This page works with no signal — that is rather the point._
`,
  },
];

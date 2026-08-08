/*
  The templates YANTA ships with.

  Three rules, all learned the hard way:

  1. **Filled, not blank.** A page of headings over empty dashes is a chore
     handed to someone who came here to get something done. The IKEA-effect
     research (Norton, Mochon & Ariely, JCP 2012) found self-made things are
     valued more highly ONLY when the task is actually completed — an unfilled
     scaffold is the failure case. So every template arrives with real example
     content: something to react to, edit and delete, never a blank to invent.

  2. **A felt benefit in the first ten seconds.** Not "here is a structure for
     meeting notes" but "send this and everyone knows where to be, with the
     date already in their calendar".

  3. **More than text where text is not the point.** A template may carry a
     linked calendar event (`event`), so the page and the date arrive together
     — and because the public-share publisher packs a note's linked events, a
     template like the invitation becomes something you can actually send.

  Placeholders: {{date}}, {{time}}, {{weekday}} — see template-format.js.
*/

export const BUNDLED_TEMPLATES = [
  {
    id: 'invitation',
    /*
      The flagship. It exists to be SHARED: publish it, and the recipient gets
      the whole thing — what, when, where, what to bring — plus one button that
      puts it in their calendar and a map link that opens where they are going.
      No account needed on their side.
    */
    event: {
      title: 'Dinner at ours',
      inDays: 10,
      startHour: 19,
      durationMinutes: 210,
      location: 'Oranienstraße 12, 10999 Berlin',
      icon: 'party-popper',
    },
    markdown: `---
template:
  name: An invitation you can send
  description: Everything a guest needs — and the date lands in their calendar
  category: invite
---

# Dinner at ours 🍷

You are invited. Nothing formal, just good food and people we like.

**When** · {{weekday}}, from 19:00 — come whenever, we eat around 20:00
**Where** · Oranienstraße 12, 10999 Berlin — second floor, ring "Weber"
**Getting there** · U8 Kottbusser Tor, four minutes on foot

## What there will be

Slow-cooked ragù, something green, and far too much bread. Wine is taken care of.

## If you want to bring something

Dessert would make someone very happy. Otherwise just yourself.

## Good to know

- There is a friendly dog. She will find you.
- Two of us are vegetarian, so there is always a proper second option.
- Tell us about allergies and we will simply cook around them.

---

*Sent from a page, not an app store. The button above puts this in your calendar — no account, nothing to install.*
`,
  },

  {
    id: 'meetup',
    event: {
      title: 'Coffee & catch-up',
      inDays: 4,
      startHour: 10,
      durationMinutes: 90,
      location: 'Café Kranzler, Kurfürstendamm 18, Berlin',
      icon: 'coffee',
    },
    markdown: `---
template:
  name: Let's meet — with the details settled
  description: One page that ends the "where were we meeting again?" thread
  category: invite
---

# Coffee & catch-up ☕

**When** · {{weekday}}, 10:00
**Where** · Café Kranzler, Kurfürstendamm 18 — upstairs, by the window
**How long** · An hour and a half, give or take

## What I wanted to talk about

- How the new job is actually going, not the version you put on LinkedIn
- That idea you mentioned in spring — I have been thinking about it
- Nothing else. This is not a working meeting.

## If something comes up

Just write. Moving it is easier than making it awkward.
`,
  },

  {
    id: 'client-call',
    markdown: `---
template:
  name: Client call, captured
  description: Ends with a follow-up that writes itself
  category: freelance
---

# Client call — {{date}}

**Who** · Maria Sandberg, Head of Ops at Nordwind
**What they asked for** · "Something like a dashboard, by the end of the quarter"

## What they actually need

They do not need a dashboard. They need to stop pulling three exports every
Monday morning to answer one question their CEO asks. Say that back to them
next time — it is the sentence that wins the project.

## Constraints they named

- **Budget** · "under 15k, otherwise it needs board sign-off"
- **Deadline** · End of Q3, because of the annual report
- **Who else decides** · Their CTO, who has not been in the room yet

## What I said I would do

- [x] Send a written scope by Friday
- [ ] Ask for read access to the reporting database
- [ ] Get the CTO into the next call — nothing moves without them

## What I did not promise

Anything about the mobile version. They will ask. It is a second project.

## Follow-up

- [ ] Write on Friday, referencing "three exports every Monday" — their words
`,
  },

  {
    id: 'proposal',
    markdown: `---
template:
  name: Proposal that protects you
  description: Scope, price, and the boundary that saves the project
  category: freelance
---

# Proposal — {{date}}

**For** · Nordwind GmbH, attn. Maria Sandberg
**Valid until** · Three weeks from today

## The problem, in their words

"Every Monday somebody spends half a day pulling exports so we can answer one
question." Quoting them back is not a formality — it is how they know you
listened.

## What I will deliver

1. One live view that answers the Monday question, no exports involved
2. Automatic refresh each night, and an alert when it fails
3. A half-day handover so your team can change it without me

## What is not included

*The most valuable section on this page. Everything missing here you will end up
doing for free.*

- A mobile version
- Access rights per department
- Anything about the 2019 archive data

## Price and terms

| | |
| --- | --- |
| Fee | 12,400 € plus VAT |
| Payment | 40% at start, 60% on handover |
| Start | Two weeks after signature |
| Delivery | Six weeks from start |

## What this rests on

Read access to the reporting database by week one. Every week that arrives late,
delivery moves by a week — no drama, just arithmetic.
`,
  },

  {
    id: 'week-review',
    markdown: `---
template:
  name: The twenty minutes that pay for themselves
  description: A weekly review that finds where the time actually went
  category: freelance
---

# Week in review — {{date}}

## What actually shipped

- Sent the Nordwind scope. It is out of my hands and that feels good.

## What did not, and the honest reason

- The tax folder. Not because there was no time — because I do not want to.
  Writing that down is the point of this page.

## Where the time really went

*Open the calendar next to this before you write. The gap between what you
remember and what is in there is the whole finding.*

Three hours of calls that could have been two messages. Again.

## One thing to stop

Saying yes to calls before knowing what they are about.

## One thing worth keeping

Mornings before ten stayed unbooked all week, and everything difficult got done
in them.

## Next week, the one thing that matters

Get the CTO into the Nordwind call.
`,
  },

  {
    id: 'lesson-plan',
    markdown: `---
template:
  name: A lesson that survives contact
  description: Timed, with the fallback already decided
  category: teaching
---

# Lesson — {{date}} ({{weekday}})

**Group** · Year 9, 24 students
**Topic** · Why the seasons are not about distance to the sun

## They should leave able to

1. Explain seasons using axial tilt, without saying "closer" or "further"
2. Predict which hemisphere has summer, given a diagram

## Timing

| Min | What happens | Who is doing something |
| --- | --- | --- |
| 0–5 | "Australia has Christmas in summer. Why?" — collect guesses, write them up | Them |
| 5–20 | Globe and lamp at the front, three volunteers | Three of them |
| 20–40 | In pairs: draw the tilt, predict two dates | All of them |
| 40–45 | Back to the guesses on the board — which survived? | Them |

## Needed

- [x] Globe
- [ ] Desk lamp with the shade off
- [ ] Printed diagrams, 12 copies for pairs

## If it runs short

Ask what would happen with no tilt at all. That is fifteen minutes on its own.

## If it runs long

Cut the pair drawing, keep the return to the guesses. Never cut the ending —
that is where they find out they were wrong, and that is the lesson.

## Afterwards

*Two lines before you leave the room, while it is still true.*
`,
  },

  {
    id: 'literature-note',
    markdown: `---
template:
  name: Read once, never again
  description: One source, captured so you never have to reread it
  category: research
---

# Nunes & Drèze (2006) — endowed progress

**Where** · Journal of Consumer Research 32(4), 504–512
**Link** · doi:10.1086/500480

## The claim, in one sentence

People push harder toward a goal that looks already begun than toward an
identical goal that looks not yet started.

## How they show it

**Method** · Field experiment at a car wash, plus lab replications
**Sample** · 300 loyalty cards, two conditions

Ten stamps with two given for free versus eight stamps from scratch — the same
real effort. Completion: 34% against 19%.

## What would have to be true for this to hold

That the head start reads as *progress* rather than as a discount. A card that
looks like a gift probably behaves differently.

## Where this disagrees with what I already have

It sits awkwardly next to the choice-overload literature — see [[Scheibehenne
2010]], where the effect people were certain of turned out to average zero.
Progress framing replicates; simplification does not.

## Worth quoting

> Converting a task requiring eight steps into one requiring ten, with two
> already complete, reframes it as undertaken and incomplete.

## My use for it

Onboarding: never show an empty state where a begun one is honestly available.
`,
  },

  {
    id: 'supervision',
    markdown: `---
template:
  name: Supervision, prepared
  description: Walk in with questions, walk out with decisions
  category: research
---

# Supervision — {{date}}

## Since last time

- Reworked chapter 3 around the new framing
- Read six papers, two of which matter
- Lost most of a week to a dataset that turned out to be unusable

## Where I am stuck

*Be precise. Vague stuckness gets vague advice and another lost week.*

Chapter 3 now argues two things at once and I cannot tell which one the thesis
is actually about.

## What I need a decision on today

1. Does chapter 3 become two chapters, or does one argument go?
2. Is the unusable dataset worth replacing, or do I write around it?

## Agreed

## Explicitly not agreed

*Write this down. It is the section you will be glad about in six months.*

## Before next time

- [ ]
- [ ] Book the next meeting before leaving the room
`,
  },

  {
    id: 'trip',
    event: {
      title: 'Lisbon',
      inDays: 21,
      startHour: 9,
      durationMinutes: 240,
      allDay: true,
      location: 'Lisbon, Portugal',
      icon: 'plane',
    },
    markdown: `---
template:
  name: A trip that works without signal
  description: Everything in one page, readable on a plane
  category: personal
---

# Lisbon 🇵🇹

**When** · Five days, starting {{date}}
**Staying** · Alfama, second street up from the tram

## Getting there

| | Time | Reference |
| --- | --- | --- |
| Out | 07:40, gate closes 07:10 | BA-2478 |
| Back | 19:15 | BA-2483 |

## Packed

- [x] Passport
- [x] Adapter
- [ ] The good walking shoes, not the nice ones
- [ ] Motion sickness tablets for the ferry

## Worth doing

- Time out for the market, early, before it fills up
- The tram is a tourist trap and worth it anyway — go at eight
- Miradouro da Senhora do Monte at sunset, take something to drink

## Not worth doing

The castle queue after eleven.

## Notes from the trip

*This page works with no signal at all — which is rather the point.*
`,
  },

  {
    id: 'decision',
    markdown: `---
template:
  name: Why you chose this
  description: For the version of you who forgets — in six months
  category: personal
---

# Decision — {{date}}

## What is being decided

Whether to take the Nordwind project or keep the month free for the course.

## The options

| Option | For | Against |
| --- | --- | --- |
| Take it | 12k, and they are pleasant to work with | The course slips another quarter |
| Keep it free | The course finally happens | No income in a quiet month |

## Chosen

Take it, and move the course to autumn on purpose rather than by accident.

## Why, in one sentence

Turning down paid work for something I have already postponed twice is a bet on
a version of myself that has not shown up yet.

## What would make this the wrong call

If autumn fills up the same way. Then the answer was never about this project.

## Revisit

- [ ] End of September — did the course actually happen?
`,
  },
];

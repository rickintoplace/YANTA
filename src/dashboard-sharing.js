// ============================================================
// YANTA Dashboard — sharing strip on cards
//
// A note or folder that other people can see must look different from a
// private one, without opening anything: the collaborators' faces sit on
// the bottom edge of the card, and — when somebody else touched it last —
// who that was and when.
//
// The strip is an overlay on a gradient rather than a row in the layout:
// cards are resizable and packed with previews, and a real row would eat
// content on every single card. The gradient is what keeps the faces
// readable over text, images and drawings alike.
// ============================================================

import { el, state, lucide } from './core.js';
import { t } from './i18n/index.js';
import { formatDateTime, formatList, formatTimeAgo } from './i18n/format.js';

import {
  MAIN_DOC_KEY,
  spaceContextForNote,
  spaceContextForFolder,
} from './spaces/space-session.js';

import { spacePeople, spaceLastEdit } from './spaces/space-people.js';
import { renderPeopleStack } from './spaces/people-avatars.js';

const MAX_FACES = 3;

/**
 * Which document of the space this card stands for:
 * - a shared note IS its space          -> the space's main doc
 * - a note inside a shared workspace    -> that note's own doc
 * - a folder                            -> everything in the space
 */
function activityKeyFor(item, context) {
  if (item.kind !== 'note') return '';

  const session = state.spaces.get(context.spaceId);

  return session?.sourceType === 'note' ? MAIN_DOC_KEY : item.id;
}

export function sharingForDashboardItem(item) {
  const context = item.kind === 'note'
    ? spaceContextForNote(item.id)
    : spaceContextForFolder(item.id);

  if (!context) return null;

  return {
    ...context,
    people: spacePeople(context.spaceId),
    lastEdit: spaceLastEdit(context.spaceId, activityKeyFor(item, context)),
  };
}

function roleLabel(role) {
  if (role === 'owner') return t('sharing.people.roleOwner');
  if (role === 'write') return t('sharing.people.roleWrite');

  return t('sharing.people.roleRead');
}

function peopleLabel(people) {
  const names = people.map((person) => `${person.name} (${roleLabel(person.role)})`);

  return t('sharing.people.sharedWith', { names: formatList(names) });
}

function renderPeople(people) {
  if (people.length) {
    return renderPeopleStack(people, {
      max: MAX_FACES,
      label: peopleLabel(people),
    });
  }

  // A live share nobody has been invited to yet (link only, or the
  // owner's roster has not reached this device). Still worth saying.
  const chip = el('span', {
    class: 'yanta-dash-share-chip',
    title: t('sharing.people.shared'),
  });

  chip.innerHTML = lucide('users', 12);

  return chip;
}

function renderLastEdit(lastEdit) {
  const { person, at } = lastEdit;

  const wrap = el('div', { class: 'yanta-dash-share-edit' });

  wrap.append(
    el('span', { class: 'yanta-dash-share-who' }, person.name),
    el('span', { class: 'yanta-dash-share-when' })
  );

  retimeLastEdit(wrap, person.name, at);

  return wrap;
}

/**
 * "2 min ago" ages while the dashboard stays open. Rewriting just the
 * timestamp keeps avatars (and their loaded pictures) untouched.
 */
function retimeLastEdit(wrap, name, at) {
  wrap.dataset.shareEditAt = String(at);
  wrap.title =
    t('sharing.people.editedBy', { name, when: formatTimeAgo(at) }) +
    ` · ${formatDateTime(at)}`;

  const when = wrap.querySelector('.yanta-dash-share-when');

  if (when) when.textContent = formatTimeAgo(at, { style: 'narrow' });
}

/*
  Identity of what a strip currently shows. Equal signature means the
  DOM is still correct — no rebuild, no avatar flicker, no lost picture.
*/
function stripSignature(sharing) {
  const people = sharing.people
    .map((person) => `${person.id}${person.role}${person.name}${person.avatar}`)
    .join('');

  const edit = sharing.lastEdit
    ? `${sharing.lastEdit.person.id}${sharing.lastEdit.at}`
    : '';

  return `${people}${edit}`;
}

function buildStrip(sharing) {
  const strip = el('div', {
    class: 'yanta-dash-share',
    dataset: { dashShare: '1', shareSig: stripSignature(sharing) },
  });

  strip.append(renderPeople(sharing.people));

  if (sharing.lastEdit) {
    strip.append(renderLastEdit(sharing.lastEdit));
  }

  return strip;
}

/**
 * Give a card the sharing overlay it should have right now — add, update
 * in place, or remove. Works on detached cards (initial render) and on
 * live ones (refresh), which is why it is the single entry point.
 */
export function applyDashboardSharingStrip(card, item) {
  const sharing = sharingForDashboardItem(item);
  const existing = card.querySelector(':scope > [data-dash-share]');

  if (!sharing) {
    existing?.remove();
    card.classList.remove('is-shared');

    return;
  }

  // Die Karte reserviert unten Platz, damit der Strip keine Preview-Zeile
  // verdeckt (siehe .is-shared in dashboard.css).
  card.classList.add('is-shared');

  if (existing?.dataset.shareSig === stripSignature(sharing)) {
    const edit = existing.querySelector('.yanta-dash-share-edit');

    if (edit && sharing.lastEdit) {
      retimeLastEdit(edit, sharing.lastEdit.person.name, sharing.lastEdit.at);
    }

    return;
  }

  const next = buildStrip(sharing);

  if (existing) {
    existing.replaceWith(next);
  } else {
    card.append(next);
  }
}

/**
 * Bring the strips of already-rendered cards up to date. Roster and
 * activity arrive asynchronously (first pull, chat login, a collaborator
 * typing), and a full dashboard render would throw away scroll position,
 * hydrated previews and any running animation.
 */
export function refreshDashboardSharingStrips(root) {
  if (!root) return;

  for (const card of root.querySelectorAll('.yanta-dash-card[data-kind]')) {
    const { kind, id } = card.dataset;

    if (!id || (kind !== 'note' && kind !== 'folder')) continue;

    applyDashboardSharingStrip(card, { kind, id });
  }
}

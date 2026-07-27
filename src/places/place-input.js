// ============================================================
// YANTA — Place autocomplete.
//
// Progressive enhancement of an existing text input: it stays a plain
// free-text field (a room name, a meeting URL, "at Anna's"), and only when
// the user picks a suggestion does it gain coordinates. Typing is never
// blocked on the network, and nothing forces a lookup.
//
// The one rule that keeps the data honest: editing the text detaches the
// place. Coordinates that no longer describe what is written are worse than
// no coordinates at all.
// ============================================================

import { el, lucide, toast } from '../core.js';
import { t } from '../i18n/index.js';
import { showMenu } from '../tree.js';
import { searchPlaces } from './geocode.js';
import { formatCoords, mapTargets, normalizePlace, placeText } from './place.js';

const DEBOUNCE_MS = 500;
const MIN_QUERY = 3;

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('places.copied'), 'success');
  } catch {
    toast(t('places.copyFailed'), 'error');
  }
}

function openTargetMenu(anchor, place) {
  const r = anchor.getBoundingClientRect();

  showMenu(r.left, r.bottom + 4, [
    ...mapTargets(place).map((target) => ({
      label: target.label,
      icon: target.icon,
      action: () => window.open(target.url, '_blank', 'noopener,noreferrer'),
    })),
    'hr',
    {
      label: t('places.copyAddress'),
      icon: 'copy',
      action: () => copy(placeText(place)),
    },
    {
      label: t('places.copyCoordinates'),
      icon: 'crosshair',
      action: () => copy(formatCoords(place)),
    },
  ]);
}

/**
 * Enhances `input` in place — the node itself is kept, so existing
 * `querySelector('[data-field="location"]').value` readers keep working.
 *
 * @returns {{ getPlace(): object|null, setPlace(p: object|null): void, destroy(): void }}
 */
export function attachPlaceInput(input, {
  place = null,
  countryCode = '',
  onChange = null,
} = {}) {
  let current = normalizePlace(place);
  let candidates = [];
  let active = -1;
  let timer = null;
  let controller = null;

  const wrap = el('div', { class: 'place-input' });
  input.replaceWith(wrap);

  const openBtn = el('button', {
    type: 'button',
    class: 'icon-btn place-input-open',
    title: t('places.openInMaps'),
    'aria-label': t('places.openInMaps'),
    onclick: () => current && openTargetMenu(openBtn, current),
  });
  openBtn.innerHTML = lucide('map-pin', 15);

  const list = el('div', {
    class: 'place-suggest',
    role: 'listbox',
    hidden: true,
  });

  wrap.append(input, openBtn, list);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');

  // -------- State ----------------------------------------------

  const syncChrome = () => {
    openBtn.hidden = !current;
    input.classList.toggle('has-place', !!current);
  };

  const setPlace = (next) => {
    current = normalizePlace(next);
    syncChrome();
    onChange?.(current);
  };

  const closeList = () => {
    candidates = [];
    active = -1;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
  };

  const cancelSearch = () => {
    clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };

  // -------- Suggestions ----------------------------------------

  const choose = (candidate) => {
    setPlace(candidate);

    input.value = placeText(current);
    closeList();
    input.focus();
  };

  /**
   * Flips the list above the field when there is no room below it — the
   * location field sits near the bottom of a long event form, where a
   * downward list would open past the edge of the dialog.
   */
  const positionList = () => {
    if (list.hidden) return;

    list.classList.remove('above');

    const r = input.getBoundingClientRect();
    const needed = Math.min(list.scrollHeight + 8, 268);
    const below = window.innerHeight - r.bottom;

    if (below < needed && r.top > below) list.classList.add('above');
  };

  const paintActive = () => {
    [...list.children].forEach((row, i) => {
      const on = i === active;

      row.classList.toggle('active', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  };

  const renderList = (message = '') => {
    list.replaceChildren();

    if (message) {
      list.append(el('div', { class: 'place-suggest-empty' }, message));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      positionList();
      return;
    }

    candidates.forEach((c, i) => {
      const row = el('div', {
        class: 'place-suggest-item',
        role: 'option',
        'aria-selected': 'false',
        onmousedown: (e) => {
          // mousedown, not click: blur would close the list first.
          e.preventDefault();
          choose(c);
        },
        onmouseenter: () => { active = i; paintActive(); },
      });

      const icon = el('span', { class: 'place-suggest-icon' });
      icon.innerHTML = lucide('map-pin', 14);

      row.append(
        icon,
        el('div', { class: 'place-suggest-body' },
          el('span', { class: 'place-suggest-label' }, c.label || placeText(c)),
          el('span', { class: 'place-suggest-address' }, c.address || formatCoords(c))
        )
      );

      list.append(row);
    });

    list.hidden = !candidates.length;
    input.setAttribute('aria-expanded', candidates.length ? 'true' : 'false');
    positionList();
    paintActive();
  };

  const runSearch = async (query) => {
    controller = new AbortController();

    const { signal } = controller;

    renderList(t('places.searching'));

    let results = [];

    try {
      results = await searchPlaces(query, { countryCode, limit: 6, signal });
    } catch {
      // Offline or a provider hiccup: the typed text still stands on its own.
    }

    if (signal.aborted || input.value.trim() !== query) return;

    candidates = results;
    active = -1;

    renderList(results.length ? '' : t('places.noResults'));
  };

  // -------- Events ---------------------------------------------

  const onInput = () => {
    // What is written no longer matches the pinned coordinates.
    if (current) setPlace(null);

    cancelSearch();

    const query = input.value.trim();

    if (query.length < MIN_QUERY) {
      closeList();
      return;
    }

    timer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
  };

  const onKeyDown = (e) => {
    if (list.hidden || !candidates.length) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();

      const delta = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + delta + candidates.length) % candidates.length;

      paintActive();
      return;
    }

    if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(candidates[active]);
      return;
    }

    if (e.key === 'Escape') {
      // Stop here: the surrounding modal must not close on the same key.
      e.preventDefault();
      e.stopPropagation();
      closeList();
    }
  };

  const onBlur = () => setTimeout(closeList, 120);

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);

  syncChrome();

  return {
    getPlace: () => current,
    setPlace: (next) => {
      setPlace(next);
      input.value = current ? placeText(current) : input.value;
    },
    destroy() {
      cancelSearch();
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeyDown);
      input.removeEventListener('blur', onBlur);
      wrap.replaceWith(input);
    },
  };
}

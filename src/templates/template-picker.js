/*
  Template picker.

  Lists the bundled templates plus every note in this workspace that carries a
  `template:` block — so a template someone made, or kept from a shared link,
  sits next to the built-in ones with no import step and no registry.
*/

import {
  el,
  lucide,
  state,
  store,
  uid,
  escapeHtml,
  toast,
} from '../core.js';

import { openNote } from '../notes.js';
import { renderTree } from '../tree.js';
import { getNoteDoc, noteMarkdown } from '../yjs.js';
import { countFirstNoteIfActivation } from '../metrics/funnel.js';
import { openBoundOverlay } from '../overlay-history.js';
import { yantaPrompt } from '../dialogs.js';
import { eventStartDate } from './template-event.js';

import { BUNDLED_TEMPLATES } from './bundled-templates.js';

import {
  TEMPLATE_CATEGORIES,
  parseTemplateBlock,
  templateBody,
  fillTemplatePlaceholders,
} from './template-format.js';

let cssInjected = false;

function injectCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-template-picker-css';
  style.textContent = `
.yanta-tpl-groups { display: grid; gap: 22px; }

.yanta-tpl-group-title {
  display: flex;
  align-items: center;
  gap: 7px;

  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--text-faint);
  margin-bottom: 9px;
}

.yanta-tpl-group-title svg { flex: none; }

.yanta-tpl-card-meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  margin-top: 3px;
  font-size: 11.5px;
  color: var(--accent);
}

.yanta-tpl-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.yanta-tpl-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  align-items: flex-start;

  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg-elev);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.yanta-tpl-card:hover {
  border-color: var(--accent);
  background: var(--bg-elev-2);
}

.yanta-tpl-card-name { font-weight: 600; }

.yanta-tpl-card-desc {
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.45;
}

.yanta-tpl-card-badge {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-faint);
}
  `;

  document.head.appendChild(style);
}

/**
 * Every template available here: bundled first, then the ones living as notes
 * in this workspace.
 */
export function listTemplates() {
  const out = [];

  for (const tpl of BUNDLED_TEMPLATES) {
    const meta = parseTemplateBlock(tpl.markdown);
    if (!meta) continue;

    out.push({
      key: `bundled:${tpl.id}`,
      meta,
      markdown: tpl.markdown,
      event: tpl.event || null,
      slides: !!tpl.slides,
      own: false,
    });
  }

  for (const note of state.notes.values()) {
    if (note?.trashed) continue;

    let markdown = '';
    try {
      markdown = noteMarkdown(note.id) || '';
    } catch {
      continue;
    }

    const meta = parseTemplateBlock(markdown);
    if (!meta) continue;

    out.push({
      key: `note:${note.id}`,
      meta,
      markdown,
      event: null,
      slides: false,
      own: true,
    });
  }

  return out;
}

/**
 * Creates a note from a template and opens it. The `template:` block stays
 * behind — it describes the template, not the note it produces.
 */
export async function createNoteFromTemplate(entry) {
  const notesBefore = state.notes.size;

  /*
    Placeholders resolve against the template's OWN date when it carries one.
    Otherwise an invitation reads "Saturday" in the text while its calendar
    entry says Tuesday — which is exactly the kind of mistake that makes the
    person who sent it look careless.
  */
  const placeholderBase = entry.event
    ? eventStartDate(entry.event)
    : new Date();

  const body = fillTemplatePlaceholders(templateBody(entry.markdown), placeholderBase);
  const id = uid();
  const now = Date.now();

  const note = {
    id,
    title: entry.meta.name,
    type: 'markdown',
    folderId: state.notes.get(state.currentNoteId)?.folderId || null,
    tags: [],
    pinned: false,
    created: now,
    updated: now,
  };

  state.notes.set(id, note);
  await store.notes.put(note);

  const doc = getNoteDoc(id);
  await doc.ready;

  const ytext = doc.doc.getText('markdown');
  if (ytext.length === 0) ytext.insert(0, body);

  countFirstNoteIfActivation(notesBefore, state.notes.size);

  /*
    A template may bring a date with it. The event is linked to the note, which
    is what makes a template like the invitation shareable: the public-share
    publisher packs a note's linked events, so the recipient gets the page AND
    a working "add to calendar" — with the location and its map links — without
    an account or an install.

    Times are relative to today so a template is never dated in the past.
  */
  if (entry.event) {
    const { createCalendarEventFromTemplate } = await import('./template-event.js');
    await createCalendarEventFromTemplate(entry.event, id);
  }

  /*
    A slide template builds its board first, then embeds it — the draw:// line
    has to name a drawing that already exists, or the editor renders a
    placeholder for something it cannot find.
  */
  if (entry.slides) {
    const { buildSlideDeck, attachSlideFrames } = await import('./template-slides.js');

    const drawingId = buildSlideDeck(id, {
      dateLabel: placeholderBase.toLocaleDateString(),
    });

    await attachSlideFrames(id, drawingId);

    ytext.insert(ytext.length, `\n\ndraw://${drawingId}\n`);
  }

  try {
    await window.yantaSync2?.engine?.observeNote?.(id);
  } catch {}

  await openNote(id);
  renderTree();

  return id;
}

/*
  Turns the current note into a template by writing a `template:` block into
  its frontmatter.

  That single step is all "stage 2" needs: a template is a note, so publishing
  one as a public share already shares it, and "Keep this note" on the other
  side already adopts it — at which point it shows up in this picker under
  "Yours". No registry, no moderation queue, no server-side storage, and
  nothing that could rot when the note model changes.
*/
export async function turnCurrentNoteIntoTemplate() {
  const note = state.notes.get(state.currentNoteId);

  if (!note) {
    toast('Open a note first.', 'error');
    return;
  }

  const doc = getNoteDoc(note.id);
  await doc.ready;

  const ytext = doc.doc.getText('markdown');
  const markdown = ytext.toString();

  if (parseTemplateBlock(markdown)) {
    toast('This note is already a template.', 'info');
    return;
  }

  const name = await yantaPrompt({
    title: 'Make this a template',
    message: 'It will appear under “Start from a template”, and you can share it like any other note.',
    label: 'Template name',
    initial: note.title || 'My template',
    confirmLabel: 'Make template',
  });

  if (name === null) return;

  const clean = String(name || '').trim() || note.title || 'My template';

  const description = await yantaPrompt({
    title: 'One line about it',
    label: 'Description (optional)',
    initial: '',
    confirmLabel: 'Done',
  });

  if (description === null) return;

  const block = [
    '---',
    'template:',
    `  name: ${clean.replace(/\n/g, ' ')}`,
    ...(String(description || '').trim()
      ? [`  description: ${String(description).trim().replace(/\n/g, ' ')}`]
      : []),
    '  category: personal',
    '---',
    '',
  ].join('\n');

  /*
    An existing frontmatter block is left alone and the template block is
    prepended as its own — merging two frontmatter blocks by hand is how
    notes get corrupted, and the reader only needs to find `template:`.
  */
  ytext.insert(0, block);

  note.updated = Date.now();
  await store.notes.put(note);

  toast('Saved as a template.', 'success');
}

export function openTemplatePicker() {
  injectCss();

  const templates = listTemplates();

  const groups = TEMPLATE_CATEGORIES.map((cat) => ({
    ...cat,
    items: templates.filter((tpl) => tpl.meta.category === cat.id),
  })).filter((group) => group.items.length);

  // Anything with an unknown category still has to be reachable.
  const known = new Set(TEMPLATE_CATEGORIES.map((c) => c.id));
  const rest = templates.filter((tpl) => !known.has(tpl.meta.category));
  if (rest.length) groups.push({ id: 'other', label: 'Other', items: rest });

  const overlay = el('div', { class: 'modal' });

  overlay.innerHTML = `
    <div class="modal-card" style="width:min(760px,94vw);max-height:84vh">
      <header class="modal-head">
        <h3>Start from a template</h3>
        <button class="icon-btn" data-tpl-close type="button">&times;</button>
      </header>

      <div class="modal-body">
        <div class="yanta-tpl-groups">
          ${groups.map((group) => `
            <section>
              <div class="yanta-tpl-group-title">
                ${lucide(group.icon || 'square', 14)}
                <span>${escapeHtml(group.label)}</span>
              </div>
              <div class="yanta-tpl-grid">
                ${group.items.map((tpl) => `
                  <button class="yanta-tpl-card" type="button" data-tpl-key="${escapeHtml(tpl.key)}">
                    <span class="yanta-tpl-card-name">${escapeHtml(tpl.meta.name)}</span>
                    ${tpl.meta.description
                      ? `<span class="yanta-tpl-card-desc">${escapeHtml(tpl.meta.description)}</span>`
                      : ''}
                    ${tpl.event
                      ? `<span class="yanta-tpl-card-meta">${lucide('calendar-plus', 12)}<span>Brings a date with it</span></span>`
                      : ''}
                    ${tpl.slides
                      ? `<span class="yanta-tpl-card-meta">${lucide('presentation', 12)}<span>Five slides, ready to present</span></span>`
                      : ''}
                    ${tpl.own ? '<span class="yanta-tpl-card-badge">Yours</span>' : ''}
                  </button>
                `).join('')}
              </div>
            </section>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  document.body.append(overlay);

  const close = () => {
    overlay.remove();
    release?.();
  };

  // Device-back closes the picker instead of leaving the app.
  const release = openBoundOverlay('template-picker', {
    close,
    isOpen: () => overlay.isConnected,
  });

  overlay.querySelector('[data-tpl-close]')?.addEventListener('click', close);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.querySelectorAll('[data-tpl-key]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = templates.find((tpl) => tpl.key === btn.dataset.tplKey);
      if (!entry) return;

      close();

      try {
        await createNoteFromTemplate(entry);
      } catch (err) {
        console.error(err);
        toast('Could not create the note from that template.', 'error');
      }
    });
  });
}

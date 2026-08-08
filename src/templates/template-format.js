/*
  Template format.

  A template is a NOTE. Not a new entity, not a new store, not a schema — a
  markdown note carrying a `template:` frontmatter block, exactly the way a
  Pulse routine is a Skill note carrying a `pulse:` block.

  That choice is the whole maintenance story: templates sync, export, import,
  search, share and migrate because notes do. Anything that ever happens to
  notes happens to templates for free, and a future change to the note model
  cannot leave templates behind — there is nothing separate to leave behind.

    ---
    template:
      name: Client conversation
      description: Structure for a first call, with the follow-up already dated
      category: freelance
    ---

  Only `name` is required. Everything else is presentation.
*/

import { parseSkillFrontmatter } from '../ai/skills.js';

/*
  Same indented-block reader Pulse uses for its `pulse:` block. io.js's
  parseFrontmatter is a flat key/value parser and cannot see nested keys, so
  reusing it here would silently read an empty template block.
*/
function readIndentedBlock(rawFrontmatter, key) {
  const lines = String(rawFrontmatter || '').split('\n');
  const start = lines.findIndex((line) => new RegExp(`^${key}\\s*:\\s*$`).test(line));

  if (start < 0) return null;

  const out = {};

  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break;

    const m = /^\s+([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }

  return out;
}

export const TEMPLATE_CATEGORIES = [
  { id: 'freelance', label: 'Freelance & consulting' },
  { id: 'teaching', label: 'Teaching' },
  { id: 'research', label: 'Research & thesis' },
  { id: 'personal', label: 'Personal' },
];

/**
 * Reads the `template:` block out of a note's markdown.
 * Returns null when the note is not a template.
 */
export function parseTemplateBlock(markdown) {
  const parsed = parseSkillFrontmatter(String(markdown || ''));
  const block = readIndentedBlock(parsed.rawFrontmatter, 'template');

  if (!block) return null;

  const name = String(block.name || '').trim();
  if (!name) return null;

  return {
    name,
    description: String(block.description || '').trim(),
    category: String(block.category || 'personal').trim(),
  };
}

/**
 * The body a template produces — everything after the frontmatter.
 *
 * The `template:` block is metadata about the template, not content of the
 * note it creates, so it never travels into the new note.
 */
export function templateBody(markdown) {
  return String(parseSkillFrontmatter(String(markdown || '')).body || '').trim();
}

/**
 * Placeholders a template may use. Kept intentionally tiny: every token here
 * is a promise to keep supporting it.
 *
 *   {{date}}      2026-08-08
 *   {{time}}      14:30
 *   {{weekday}}   Saturday
 */
export function fillTemplatePlaceholders(text, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');

  const values = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday: now.toLocaleDateString(undefined, { weekday: 'long' }),
  };

  return String(text || '').replace(
    /\{\{\s*(date|time|weekday)\s*\}\}/g,
    (_, key) => values[key] ?? ''
  );
}

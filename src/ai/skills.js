// ============================================================
// YANTA AI Skills
//
// On-demand procedural knowledge documents.
// Progressive disclosure:
// - skills_list: compact index
// - skill_view(name): full SKILL.md
// - skill_view(name, path): reference/supporting file
// - skill_manage: create/update/delete skills and files
// ============================================================

import {
  uid,
  state,
  store,
} from '../core.js';

import {
  getNoteDoc,
  noteMarkdown,
  destroyNoteDoc,
} from '../yjs.js';

import {
  renderTree,
} from '../tree.js';

import {
  ensureAiBrain,
  AI_BRAIN_IDS,
  isAiBrainNote,
  writeBrainNote,
} from './brain.js';

function now() {
  return Date.now();
}

function cloneJson(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

export function parseSkillFrontmatter(markdown = '') {
  const text = String(markdown || '');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);

  if (!match) {
    return {
      meta: {},
      body: text,
      rawFrontmatter: '',
    };
  }

  const meta = {};
  const rawFrontmatter = match[1];

  for (const line of rawFrontmatter.split('\n')) {
    const m = /^([a-zA-Z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!m) continue;

    const key = m[1].trim();
    const raw = m[2].trim();

    if (/^\[.*\]$/.test(raw)) {
      try {
        meta[key] = JSON.parse(raw);
        continue;
      } catch {}
    }

    if (raw === 'true') meta[key] = true;
    else if (raw === 'false') meta[key] = false;
    else meta[key] = raw.replace(/^["']|["']$/g, '');
  }

  return {
    meta,
    body: text.slice(match[0].length),
    rawFrontmatter,
  };
}

function slugifySkillName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^skill:\s*/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function skillNameFromNoteAndMarkdown(note, markdown = '') {
  const parsed = parseSkillFrontmatter(markdown);

  return (
    slugifySkillName(parsed.meta.name) ||
    slugifySkillName(note?.skillName) ||
    slugifySkillName(note?.title) ||
    ''
  );
}

function skillDescriptionFromMarkdown(markdown = '') {
  const parsed = parseSkillFrontmatter(markdown);

  if (parsed.meta.description) {
    return String(parsed.meta.description).trim();
  }

  const firstUseful = parsed.body
    .split('\n')
    .map((line) => line.trim())
    .find((line) =>
      line &&
      !line.startsWith('#') &&
      !line.startsWith('---')
    );

  return firstUseful || '';
}

function skillTagsFromMarkdown(markdown = '') {
  const parsed = parseSkillFrontmatter(markdown);

  const values = [
    parsed.meta.tags,
    parsed.meta['metadata.yanta.tags'],
    parsed.meta['metadata.hermes.tags'],
  ];

  const tags = [];

  for (const value of values) {
    if (Array.isArray(value)) tags.push(...value.map(String));
    else if (typeof value === 'string') {
      tags.push(...value.split(',').map((x) => x.trim()));
    }
  }

  return [...new Set(tags.filter(Boolean))];
}

function skillCategoryFromMarkdown(markdown = '') {
  const parsed = parseSkillFrontmatter(markdown);

  return String(
    parsed.meta.category ||
    parsed.meta['metadata.yanta.category'] ||
    parsed.meta['metadata.hermes.category'] ||
    'general'
  ).trim();
}

async function skillFilesMap(noteId) {
  const entry = getNoteDoc(noteId);
  await entry.ready;

  return entry.doc.getMap('skillFiles');
}

async function skillRecordFromNote(note) {
  let markdown = '';

  try {
    markdown = noteMarkdown(note.id);
  } catch {}

  const name = skillNameFromNoteAndMarkdown(note, markdown);

  if (!name) return null;

  return {
    id: note.id,
    noteId: note.id,
    name,
    title: note.title || `Skill: ${name}`,
    description: skillDescriptionFromMarkdown(markdown).slice(0, 300),
    category: skillCategoryFromMarkdown(markdown),
    tags: skillTagsFromMarkdown(markdown),
    updated: Number(note.updated || 0),
    markdown,
  };
}

export async function listInstalledSkills({
  query = '',
  includeMarkdown = false,
} = {}) {
  await ensureAiBrain();

  const q = String(query || '').trim().toLowerCase();
  const out = [];

  for (const note of state.notes.values()) {
    if (note.folderId !== AI_BRAIN_IDS.skillsFolder) continue;
    if (!isAiBrainNote(note)) continue;

    const skill = await skillRecordFromNote(note);
    if (!skill) continue;

    const hay = [
      skill.name,
      skill.title,
      skill.description,
      skill.category,
      skill.tags.join(' '),
    ].join(' ').toLowerCase();

    if (q && !hay.includes(q)) continue;

    if (!includeMarkdown) {
      delete skill.markdown;
    }

    out.push(skill);
  }

  return out.sort((a, b) =>
    a.category.localeCompare(b.category) ||
    a.name.localeCompare(b.name)
  );
}

async function findSkill(name) {
  const clean = slugifySkillName(name);

  if (!clean) return null;

  const skills = await listInstalledSkills({
    includeMarkdown: true,
  });

  return skills.find((skill) =>
    skill.name === clean ||
    slugifySkillName(skill.title) === clean
  ) || null;
}

export async function buildSkillIndexContext({
  maxSkills = 80,
} = {}) {
  const skills = await listInstalledSkills();

  const visible = skills.slice(0, maxSkills);

  return [
    '# YANTA Skills',
    '',
    'Skills are on-demand procedural knowledge documents.',
    'Do not assume full skill contents are loaded.',
    'Use skills_list to discover skills and skill_view(name) to load a relevant skill before using it.',
    'Use skill_manage to create or improve reusable procedural skills when appropriate.',
    '',
    '## Available Skills',
    visible.length
      ? visible.map((skill) => {
          const tags = skill.tags?.length
            ? ` · tags: ${skill.tags.join(', ')}`
            : '';

          return `- ${skill.name}: ${skill.description || 'No description'} · category: ${skill.category}${tags}`;
        }).join('\n')
      : '- No skills installed.',
  ].join('\n');
}

export async function skillsListAction(args = {}) {
  const skills = await listInstalledSkills({
    query: args.query || '',
  });

  return {
    count: skills.length,
    skills,
  };
}

export async function skillViewAction({
  name,
  path = '',
} = {}) {
  const skill = await findSkill(name);

  if (!skill) {
    throw new Error(`Skill not found: ${name}`);
  }

  const cleanPath = String(path || '').trim();

  if (!cleanPath) {
    return {
      name: skill.name,
      noteId: skill.noteId,
      category: skill.category,
      tags: skill.tags,
      description: skill.description,
      mimeType: 'text/markdown',
      text: skill.markdown,
    };
  }

  const files = await skillFilesMap(skill.noteId);
  const content = files.get(cleanPath);

  if (content == null) {
    throw new Error(`Skill file not found: ${skill.name}/${cleanPath}`);
  }

  return {
    name: skill.name,
    noteId: skill.noteId,
    path: cleanPath,
    mimeType: 'text/markdown',
    text: String(content || ''),
  };
}

function defaultSkillMarkdown({
  name,
  description = '',
  body = '',
} = {}) {
  const cleanName = slugifySkillName(name);

  return [
    '---',
    `name: ${cleanName}`,
    `description: ${String(description || 'Reusable YANTA skill').slice(0, 160)}`,
    'version: 1.0.0',
    'metadata:',
    '  yanta:',
    '    category: general',
    '---',
    '',
    `# ${cleanName}`,
    '',
    '## When to Use',
    '',
    'Use this skill when the task matches the procedure below.',
    '',
    '## Procedure',
    '',
    body || '1. Understand the request.\n2. Follow the reusable workflow.\n3. Verify the result.',
    '',
    '## Pitfalls',
    '',
    '- Keep instructions concrete and tool-aware.',
    '',
    '## Verification',
    '',
    '- Confirm the result is complete and useful.',
  ].join('\n');
}

export async function skillManageAction(args = {}) {
  await ensureAiBrain();

  const action = String(args.action || '').trim();
  const name = slugifySkillName(args.name || '');

  if (!action || !name) {
    throw new Error('action and name are required.');
  }

  const existing = await findSkill(name);

  if (action === 'create') {
    if (existing) {
      throw new Error(`Skill already exists: ${name}`);
    }

    const content = String(args.content || '').trim() ||
      defaultSkillMarkdown({
        name,
        description: args.description || '',
        body: args.body || '',
      });

    const parsed = parseSkillFrontmatter(content);
    const title = `Skill: ${slugifySkillName(parsed.meta.name || name)}`;

    const res = await writeBrainNote({
      title,
      body: content,
      target: 'skill',
      mode: 'replace',
    });

    const note = state.notes.get(res.id);

    if (note) {
      note.skillName = slugifySkillName(parsed.meta.name || name);
      note.skillCategory = skillCategoryFromMarkdown(content);
      note.tags = [...new Set([...(note.tags || []), 'ai-brain', 'skill'])];
      note.updated = now();

      await store.notes.put(note);
    }

    renderTree();

    return {
      ok: true,
      action,
      name,
      noteId: res.id,
    };
  }

  if (!existing) {
    throw new Error(`Skill not found: ${name}`);
  }

  if (action === 'edit') {
    const content = String(args.content || '').trim();

    if (!content) {
      throw new Error('content is required for edit.');
    }

    await writeBrainNote({
      noteId: existing.noteId,
      body: content,
      mode: 'replace',
      target: 'skill',
    });

    return {
      ok: true,
      action,
      name,
      noteId: existing.noteId,
    };
  }

  if (action === 'patch') {
    const oldString = String(args.old_string || '');
    const newString = String(args.new_string || '');

    if (!oldString) {
      throw new Error('old_string is required for patch.');
    }

    if (!existing.markdown.includes(oldString)) {
      throw new Error('old_string not found in skill.');
    }

    const next = existing.markdown.replace(oldString, newString);

    await writeBrainNote({
      noteId: existing.noteId,
      body: next,
      mode: 'replace',
      target: 'skill',
    });

    return {
      ok: true,
      action,
      name,
      noteId: existing.noteId,
    };
  }

  if (action === 'delete') {
    state.notes.delete(existing.noteId);
    state.searchIndex.delete(existing.noteId);

    await store.notes.del(existing.noteId).catch(() => {});
    await destroyNoteDoc(existing.noteId).catch(() => {});

    renderTree();

    return {
      ok: true,
      action,
      name,
      deletedNoteId: existing.noteId,
    };
  }

  if (action === 'write_file') {
    const filePath = String(args.file_path || '').trim();
    const fileContent = String(args.file_content || '');

    if (!filePath) {
      throw new Error('file_path is required for write_file.');
    }

    const files = await skillFilesMap(existing.noteId);
    files.set(filePath, fileContent);

    return {
      ok: true,
      action,
      name,
      noteId: existing.noteId,
      path: filePath,
    };
  }

  if (action === 'remove_file') {
    const filePath = String(args.file_path || '').trim();

    if (!filePath) {
      throw new Error('file_path is required for remove_file.');
    }

    const files = await skillFilesMap(existing.noteId);
    files.delete(filePath);

    return {
      ok: true,
      action,
      name,
      noteId: existing.noteId,
      path: filePath,
    };
  }

  throw new Error(`Unsupported skill_manage action: ${action}`);
}
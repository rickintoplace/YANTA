import { describe, it, expect, beforeEach } from 'vitest';

const { state } = await import('../../src/core.js');
const { assertArgsVisible, scrubResultForAi, isNoteHiddenFromAi, AI_PRIVATE_CODE } = await import('../../src/ai/ai-visibility.js');

beforeEach(() => {
  state.notes.clear();
  state.folders.clear();
  state.calendarCategories.clear();
  state.calendarEvents.clear();

  state.folders.set('f-private', { id: 'f-private', name: 'Health', aiHidden: true });
  state.folders.set('f-sub', { id: 'f-sub', name: 'Doctors', parentId: 'f-private' });
  state.folders.set('f-open', { id: 'f-open', name: 'Work' });
  state.notes.set('n1', { id: 'n1', title: 'Blood test', folderId: 'f-sub' });
  state.notes.set('n2', { id: 'n2', title: 'Roadmap', folderId: 'f-open' });
  state.notes.set('n3', { id: 'n3', title: 'Diary', folderId: 'f-open', aiHidden: true });
  state.calendarCategories.set('c-private', { id: 'c-private', name: 'Therapy', aiHidden: true });
  state.calendarEvents.set('e1', { id: 'e1', title: 'Session', categoryId: 'c-private', start: '2026-10-12T10:00:00Z' });
  state.calendarEvents.set('e2', { id: 'e2', title: 'Standup', categoryId: 'work', start: '2026-10-12T09:00:00Z' });
});

describe('hidden from YANTA AI', () => {
  it('a folder mark covers everything below it', () => {
    expect(isNoteHiddenFromAi('n1')).toBe(true);
    expect(isNoteHiddenFromAi('n2')).toBe(false);
    expect(isNoteHiddenFromAi('n3')).toBe(true);
  });

  it('refuses tool calls that name a hidden item', () => {
    expect(() => assertArgsVisible({ noteId: 'n1' })).toThrow(expect.objectContaining({ code: AI_PRIVATE_CODE }));
    expect(() => assertArgsVisible({ noteIds: ['n2', 'n3'] })).toThrow();
    expect(() => assertArgsVisible({ folderId: 'f-sub' })).toThrow();
    expect(() => assertArgsVisible({ eventId: 'e1' })).toThrow();
    expect(() => assertArgsVisible({ categoryId: 'c-private', title: 'x' })).toThrow();
    expect(() => assertArgsVisible({ noteId: 'n2' })).not.toThrow();
  });

  it('scrubs hidden notes and events out of results', () => {
    const search = scrubResultForAi([
      { id: 'n1', title: 'Blood test', folderId: 'f-sub' },
      { id: 'n2', title: 'Roadmap', folderId: 'f-open' },
      { id: 'n3', title: 'Diary', folderId: 'f-open' },
    ]);
    expect(search.map((r) => r.id)).toEqual(['n2']);

    const semantic = scrubResultForAi({ results: [{ noteId: 'n1', score: 0.9 }, { noteId: 'n2', score: 0.5 }] });
    expect(semantic.results.map((r) => r.noteId)).toEqual(['n2']);

    const events = scrubResultForAi({ events: [{ id: 'e1::2026-10-12', recurrenceMasterId: 'e1', title: 'Session' }, { id: 'e2', title: 'Standup', categoryId: 'work', start: 'x' }] });
    expect(events.events.map((e) => e.title)).toEqual(['Standup']);

    expect(scrubResultForAi({ id: 'n3', title: 'Diary', markdown: 'secret' })).toMatchObject({ code: AI_PRIVATE_CODE });
  });
});

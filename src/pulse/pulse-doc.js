// ============================================================
// YANTA Pulse — the shared Pulse document
//
// Inbox, run bookkeeping and history live in Y.Maps on one system note,
// so they sync end-to-end encrypted like everything else: a result the
// laptop produced is waiting on the phone, and reading it on one device
// clears the badge on the other.
//
// Same pattern as skill files (`doc.getMap('skillFiles')`). The note's
// markdown body is a short human-readable explainer — the data lives in
// the maps beside it.
//
// CRDT shape matters here. Inbox items are keyed by their own id, so two
// devices delivering at once merge instead of clobbering. Run records
// are keyed by routine name and are last-writer-wins, which is the right
// trade: worst case a routine runs twice across a sync gap, and the
// digest check then suppresses the duplicate result.
// ============================================================

import { state, store } from '../core.js';
import { getNoteDoc } from '../yjs.js';

import {
  ensureAiBrain,
  AI_BRAIN_IDS,
} from '../ai/brain.js';

export const PULSE_NOTE_ID = 'system_pulse_state';

const BODY = `# Pulse

Working state for YANTA Pulse: the Inbox, when each routine last ran,
and a short history of what the runs did.

This note syncs so results reach every device. The readable log lives
in the Pulse overview — editing this text does nothing.
`;

let ensured = null;

async function ensurePulseNote() {
  if (ensured) return ensured;

  ensured = (async () => {
    await ensureAiBrain();

    const existing = state.notes.get(PULSE_NOTE_ID);

    const note = {
      ...(existing || {}),
      id: PULSE_NOTE_ID,
      title: 'Pulse',
      type: 'markdown',
      folderId: AI_BRAIN_IDS.rootFolder,
      tags: existing?.tags || ['ai-brain', 'pulse'],
      pinned: false,
      icon: 'activity',
      color: '#6ea8fe',
      created: existing?.created || Date.now(),
      updated: existing?.updated || Date.now(),
      system: true,
      aiBrain: true,
      dashboardHidden: true,
      hiddenFromDashboard: true,
    };

    state.notes.set(PULSE_NOTE_ID, note);
    await store.notes.put(note);

    const entry = getNoteDoc(PULSE_NOTE_ID);
    await entry.ready;

    const text = entry.doc.getText('markdown');
    if (text.length === 0) text.insert(0, BODY);

    return entry;
  })();

  return ensured;
}

/** @returns {Promise<{inbox: Y.Map, runs: Y.Map, history: Y.Array, doc: Y.Doc}>} */
export async function pulseMaps() {
  const entry = await ensurePulseNote();

  return {
    doc: entry.doc,
    inbox: entry.doc.getMap('pulseInbox'),
    runs: entry.doc.getMap('pulseRuns'),
    history: entry.doc.getArray('pulseHistory'),
  };
}

/** Marks the note updated so sync picks the change up promptly. */
export async function touchPulseNote() {
  const note = state.notes.get(PULSE_NOTE_ID);

  if (!note) return;

  note.updated = Date.now();
  await store.notes.put(note);
}

/**
 * Runs `fn` whenever the Pulse document changes, including changes that
 * arrived from another device. Returns an unsubscribe function.
 */
export async function observePulseDoc(fn) {
  const { doc } = await pulseMaps();

  const handler = () => fn();

  doc.on('update', handler);

  return () => doc.off('update', handler);
}

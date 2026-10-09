import { describe, it, expect } from 'vitest';
import { bootApp, createOrigin, restartApp, IndexedMemoryObjectStore, newSyncKey } from './harness.js';

/*
  Randomised convergence: three devices create notes, type into them,
  rename them, delete some, go "offline" (simply not syncing for a
  while) and restart, in a random but seeded order. After everyone has
  synced a few times, all devices must agree on which notes exist, their
  titles and their bodies, and no text typed into a note that still
  exists may be missing.

  Seeds are fixed so a failure reproduces; FUZZ_SEED=<n> runs one seed,
  FUZZ_STEPS=<n> changes the length.
*/

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : [1, 7, 42];
const STEPS = Number(process.env.FUZZ_STEPS || 45);

async function bodyOf(app, id) {
  app.activate();
  const entry = app.yjs.getNoteDoc(id);
  await entry.ready;
  return entry.doc.getText('markdown').toString();
}

function liveIds(app) {
  return [...app.core.state.notes.keys()].filter((id) => !app.isTombstoned(id)).sort();
}

async function runScenario(seed) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];

  const remote = new IndexedMemoryObjectStore();
  const syncKey = await newSyncKey();

  let devices = [];
  for (const name of ['A', 'B', 'C']) {
    devices.push(await bootApp(createOrigin(`${name}${seed}`), { remote, syncKey, deviceId: `dev-${name}-${seed}` }));
  }

  // What was typed where, to check nothing got lost.
  const typed = new Map(); // noteId -> [fragment]
  const deleted = new Set();
  let counter = 0;
  const log = [];

  for (let step = 0; step < STEPS; step++) {
    const i = Math.floor(random() * devices.length);
    const app = devices[i];
    const known = liveIds(app).filter((id) => !deleted.has(id));
    const roll = random();

    if (roll < 0.18 || !known.length) {
      const id = `n${seed}-${++counter}`;
      const fragment = `[${id} born on ${i}]`;
      await app.createNote({ id, title: `Note ${counter}` }, fragment);
      typed.set(id, [fragment]);
      log.push(`${i} create ${id}`);
    } else if (roll < 0.55) {
      const id = pick(known);
      app.activate();
      const entry = app.yjs.getNoteDoc(id);
      await entry.ready;
      await app.engine?.observeNote(id);
      const text = entry.doc.getText('markdown');
      const fragment = `[edit ${step} on ${i}]`;
      // Insert at a word boundary so fragments stay intact for the check.
      const at = random() < 0.5 ? 0 : text.length;
      text.insert(at, fragment);
      (typed.get(id) || typed.set(id, []).get(id)).push(fragment);
      log.push(`${i} edit ${id}`);
    } else if (roll < 0.66) {
      const id = pick(known);
      await app.updateNote(id, { title: `Title ${step} from ${i}` });
      log.push(`${i} rename ${id}`);
    } else if (roll < 0.70 && known.length > 2) {
      const id = pick(known);
      app.activate();
      app.core.state.notes.delete(id);
      await app.core.store.notes.del(id);
      deleted.add(id);
      log.push(`${i} delete ${id}`);
    } else if (roll < 0.74) {
      await app.sync();
      devices[i] = await restartApp(app);
      log.push(`${i} restart`);
    } else {
      await app.sync();
      log.push(`${i} sync`);
    }
  }

  // Everyone comes online and syncs until things settle.
  for (let round = 0; round < 3; round++) {
    for (const app of devices) await app.sync();
  }

  if (process.env.FUZZ_DEBUG) {
    for (const id of liveIds(devices[0])) {
      const rows = devices.map((d) => { d.activate(); const v = d.vaultNote(id); return `${d.core.state.notes.get(id)?.title}|vault:${v?.title}|u:${d.core.state.notes.get(id)?.updated}/${v?.updated}`; });
      if (new Set(rows.map((r) => r.split('|')[0])).size > 1) console.log('DIVERGE', id, rows);
    }
  }

  const reference = devices[0];
  const ids = liveIds(reference);
  const report = { seed, log: log.join(' | ') };

  for (const app of devices.slice(1)) {
    expect(liveIds(app), JSON.stringify(report)).toEqual(ids);
  }

  for (const id of ids) {
    const title = reference.core.state.notes.get(id)?.title;
    const body = await bodyOf(reference, id);

    for (const app of devices.slice(1)) {
      expect(app.core.state.notes.get(id)?.title, `${id} title, ${JSON.stringify(report)}`).toBe(title);
      expect(await bodyOf(app, id), `${id} body, ${JSON.stringify(report)}`).toBe(body);
    }

    // Notes that were never deleted keep every fragment typed into them.
    if (!deleted.has(id)) {
      for (const fragment of typed.get(id) || []) {
        expect(body, `${id} lost "${fragment}", ${JSON.stringify(report)}`).toContain(fragment);
      }
    }
  }

  // Deleted notes stay deleted everywhere.
  for (const id of deleted) {
    for (const app of devices) expect(app.core.state.notes.has(id), `${id} came back`).toBe(false);
  }

  for (const app of devices) await app.shutdown();

  return { notes: ids.length, deleted: deleted.size, steps: log.length };
}

describe('randomised three-device convergence', () => {
  for (const seed of SEEDS) {
    it(`converges (seed ${seed})`, async () => {
      const result = await runScenario(seed);
      expect(result.notes).toBeGreaterThan(0);
    }, 180_000);
  }
});

describe('equal timestamps', () => {
  it('two renames in the same millisecond converge on one title', async () => {
    const { vi } = await import('vitest');
    const remote = new IndexedMemoryObjectStore();
    const syncKey = await newSyncKey();
    const a = await bootApp(createOrigin('TA'), { remote, syncKey, deviceId: 'dev-ta' });
    await a.createNote({ id: 't1', title: 'Start' }, 'x');
    await a.sync();
    const b = await bootApp(createOrigin('TB'), { remote, syncKey, deviceId: 'dev-tb' });
    await b.sync();

    const now = vi.spyOn(Date, 'now').mockReturnValue(1_900_000_000_000);
    await a.updateNote('t1', { title: 'From A' });
    await b.updateNote('t1', { title: 'From B' });
    now.mockRestore();

    for (let i = 0; i < 3; i++) {
      await a.sync();
      await b.sync();
    }

    expect(a.core.state.notes.get('t1').title).toBe(b.core.state.notes.get('t1').title);
  });
});

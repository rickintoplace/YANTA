import { describe, it, expect, vi, beforeAll } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

/*
  The semantic worker seals previews and vectors while the app lock is on,
  reseals rows written before it, and still finds what it indexed.
  The model is a stand-in: a 4-dim "embedding" from the text's letters.
*/

vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline: async () => async (inputs) => {
    const dims = 4;
    const data = new Float32Array(inputs.length * dims);
    inputs.forEach((text, i) => {
      const v = [0, 0, 0, 0];
      for (const ch of String(text).toLowerCase()) v[ch.charCodeAt(0) % dims] += 1;
      const norm = Math.hypot(...v) || 1;
      v.forEach((x, j) => { data[i * dims + j] = x / norm; });
    });
    return { data, dims: [inputs.length, dims] };
  },
}));

const SECRET = 'Kolibri-Nektarfluss';
const replies = [];
let reqId = 0;

async function send(msg) {
  const id = ++reqId;
  await self.onmessage({ data: { ...msg, reqId: id } });
  return replies.find((r) => r.reqId === id);
}

function rawRows(storeName) {
  return new Promise((resolve) => {
    const req = indexedDB.open('yanta-semantic');
    req.onsuccess = () => {
      const r = req.result.transaction(storeName).objectStore(storeName).getAll();
      r.onsuccess = () => { req.result.close(); resolve(r.result); };
    };
  });
}

const leaks = (rows) => JSON.stringify(rows).includes(SECRET);

beforeAll(async () => {
  globalThis.indexedDB = new IDBFactory();
  self.postMessage = (m) => replies.push(m);
  await import('../../src/semantic/semantic-worker.js');
});

describe('semantic index at rest', () => {
  const model = { id: 'fake', hf: 'fake', dims: 4 };
  const note = (id, text) => ({
    type: 'sync-note',
    noteId: id,
    updated: 1,
    title: SECRET,
    chunks: [{ ix: 0, hash: `h-${id}`, text, preview: text }],
  });

  it('reseals plain rows when the key arrives and seals new ones', async () => {
    expect((await send({ type: 'init', model, atRestKey: null })).ok).toBe(true);
    await send(note('plain', `${SECRET} vorher`));
    expect(leaks(await rawRows('chunks'))).toBe(true);

    const { setAtRestKeyFromLdk } = await import('../../src/lock/at-rest.js');
    const key = await setAtRestKeyFromLdk(crypto.getRandomValues(new Uint8Array(32)));
    await send({ type: 'at-rest-key', key });

    expect(leaks(await rawRows('chunks'))).toBe(false);
    expect(leaks(await rawRows('notes'))).toBe(false);

    await send(note('sealed', `${SECRET} nachher`));
    expect(leaks(await rawRows('chunks'))).toBe(false);

    const result = await send({ type: 'search', query: `${SECRET} nachher`, topK: 5, minScore: 0 });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain(SECRET);
  });
});

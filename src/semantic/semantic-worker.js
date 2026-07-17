// ============================================================
// YANTA Semantic — the worker
//
// Owns everything heavy so the main thread never blocks:
// model download + inference (transformers.js v4, WebGPU with
// WASM fallback), the vector store (own IndexedDB database
// "yanta-semantic" — deliberately separate from the core DB, no
// schema migration risk), the in-memory matrix and the search.
//
// Vectors are mean-pooled + L2-normalized, so cosine similarity
// is a plain dot product.
// ============================================================

/* eslint-env worker */

const DB_NAME = 'yanta-semantic';
const DB_VERSION = 1;

let db = null;

let extractor = null;
let model = null;          // { id, hf, dims, dtype, prefixes }
let device = null;         // 'webgpu' | 'wasm'
let initPromise = null;

/*
  In-memory index. Parallel arrays instead of objects: 50k chunks à
  384 dims are ~76 MB of Float32 either way, but scanning parallel
  arrays keeps the search loop allocation-free.
*/
const index = {
  keys: [],       // `${noteId}:${ix}`
  noteIds: [],
  previews: [],
  vectors: [],    // Float32Array (normalized)
};

const noteStamps = new Map();   // noteId -> updated (ms)

// ---------------- IndexedDB ---------------------------------------

function openDb() {
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const d = req.result;

      if (!d.objectStoreNames.contains('chunks')) {
        const chunks = d.createObjectStore('chunks', { keyPath: 'key' });
        chunks.createIndex('byNote', 'noteId', { unique: false });
      }

      if (!d.objectStoreNames.contains('notes')) {
        d.createObjectStore('notes', { keyPath: 'noteId' });
      }

      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'k' });
      }
    };

    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };

    req.onerror = () => reject(req.error);
  });
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('tx aborted'));
  });
}

async function clearAllStores() {
  const d = await openDb();
  const tx = d.transaction(['chunks', 'notes', 'meta'], 'readwrite');

  tx.objectStore('chunks').clear();
  tx.objectStore('notes').clear();
  tx.objectStore('meta').clear();

  await txDone(tx);
}

// ---------------- in-memory index ops ------------------------------

function indexRemoveNote(noteId) {
  for (let i = index.noteIds.length - 1; i >= 0; i--) {
    if (index.noteIds[i] !== noteId) continue;

    index.keys.splice(i, 1);
    index.noteIds.splice(i, 1);
    index.previews.splice(i, 1);
    index.vectors.splice(i, 1);
  }
}

function indexAdd(key, noteId, preview, vector) {
  index.keys.push(key);
  index.noteIds.push(noteId);
  index.previews.push(preview);
  index.vectors.push(vector);
}

async function loadIndexFromDb() {
  const d = await openDb();

  // Stored under a different model? Start fresh — mixing embedding
  // spaces produces silent garbage, a rebuild is the only honest move.
  const meta = await reqAsPromise(
    d.transaction('meta').objectStore('meta').get('model')
  );

  if (meta && meta.v !== model.id) {
    await clearAllStores();
  }

  await reqAsPromise(
    d.transaction('meta', 'readwrite').objectStore('meta').put({ k: 'model', v: model.id })
  );

  index.keys.length = 0;
  index.noteIds.length = 0;
  index.previews.length = 0;
  index.vectors.length = 0;
  noteStamps.clear();

  const chunks = await reqAsPromise(
    d.transaction('chunks').objectStore('chunks').getAll()
  );

  for (const c of chunks) {
    indexAdd(c.key, c.noteId, c.preview || '', new Float32Array(c.vec));
  }

  const notes = await reqAsPromise(
    d.transaction('notes').objectStore('notes').getAll()
  );

  for (const n of notes) {
    noteStamps.set(n.noteId, n.updated || 0);
  }
}

// ---------------- model -------------------------------------------

/*
  Warum proben statt try/catch-Fallback: ein GESCHEITERTER
  WebGPU-Pipeline-Init vergiftet den ORT-Zustand dieses Kontexts —
  danach schlägt auch der WASM-Versuch mit dem gecachten
  WebGPU-Fehler fehl (reproduziert mit transformers.js 4.2.0).
  Deshalb: Adapter explizit anfragen, EINEN Init-Versuch machen,
  und den Rest regelt der Main Thread per Worker-Neustart.
*/
async function pickDevice(forceDevice) {
  if (forceDevice === 'wasm') return 'wasm';

  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    }
  } catch {}

  return 'wasm';
}

let lastDeviceTried = null;

async function initModel(requestedModel, forceDevice, progress) {
  model = requestedModel;

  const { pipeline, env } = await import('@huggingface/transformers');

  /*
    Ohne COOP/COEP-Header gibt es kein SharedArrayBuffer — der
    multithreaded WASM-Backend-Init schlägt dann komplett fehl statt
    zu degradieren. Single-thread + SIMD ist der verlässliche Pfad
    (Android WebView, normale Static Hosts); WebGPU bleibt der
    schnelle Pfad, wo verfügbar.
  */
  if (!self.crossOriginIsolated && env?.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
  }

  // Self-hosted ORT runtimes (public/ort/, siehe copy-ort-assets.mjs)
  // statt cdn.jsdelivr.net — die Produktions-CSP erlaubt nur 'self'.
  if (env?.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = new URL('/ort/', self.location.origin).href;
  }

  const dev = await pickDevice(forceDevice);
  lastDeviceTried = dev;

  extractor = await pipeline('feature-extraction', model.hf, {
    dtype: model.dtype || 'q8',
    device: dev,
    progress_callback: (p) => {
      if (p?.status === 'progress' && p.total) {
        progress({
          phase: 'download',
          file: p.file || '',
          loaded: p.loaded || 0,
          total: p.total || 0,
        });
      }
    },
  });

  device = dev;
}

async function embed(texts, kind) {
  const prefix = model.prefixes?.[kind] || '';
  const input = texts.map((t) => prefix + String(t || ''));

  const out = await extractor(input, {
    pooling: 'mean',
    normalize: true,
  });

  // Tensor [n, dims] → one Float32Array per row.
  const data = out.data;
  const dims = out.dims[out.dims.length - 1];
  const rows = [];

  for (let i = 0; i < input.length; i++) {
    rows.push(new Float32Array(data.buffer, data.byteOffset + i * dims * 4, dims).slice());
  }

  out.dispose?.();

  return rows;
}

// ---------------- handlers -----------------------------------------

async function handleSyncNote({ noteId, updated, title, chunks }) {
  const d = await openDb();

  const stored = await reqAsPromise(
    d.transaction('chunks').objectStore('chunks').index('byNote').getAll(noteId)
  );

  const storedByKey = new Map(stored.map((c) => [c.key, c]));
  const wantedKeys = new Set(chunks.map((c) => `${noteId}:${c.ix}`));

  const toRemove = stored.filter((c) => !wantedKeys.has(c.key));
  const toEmbed = chunks.filter((c) => {
    const prev = storedByKey.get(`${noteId}:${c.ix}`);
    return !prev || prev.hash !== c.hash;
  });

  /*
    Embed in small batches: bounded peak memory and, on WASM/CPU
    phones, natural yield points between batches.
  */
  const BATCH = 8;
  const embedded = [];

  for (let i = 0; i < toEmbed.length; i += BATCH) {
    const batch = toEmbed.slice(i, i + BATCH);
    const vectors = await embed(batch.map((c) => c.text), 'passage');

    for (let j = 0; j < batch.length; j++) {
      embedded.push({ chunk: batch[j], vector: vectors[j] });
    }
  }

  const tx = d.transaction(['chunks', 'notes'], 'readwrite');
  const chunkStore = tx.objectStore('chunks');

  for (const c of toRemove) {
    chunkStore.delete(c.key);
  }

  for (const { chunk, vector } of embedded) {
    chunkStore.put({
      key: `${noteId}:${chunk.ix}`,
      noteId,
      ix: chunk.ix,
      hash: chunk.hash,
      preview: chunk.preview || '',
      vec: vector.buffer.slice(0),
      updated: Date.now(),
    });
  }

  tx.objectStore('notes').put({
    noteId,
    updated: updated || 0,
    title: title || '',
    chunkCount: chunks.length,
  });

  await txDone(tx);

  // Mirror into the in-memory index.
  if (toRemove.length || embedded.length) {
    const keep = new Map();

    for (let i = 0; i < index.keys.length; i++) {
      if (index.noteIds[i] === noteId) keep.set(index.keys[i], i);
    }

    indexRemoveNote(noteId);

    for (const c of chunks) {
      const key = `${noteId}:${c.ix}`;
      const fresh = embedded.find((e) => e.chunk.ix === c.ix);

      if (fresh) {
        indexAdd(key, noteId, c.preview || '', fresh.vector);
        continue;
      }

      const prev = storedByKey.get(key);
      if (prev) {
        indexAdd(key, noteId, prev.preview || '', new Float32Array(prev.vec));
      }
    }
  }

  noteStamps.set(noteId, updated || 0);

  return {
    embedded: embedded.length,
    removed: toRemove.length,
  };
}

async function handleRemoveNotes({ noteIds }) {
  const d = await openDb();
  const tx = d.transaction(['chunks', 'notes'], 'readwrite');
  const chunkStore = tx.objectStore('chunks');
  const byNote = chunkStore.index('byNote');

  for (const noteId of noteIds) {
    const keys = await reqAsPromise(byNote.getAllKeys(noteId));

    for (const key of keys) {
      chunkStore.delete(key);
    }

    tx.objectStore('notes').delete(noteId);
    indexRemoveNote(noteId);
    noteStamps.delete(noteId);
  }

  await txDone(tx);

  return { removed: noteIds.length };
}

async function handleSearch({ query, topK = 8, minScore = 0.78 }) {
  if (!extractor) throw new Error('Model not ready');
  if (!index.vectors.length) return { results: [] };

  const [qvec] = await embed([query], 'query');
  const dims = qvec.length;

  // Best chunk per note wins; a note shouldn't rank higher just
  // because it is long.
  const bestByNote = new Map();

  for (let i = 0; i < index.vectors.length; i++) {
    const v = index.vectors[i];
    if (v.length !== dims) continue;

    let dot = 0;
    for (let j = 0; j < dims; j++) dot += v[j] * qvec[j];

    const prev = bestByNote.get(index.noteIds[i]);

    if (!prev || dot > prev.score) {
      bestByNote.set(index.noteIds[i], {
        noteId: index.noteIds[i],
        score: dot,
        preview: index.previews[i],
      });
    }
  }

  const results = [...bestByNote.values()]
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return { results };
}

/**
 * Related notes for ONE note: its chunk vectors query the whole matrix,
 * best chunk-to-chunk score per foreign note wins.
 */
function handleSimilarNotes({ noteId, topK = 5, minScore = 0.8 }) {
  const queries = [];

  for (let i = 0; i < index.vectors.length; i++) {
    if (index.noteIds[i] === noteId) queries.push(index.vectors[i]);
  }

  if (!queries.length || index.vectors.length <= queries.length) {
    return { results: [] };
  }

  const bestByNote = new Map();

  for (let i = 0; i < index.vectors.length; i++) {
    const targetNote = index.noteIds[i];
    if (targetNote === noteId) continue;

    const v = index.vectors[i];
    let best = -1;

    for (const q of queries) {
      if (q.length !== v.length) continue;

      let dot = 0;
      for (let j = 0; j < v.length; j++) dot += v[j] * q[j];
      if (dot > best) best = dot;
    }

    const prev = bestByNote.get(targetNote);

    if (!prev || best > prev.score) {
      bestByNote.set(targetNote, {
        noteId: targetNote,
        score: best,
        preview: index.previews[i],
      });
    }
  }

  const results = [...bestByNote.values()]
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return { results };
}

/**
 * Note-level link suggestions for the graph: mean chunk vector per
 * note, pairwise cosine, top links per note. Quadratic in notes —
 * capped, the caller falls back to the TF heuristic above the cap.
 */
function handleNoteLinks({ maxPerNote = 3, minScore = 0.8, cap = 1500 }) {
  const sums = new Map();   // noteId -> { vec: Float64Array, n }

  for (let i = 0; i < index.vectors.length; i++) {
    const v = index.vectors[i];
    let acc = sums.get(index.noteIds[i]);

    if (!acc) {
      acc = { vec: new Float64Array(v.length), n: 0 };
      sums.set(index.noteIds[i], acc);
    }

    if (acc.vec.length !== v.length) continue;

    for (let j = 0; j < v.length; j++) acc.vec[j] += v[j];
    acc.n++;
  }

  if (sums.size < 2) return { links: [] };
  if (sums.size > cap) return { links: null };

  const ids = [];
  const means = [];

  for (const [noteId, acc] of sums) {
    let norm = 0;
    for (let j = 0; j < acc.vec.length; j++) norm += acc.vec[j] * acc.vec[j];
    norm = Math.sqrt(norm) || 1;

    const mean = new Float32Array(acc.vec.length);
    for (let j = 0; j < acc.vec.length; j++) mean[j] = acc.vec[j] / norm;

    ids.push(noteId);
    means.push(mean);
  }

  const perNote = new Map(ids.map((id) => [id, []]));

  for (let a = 0; a < ids.length; a++) {
    const va = means[a];

    for (let b = a + 1; b < ids.length; b++) {
      const vb = means[b];
      if (va.length !== vb.length) continue;

      let dot = 0;
      for (let j = 0; j < va.length; j++) dot += va[j] * vb[j];

      if (dot < minScore) continue;

      perNote.get(ids[a]).push({ other: ids[b], score: dot });
      perNote.get(ids[b]).push({ other: ids[a], score: dot });
    }
  }

  const seen = new Set();
  const links = [];

  for (const [noteId, list] of perNote) {
    list.sort((x, y) => y.score - x.score);

    for (const { other, score } of list.slice(0, maxPerNote)) {
      const key = noteId < other ? `${noteId}|${other}` : `${other}|${noteId}`;
      if (seen.has(key)) continue;

      seen.add(key);
      links.push({ aId: noteId, bId: other, score });
    }
  }

  return { links };
}

function statusPayload() {
  return {
    device,
    modelId: model?.id || null,
    chunks: index.vectors.length,
    notes: noteStamps.size,
  };
}

// ---------------- protocol -----------------------------------------

self.onmessage = async (e) => {
  const msg = e.data || {};
  const { type, reqId } = msg;

  const reply = (payload) => self.postMessage({ reqId, ok: true, ...payload });
  const fail = (err) => {
    console.error('[YANTA Semantic worker]', type, err);
    self.postMessage({
      reqId,
      ok: false,
      error: String(err?.message || err),
    });
  };

  try {
    if (type === 'init') {
      // Concurrent init calls share one promise (settings UI + boot).
      if (!initPromise) {
        initPromise = (async () => {
          await initModel(msg.model, msg.forceDevice || null, (p) => self.postMessage({ type: 'progress', ...p }));
          await loadIndexFromDb();
        })();

        initPromise.catch(() => { initPromise = null; });
      }

      try {
        await initPromise;
      } catch (err) {
        // deviceTried lets the main thread decide on a clean-context
        // WASM retry (fresh worker) after a WebGPU failure.
        self.postMessage({
          reqId,
          ok: false,
          error: String(err?.message || err),
          deviceTried: lastDeviceTried,
        });
        return;
      }

      reply(statusPayload());
      return;
    }

    if (type === 'stamps') {
      reply({ stamps: Object.fromEntries(noteStamps) });
      return;
    }

    if (type === 'sync-note') {
      reply(await handleSyncNote(msg));
      return;
    }

    if (type === 'remove-notes') {
      reply(await handleRemoveNotes(msg));
      return;
    }

    if (type === 'search') {
      reply(await handleSearch(msg));
      return;
    }

    if (type === 'similar-notes') {
      reply(handleSimilarNotes(msg));
      return;
    }

    if (type === 'note-links') {
      reply(handleNoteLinks(msg));
      return;
    }

    if (type === 'status') {
      reply(statusPayload());
      return;
    }

    if (type === 'wipe') {
      await clearAllStores();
      index.keys.length = 0;
      index.noteIds.length = 0;
      index.previews.length = 0;
      index.vectors.length = 0;
      noteStamps.clear();
      reply({});
      return;
    }

    throw new Error(`Unknown message type: ${type}`);
  } catch (err) {
    fail(err);
  }
};

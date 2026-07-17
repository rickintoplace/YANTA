// ============================================================
// YANTA Semantic — settings panel (mounted from settings.js)
//
// One card, one decision: the model download is opt-in and the
// privacy story is stated where the decision happens.
// ============================================================

import {
  el,
  lucide,
  toast,
} from '../core.js';

import {
  getSemanticConfig,
  semanticModelById,
} from './semantic-config.js';

import {
  semanticStatus,
  enableSemantic,
  disableSemantic,
  reindexSemantic,
} from './semantic-index.js';

import {
  yantaConfirm,
} from '../dialogs.js';

function injectCss() {
  if (document.getElementById('yanta-semantic-settings-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-semantic-settings-css';
  style.textContent = `
.yanta-semantic-card {
  display: flex;
  flex-direction: column;
  gap: 12px;

  padding: 14px;

  border: 1px solid var(--border);
  border-radius: 12px;

  background: var(--bg-elev);
}

.yanta-semantic-headline {
  display: flex;
  align-items: center;
  gap: 8px;

  color: var(--text);
  font-size: 13.5px;
  font-weight: 700;
}

.yanta-semantic-headline svg { color: var(--accent); }

.yanta-semantic-copy {
  color: var(--text-dim);
  font-size: 12.5px;
  line-height: 1.55;
}

.yanta-semantic-copy strong { color: var(--text); }

.yanta-semantic-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.yanta-semantic-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  padding: 3px 9px;

  border: 1px solid var(--border);
  border-radius: 999px;

  color: var(--text-dim);
  font-size: 11.5px;
  font-weight: 650;
}

.yanta-semantic-chip svg { color: var(--accent); }

.yanta-semantic-progress {
  height: 6px;

  border-radius: 999px;
  overflow: hidden;

  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.yanta-semantic-progress > i {
  display: block;
  height: 100%;

  border-radius: 999px;
  background: var(--accent);

  transition: width 0.25s ease;
}

.yanta-semantic-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
`;

  document.head.append(style);
}

function deviceLabel(device) {
  if (device === 'webgpu') return 'WebGPU (GPU-accelerated)';
  if (device === 'wasm') return 'WASM (CPU)';
  return null;
}

export function renderSemanticSettingsPanel(mount) {
  injectCss();

  const card = el('div', { class: 'yanta-semantic-card' });
  mount.replaceChildren(card);

  const render = () => {
    const status = semanticStatus();
    const config = getSemanticConfig();
    const model = semanticModelById(config.modelId);

    card.replaceChildren();

    if (!config.enabled) {
      const copy = el('div', { class: 'yanta-semantic-copy' });
      copy.innerHTML = `
        Find notes by <strong>meaning</strong>, not just keywords — across
        languages, including text inside your drawings.
        A one-time model download (${model.sizeHint}) runs the AI
        <strong>entirely on this device</strong>: your notes and your
        searches never leave it, and the index is never synced.
      `;

      const meta = el('div', { class: 'yanta-semantic-meta' });
      meta.append(
        chip('languages', model.languages),
        chip('shield-check', 'On-device only'),
        chip('download', `${model.sizeHint} one-time`),
      );

      const actions = el('div', { class: 'yanta-semantic-actions' });
      const enable = el('button', { class: 'btn primary' }, 'Enable semantic search');

      enable.addEventListener('click', () => {
        enable.disabled = true;

        enableSemantic().catch((err) => {
          console.error(err);
          toast('Could not enable semantic search', 'error');
        });
      });

      actions.append(enable);
      card.append(copy, meta, actions);
      return;
    }

    // ---- enabled states ----

    const copy = el('div', { class: 'yanta-semantic-copy' });

    if (status.state === 'downloading') {
      copy.textContent = `Downloading the model… ${status.downloadPct}% — you can keep working, this happens in the background.`;
    } else if (status.state === 'starting') {
      copy.textContent = 'Starting the on-device model…';
    } else if (status.state === 'indexing') {
      copy.textContent = `Indexing your notes in idle time — ${status.indexedDone} of ${status.indexedTotal} done. YANTA stays fully responsive.`;
    } else if (status.state === 'error') {
      copy.textContent = `Something went wrong: ${status.error || 'unknown error'}. Keyword search keeps working normally.`;
    } else {
      copy.innerHTML = `Ready. Search results now include <strong>Related matches</strong> found by meaning.`;
    }

    card.append(copy);

    if (status.state === 'downloading' || status.state === 'indexing') {
      const bar = el('div', { class: 'yanta-semantic-progress' });
      const fill = document.createElement('i');

      const pct = status.state === 'downloading'
        ? status.downloadPct
        : Math.round((status.indexedDone / Math.max(1, status.indexedTotal)) * 100);

      fill.style.width = `${Math.max(2, pct)}%`;
      bar.append(fill);
      card.append(bar);
    }

    const meta = el('div', { class: 'yanta-semantic-meta' });
    meta.append(chip('languages', model.languages));

    const dev = deviceLabel(status.device);
    if (dev) meta.append(chip(status.device === 'webgpu' ? 'zap' : 'cpu', dev));

    if (status.chunks) {
      meta.append(chip('database', `${status.notes} notes · ${status.chunks} chunks indexed`));
    }

    card.append(meta);

    const actions = el('div', { class: 'yanta-semantic-actions' });

    if (status.state === 'ready' || status.state === 'error') {
      const reindex = el('button', { class: 'btn' }, 'Re-index everything');

      reindex.addEventListener('click', async () => {
        reindex.disabled = true;

        try {
          await reindexSemantic();
        } catch (err) {
          console.error(err);
          toast('Re-index failed', 'error');
        }
      });

      actions.append(reindex);
    }

    const disable = el('button', { class: 'btn' }, 'Disable');

    disable.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: 'Disable semantic search?',
        message: 'The local index is kept, so re-enabling is instant. Keyword search is not affected.',
        confirmLabel: 'Disable',
      });

      if (!ok) return;

      await disableSemantic({ wipe: false });
    });

    const wipeBtn = el('button', { class: 'btn' }, 'Disable & delete index');

    wipeBtn.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: 'Delete the semantic index?',
        message: 'Removes all vectors from this device. The downloaded model stays in the browser cache. Re-enabling will re-index from scratch.',
        confirmLabel: 'Delete & disable',
        danger: true,
      });

      if (!ok) return;

      await disableSemantic({ wipe: true });
    });

    actions.append(disable, wipeBtn);
    card.append(actions);
  };

  function chip(icon, text) {
    const c = el('span', { class: 'yanta-semantic-chip' });
    c.innerHTML = `${lucide(icon, 12)} <span>${text}</span>`;
    return c;
  }

  const onStatus = () => {
    if (!mount.isConnected) {
      window.removeEventListener('yanta-semantic-status', onStatus);
      return;
    }

    render();
  };

  window.addEventListener('yanta-semantic-status', onStatus);
  render();
}

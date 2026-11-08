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
  escapeHtml,
} from '../core.js';

import { t } from '../i18n/index.js';

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
  if (device === 'webgpu') return t('settings.semantic.deviceWebgpu');
  if (device === 'wasm') return t('settings.semantic.deviceWasm');
  return null;
}

// Catalog copy marks emphasis as **…** (the catalogs hold no markup);
// everything else is escaped.
function emphasisHtml(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function modelLanguages(model) {
  return model.languagesKey ? t(model.languagesKey) : model.languages;
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
      copy.innerHTML = emphasisHtml(t('settings.semantic.intro', { size: model.sizeHint }));

      const meta = el('div', { class: 'yanta-semantic-meta' });
      meta.append(
        chip('languages', modelLanguages(model)),
        chip('shield-check', t('settings.semantic.onDeviceOnly')),
        chip('download', t('settings.semantic.oneTime', { size: model.sizeHint })),
      );

      const actions = el('div', { class: 'yanta-semantic-actions' });
      const enable = el('button', { class: 'btn primary' }, t('settings.semantic.enable'));

      enable.addEventListener('click', () => {
        enable.disabled = true;

        enableSemantic().catch((err) => {
          console.error(err);
          toast(t('settings.semantic.enableFailed'), 'error');
        });
      });

      actions.append(enable);
      card.append(copy, meta, actions);
      return;
    }

    // ---- enabled states ----

    const copy = el('div', { class: 'yanta-semantic-copy' });

    if (status.state === 'downloading') {
      copy.textContent = t('settings.semantic.downloading', { pct: status.downloadPct });
    } else if (status.state === 'starting') {
      copy.textContent = t('settings.semantic.starting');
    } else if (status.state === 'indexing') {
      copy.textContent = t('settings.semantic.indexing', { done: status.indexedDone, total: status.indexedTotal });
    } else if (status.state === 'error') {
      copy.textContent = t('settings.semantic.error', { error: status.error || t('settings.semantic.unknownError') });
    } else {
      copy.innerHTML = emphasisHtml(t('settings.semantic.ready', { related: t('tree.section.relatedMatches') }));
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
    meta.append(chip('languages', modelLanguages(model)));

    const dev = deviceLabel(status.device);
    if (dev) meta.append(chip(status.device === 'webgpu' ? 'zap' : 'cpu', dev));

    if (status.chunks) {
      meta.append(chip('database', t('settings.semantic.indexedStats', {
        notes: t('tree.bulk.notesLabel', { count: status.notes }),
        count: status.chunks,
      })));
    }

    card.append(meta);

    const actions = el('div', { class: 'yanta-semantic-actions' });

    if (status.state === 'ready' || status.state === 'error') {
      const reindex = el('button', { class: 'btn' }, t('settings.semantic.reindex'));

      reindex.addEventListener('click', async () => {
        reindex.disabled = true;

        try {
          await reindexSemantic();
        } catch (err) {
          console.error(err);
          toast(t('settings.semantic.reindexFailed'), 'error');
        }
      });

      actions.append(reindex);
    }

    const disable = el('button', { class: 'btn' }, t('settings.semantic.disable'));

    disable.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: t('settings.semantic.disableTitle'),
        message: t('settings.semantic.disableMessage'),
        confirmLabel: t('settings.semantic.disable'),
      });

      if (!ok) return;

      await disableSemantic({ wipe: false });
    });

    const wipeBtn = el('button', { class: 'btn' }, t('settings.semantic.wipe'));

    wipeBtn.addEventListener('click', async () => {
      const ok = await yantaConfirm({
        title: t('settings.semantic.wipeTitle'),
        message: t('settings.semantic.wipeMessage'),
        confirmLabel: t('settings.semantic.wipeConfirm'),
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
    c.innerHTML = `${lucide(icon, 12)} <span>${escapeHtml(text)}</span>`;
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

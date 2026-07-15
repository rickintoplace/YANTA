// ============================================================
// YANTA Sources / RSS — settings panel
// ============================================================

import {
  el,
  escapeHtml,
  lucide,
  toast,
} from '../core.js';

import {
  getRssSettings,
  saveRssSettings,
  getRssFeeds,
  saveRssFeeds,
  deleteRssFeed,
} from './rss-settings.js';

import {
  addBestRssSourceFromInput,
  attachRssSourcePicker,
  openRssSourceBrowser,
} from './rss-source-picker.js';

import {
  getRssCloudAuthState,
  openYantaCloudLoginForSources,
} from './rss-cloud-auth.js';

import {
  parseOpml,
  exportFeedsOpml,
} from './rss-opml.js';

import {
  isDashboardWidgetEnabled,
  setDashboardWidgetEnabled,
} from '../dashboard-widgets.js';

// Ensures the widget is registered before its toggle is shown.
import './rss-dashboard-widget.js';

function injectRssSettingsPanelCss() {
  if (document.getElementById('yanta-rss-settings-panel-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-rss-settings-panel-css';

  style.textContent = `
.yanta-rss-cloud-gate {
  display: flex;
  align-items: flex-start;
  gap: 12px;

  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
  border-radius: 14px;

  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
  color: var(--text);
}

.yanta-rss-cloud-gate-icon {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.yanta-rss-cloud-gate-main {
  flex: 1;
  min-width: 0;
}

.yanta-rss-cloud-gate-main strong {
  display: block;
  color: var(--text);
  font-size: 14px;
  margin-bottom: 4px;
}

.yanta-rss-cloud-gate-main p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-rss-cloud-gate-main small {
  display: block;
  margin-top: 8px;
  color: var(--yellow);
  font-size: 11px;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .yanta-rss-cloud-gate {
    flex-direction: column;
  }

  .yanta-rss-cloud-gate .btn {
    width: 100%;
    justify-content: center;
  }
}
  `;

  document.head.append(style);
}

function boolToggle({
  checked,
  label,
  hint,
  onChange,
}) {
  const row = el('label', { class: 'yanta-settings-toggle' });
  const cb = el('input', { type: 'checkbox' });

  cb.checked = !!checked;

  cb.addEventListener('change', () => onChange?.(cb.checked));

  row.append(
    cb,
    el('div', { class: 'yanta-settings-toggle-meta' },
      el('div', { class: 'yanta-settings-toggle-label' }, label),
      el('div', { class: 'yanta-settings-toggle-hint' }, hint),
    )
  );

  return row;
}

function renderCloudGate({
  error = '',
  onLogin,
} = {}) {
  const gate = el('div', { class: 'yanta-settings-group' });

  gate.innerHTML = `
    <div class="yanta-rss-cloud-gate">
      <div class="yanta-rss-cloud-gate-icon">
        ${lucide('cloud', 22)}
      </div>

      <div class="yanta-rss-cloud-gate-main">
        <strong>Sign in to YANTA Cloud to use Sources</strong>
        <p>
          Sources uses YANTA Cloud for feed discovery and fetching.
          This avoids browser CORS problems and protects feed/image requests.
        </p>
        ${
          error
            ? `<small>${escapeHtml(error)}</small>`
            : ''
        }
      </div>

      <button class="btn primary" data-rss-cloud-login>
        ${lucide('log-in', 14)}
        Sign in
      </button>
    </div>
  `;

  gate.querySelector('[data-rss-cloud-login]')?.addEventListener('click', async () => {
    await onLogin?.();
  });

  return gate;
}

export async function renderRssSettingsPanel(host) {
  if (!host) return;

  injectRssSettingsPanelCss();

  const settings = await getRssSettings();
  const feeds = await getRssFeeds();

  const cloudAuth = settings.fetchProvider === 'yanta-cloud'
    ? await getRssCloudAuthState()
    : {
        authenticated: true,
        error: '',
      };

  host.replaceChildren();

  if (settings.fetchProvider === 'yanta-cloud' && !cloudAuth.authenticated) {
    host.append(renderCloudGate({
      error: cloudAuth.error,
      onLogin: async () => {
        try {
          await openYantaCloudLoginForSources();
          await renderRssSettingsPanel(host);
        } catch (err) {
          toast(err?.message || 'Could not open YANTA Cloud login', 'error');
        }
      },
    }));

    return;
  }

  const addBox = el('div', { class: 'yanta-settings-group' });
  addBox.append(el('div', { class: 'yanta-settings-group-title' }, 'Add Source'));

  const input = el('input', {
    class: 'text-input',
    placeholder: 'Search or paste website/feed URL…',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const addBtn = el('button', { class: 'btn primary' });
  addBtn.innerHTML = `${lucide('rss', 14)} Add Source`;

  const browseBtn = el('button', { class: 'btn' });
  browseBtn.innerHTML = `${lucide('layout-grid', 14)} Browse`;

  browseBtn.addEventListener('click', async () => {
    await openRssSourceBrowser({
      onAdded: async () => {
        await renderRssSettingsPanel(host);
      },
    });
  });

  const runAdd = async () => {
    const value = input.value.trim();

    if (!value) return;

    addBtn.disabled = true;
    input.disabled = true;

    try {
      await addBestRssSourceFromInput(value, {
        onAdded: async () => {
          input.value = '';
        },
      });

      await renderRssSettingsPanel(host);
    } catch (err) {
      toast(err?.message || 'Could not add source', 'error');
    } finally {
      addBtn.disabled = false;
      input.disabled = false;
    }
  };

  addBtn.addEventListener('click', runAdd);

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    e.preventDefault();
    runAdd();
  });

  attachRssSourcePicker(input, {
    onAdded: async () => {
      input.value = '';
      await renderRssSettingsPanel(host);
    },
  });

  const row = el('div', {
    class: 'compress-actions',
    style: {
      justifyContent: 'flex-start',
    },
  });

  row.append(input, addBtn, browseBtn);
  addBox.append(row);
  host.append(addBox);

  const privacy = el('div', { class: 'yanta-settings-group' });
  privacy.append(el('div', { class: 'yanta-settings-group-title' }, 'Privacy & Images'));

  privacy.append(
    boolToggle({
      checked: settings.showImages,
      label: 'Show images by default',
      hint: 'Images are stored as URLs only. They do not consume YANTA Cloud storage.',
      onChange: async (checked) => {
        await saveRssSettings({ showImages: checked });
        toast('Sources setting saved', 'success');
      },
    }),

    boolToggle({
      checked: settings.useImageProxy,
      label: 'Use privacy-protected image loading',
      hint: 'Loads feed images through YANTA Cloud without cookies or referrer. Protects privacy but uses bandwidth.',
      onChange: async (checked) => {
        await saveRssSettings({ useImageProxy: checked });
        toast('Sources setting saved', 'success');
      },
    }),

    boolToggle({
      checked: settings.stripTrackingParams,
      label: 'Strip tracking parameters from saved links',
      hint: 'Removes common utm/fbclid/gclid tracking parameters from RSS item links.',
      onChange: async (checked) => {
        await saveRssSettings({ stripTrackingParams: checked });
        toast('Sources setting saved', 'success');
      },
    })
  );

  host.append(privacy);

  const dashboardGroup = el('div', { class: 'yanta-settings-group' });
  dashboardGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Dashboard'));

  dashboardGroup.append(
    boolToggle({
      checked: await isDashboardWidgetEnabled('rss-latest'),
      label: 'Show "New from your sources" on the dashboard',
      hint: 'A compact strip of unread items. Pick which sources appear via the widget’s gear icon.',
      onChange: async (checked) => {
        await setDashboardWidgetEnabled('rss-latest', checked);
        toast('Sources setting saved', 'success');
      },
    })
  );

  host.append(dashboardGroup);

  const refresh = el('div', { class: 'yanta-settings-group' });
  refresh.append(el('div', { class: 'yanta-settings-group-title' }, 'Refresh'));

  const interval = el('input', {
    class: 'text-input',
    type: 'number',
    min: '5',
    max: '1440',
    value: String(settings.minRefreshIntervalMinutes),
  });

  interval.addEventListener('change', async () => {
    await saveRssSettings({
      minRefreshIntervalMinutes: Number(interval.value || 30),
    });

    toast('Refresh interval saved', 'success');
  });

  refresh.append(
    boolToggle({
      checked: settings.refreshOnStartup,
      label: 'Refresh sources when YANTA opens',
      hint: 'Only refreshes feeds older than the minimum refresh interval.',
      onChange: async (checked) => {
        await saveRssSettings({ refreshOnStartup: checked });
        toast('Sources setting saved', 'success');
      },
    }),

    el('label', { class: 'yanta-settings-field' },
      el('div', { class: 'yanta-settings-field-label' }, 'Minimum refresh interval in minutes'),
      interval,
      el('div', { class: 'yanta-settings-field-hint' }, 'Lower values mean more network requests. Recommended: 30 minutes.')
    )
  );

  host.append(refresh);

  const opml = el('div', { class: 'yanta-settings-group' });
  opml.append(el('div', { class: 'yanta-settings-group-title' }, 'OPML'));

  const importBtn = el('button', { class: 'btn' });
  importBtn.innerHTML = `${lucide('upload', 14)} Import OPML`;

  importBtn.addEventListener('click', () => {
    const picker = document.createElement('input');

    picker.type = 'file';
    picker.accept = '.opml,text/x-opml,text/xml,application/xml';

    picker.onchange = async () => {
      const file = picker.files?.[0];

      if (!file) return;

      try {
        const parsed = parseOpml(await file.text());
        const existing = await getRssFeeds();

        await saveRssFeeds([
          ...existing,
          ...parsed.map((f) => ({
            ...f,
            icon: 'rss',
            color: '#f59e0b',
            enabled: true,
          })),
        ]);

        toast(`Imported ${parsed.length} source${parsed.length === 1 ? '' : 's'}`, 'success');

        await renderRssSettingsPanel(host);
      } catch (err) {
        toast(err?.message || 'OPML import failed', 'error');
      }
    };

    picker.click();
  });

  const exportBtn = el('button', { class: 'btn' });
  exportBtn.innerHTML = `${lucide('download', 14)} Export OPML`;

  exportBtn.addEventListener('click', async () => {
    exportFeedsOpml(await getRssFeeds());
  });

  const opmlActions = el('div', {
    class: 'compress-actions',
    style: {
      justifyContent: 'flex-start',
    },
  });

  opmlActions.append(importBtn, exportBtn);
  opml.append(opmlActions);
  host.append(opml);

  const list = el('div', { class: 'yanta-settings-group' });
  list.append(el('div', { class: 'yanta-settings-group-title' }, 'Sources'));

  if (!feeds.length) {
    list.append(el('div', { class: 'tree-empty' }, 'No sources yet.'));
  }

  for (const feed of feeds) {
    const row = el('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '8px',
        alignItems: 'center',
        padding: '9px 10px',
        border: '1px solid var(--border)',
        borderRadius: '9px',
        background: 'var(--bg-elev-2)',
        marginBottom: '7px',
      },
    });

    const meta = el('div', {});

    meta.innerHTML = `
      <strong style="font-size:13px;color:var(--text)">${escapeHtml(feed.title)}</strong>
      <div style="font-size:11px;color:var(--text-faint);overflow-wrap:anywhere">${escapeHtml(feed.feedUrl)}</div>
      ${feed.lastError ? `<div style="font-size:11px;color:var(--red)">${escapeHtml(feed.lastError)}</div>` : ''}
    `;

    const remove = el('button', { class: 'btn danger' }, 'Remove');

    remove.addEventListener('click', async () => {
      await deleteRssFeed(feed.id);

      toast('Source removed', 'success');
      await renderRssSettingsPanel(host);
    });

    row.append(meta, remove);
    list.append(row);
  }

  host.append(list);
}
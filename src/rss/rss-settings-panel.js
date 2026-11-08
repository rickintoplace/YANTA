// ============================================================
// YANTA Sources / RSS — settings panel
// ============================================================

import {
  el,
  escapeHtml,
  lucide,
  toast,
  actionToast,
} from '../core.js';

import { t } from '../i18n/index.js';

import {
  getRssSettings,
  saveRssSettings,
  getRssFeeds,
  saveRssFeeds,
} from './rss-settings.js';

import {
  removeRssSource,
  restoreRssSource,
} from './rss-actions.js';

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
        <strong>${escapeHtml(t('rss.settings.gateTitle'))}</strong>
        <p>
          ${escapeHtml(t('rss.settings.gateText'))}
        </p>
        ${
          error
            ? `<small>${escapeHtml(error)}</small>`
            : ''
        }
      </div>

      <button class="btn primary" data-rss-cloud-login>
        ${lucide('log-in', 14)}
        ${escapeHtml(t('rss.settings.signIn'))}
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
          toast(err?.message || t('rss.settings.loginFailed'), 'error');
        }
      },
    }));

    return;
  }

  const addBox = el('div', { class: 'yanta-settings-group' });
  addBox.append(el('div', { class: 'yanta-settings-group-title' }, t('rss.settings.addTitle')));

  const input = el('input', {
    class: 'text-input',
    placeholder: t('rss.settings.addPlaceholder'),
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const addBtn = el('button', { class: 'btn primary' });
  addBtn.innerHTML = `${lucide('rss', 14)} ${escapeHtml(t('rss.settings.addTitle'))}`;

  const browseBtn = el('button', { class: 'btn' });
  browseBtn.innerHTML = `${lucide('layout-grid', 14)} ${escapeHtml(t('rss.settings.browse'))}`;

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
      toast(err?.message || t('rss.settings.addFailed'), 'error');
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
  privacy.append(el('div', { class: 'yanta-settings-group-title' }, t('rss.settings.privacyTitle')));

  privacy.append(
    boolToggle({
      checked: settings.showImages,
      label: t('rss.settings.showImages'),
      hint: t('rss.settings.showImagesHint'),
      onChange: async (checked) => {
        await saveRssSettings({ showImages: checked });
        toast(t('rss.settings.saved'), 'success');
      },
    }),

    boolToggle({
      checked: settings.useImageProxy,
      label: t('rss.settings.imageProxy'),
      hint: t('rss.settings.imageProxyHint'),
      onChange: async (checked) => {
        await saveRssSettings({ useImageProxy: checked });
        toast(t('rss.settings.saved'), 'success');
      },
    }),

    boolToggle({
      checked: settings.stripTrackingParams,
      label: t('rss.settings.stripTracking'),
      hint: t('rss.settings.stripTrackingHint'),
      onChange: async (checked) => {
        await saveRssSettings({ stripTrackingParams: checked });
        toast(t('rss.settings.saved'), 'success');
      },
    })
  );

  host.append(privacy);

  const dashboardGroup = el('div', { class: 'yanta-settings-group' });
  dashboardGroup.append(el('div', { class: 'yanta-settings-group-title' }, t('rss.settings.dashboardTitle')));

  dashboardGroup.append(
    boolToggle({
      checked: await isDashboardWidgetEnabled('rss-latest'),
      label: t('rss.settings.dashboardWidget'),
      hint: t('rss.settings.dashboardWidgetHint'),
      onChange: async (checked) => {
        await setDashboardWidgetEnabled('rss-latest', checked);
        toast(t('rss.settings.saved'), 'success');
      },
    })
  );

  host.append(dashboardGroup);

  const refresh = el('div', { class: 'yanta-settings-group' });
  refresh.append(el('div', { class: 'yanta-settings-group-title' }, t('rss.settings.refreshTitle')));

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

    toast(t('rss.settings.intervalSaved'), 'success');
  });

  refresh.append(
    boolToggle({
      checked: settings.refreshOnStartup,
      label: t('rss.settings.refreshOnStartup'),
      hint: t('rss.settings.refreshOnStartupHint'),
      onChange: async (checked) => {
        await saveRssSettings({ refreshOnStartup: checked });
        toast(t('rss.settings.saved'), 'success');
      },
    }),

    el('label', { class: 'yanta-settings-field' },
      el('div', { class: 'yanta-settings-field-label' }, t('rss.settings.minInterval')),
      interval,
      el('div', { class: 'yanta-settings-field-hint' }, t('rss.settings.minIntervalHint'))
    )
  );

  host.append(refresh);

  const opml = el('div', { class: 'yanta-settings-group' });
  opml.append(el('div', { class: 'yanta-settings-group-title' }, 'OPML'));

  const importBtn = el('button', { class: 'btn' });
  importBtn.innerHTML = `${lucide('upload', 14)} ${escapeHtml(t('rss.settings.importOpml'))}`;

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

        toast(t('rss.settings.imported', { count: parsed.length }), 'success');

        await renderRssSettingsPanel(host);
      } catch (err) {
        toast(err?.message || t('rss.settings.importFailed'), 'error');
      }
    };

    picker.click();
  });

  const exportBtn = el('button', { class: 'btn' });
  exportBtn.innerHTML = `${lucide('download', 14)} ${escapeHtml(t('rss.settings.exportOpml'))}`;

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
  list.append(el('div', { class: 'yanta-settings-group-title' }, t('rss.settings.sourcesTitle')));

  if (!feeds.length) {
    list.append(el('div', { class: 'tree-empty' }, t('rss.settings.noSources')));
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

    const remove = el('button', { class: 'btn danger' }, t('rss.settings.remove'));

    remove.addEventListener('click', async () => {
      const { undo } = await removeRssSource(feed.id);

      await renderRssSettingsPanel(host);

      actionToast(t('rss.removed', { title: feed.title || t('rssWidget.sourceFallback') }), {
        actionLabel: t('common.undo'),
        onAction: async () => {
          await restoreRssSource(undo);
          await renderRssSettingsPanel(host);
        },
      });
    });

    row.append(meta, remove);
    list.append(row);
  }

  host.append(list);
}
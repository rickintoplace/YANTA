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
    addRssFeedFromUrl,
  } from './rss-actions.js';
  
  import {
    parseOpml,
    exportFeedsOpml,
  } from './rss-opml.js';
  
  function boolToggle({ checked, label, hint, onChange }) {
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
  
  export async function renderRssSettingsPanel(host) {
    if (!host) return;
  
    const settings = await getRssSettings();
    const feeds = await getRssFeeds();
  
    host.replaceChildren();
  
    const addBox = el('div', { class: 'yanta-settings-group' });
    addBox.append(el('div', { class: 'yanta-settings-group-title' }, 'Add Source'));
  
    const input = el('input', {
      class: 'text-input',
      placeholder: 'Paste website or feed URL…',
      autocomplete: 'off',
      spellcheck: 'false',
    });
  
    const addBtn = el('button', { class: 'btn primary' });
    addBtn.innerHTML = `${lucide('rss', 14)} Add Source`;
  
    addBtn.addEventListener('click', async () => {
      const url = input.value.trim();
      if (!url) return;
  
      addBtn.disabled = true;
  
      try {
        await addRssFeedFromUrl(url);
        toast('Source added', 'success');
        await renderRssSettingsPanel(host);
      } catch (err) {
        toast(err?.message || 'Could not add source', 'error');
      } finally {
        addBtn.disabled = false;
      }
    });
  
    const row = el('div', { class: 'compress-actions', style: { justifyContent: 'flex-start' } });
    row.append(input, addBtn);
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
  
    const opmlActions = el('div', { class: 'compress-actions', style: { justifyContent: 'flex-start' } });
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
// ============================================================
// YANTA RSS — dashboard widget ("New from your sources")
//
// A compact strip of unread source items on the dashboard root.
// Feed selection is configurable (gear popover); tags act as a
// quick way to toggle whole groups of feeds. The widget hides
// itself entirely when there is nothing new — the dashboard stays
// calm by default.
// ============================================================

import {
  el,
  lucide,
  store,
  toast,
  escapeHtml,
} from '../core.js';

import { registerDashboardWidget } from '../dashboard-widgets.js';

import {
  getRssSettings,
  getRssFeeds,
  rssTagCountsFromFeeds,
} from './rss-settings.js';

import { listRssItems } from './rss-store.js';
import { rssImageProxyUrl } from './rss-fetcher.js';
import { openRssItemContextMenu } from './rss-item-menu.js';

const WIDGET_SETTING = 'rss.dashboardWidget.v1';
const MAX_ITEMS = 8;

export async function getRssDashboardWidgetConfig() {
  return getWidgetConfig();
}

export async function saveRssDashboardWidgetConfig(patch = {}) {
  await saveWidgetConfig(patch);
}

async function getWidgetConfig() {
  const raw = await store.settings.get(WIDGET_SETTING, {});

  return {
    enabled: raw?.enabled !== false,
    // Empty array = all feeds.
    feedIds: Array.isArray(raw?.feedIds) ? raw.feedIds.filter(Boolean) : [],
  };
}

async function saveWidgetConfig(patch = {}) {
  const current = await getWidgetConfig();

  await store.settings.set(WIDGET_SETTING, {
    ...current,
    ...patch,
  });
}

function relativeTime(ts) {
  const ms = Date.now() - Number(ts || 0);
  if (!ts || ms < 0) return '';

  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;

  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(ts).toLocaleDateString();
}

function injectCss() {
  if (document.getElementById('yanta-rss-dash-widget-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-rss-dash-widget-css';
  style.textContent = `
.yanta-dashboard-widgets {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.yanta-dashboard-widgets:not(:empty) {
  margin-block-end: 6px;
}

.yanta-dash-widget {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev);
  overflow: hidden;
}

.yanta-dash-widget-head {
  display: flex;
  align-items: center;
  gap: 8px;

  min-height: 40px;
  padding: 6px 8px 6px 12px;

  border-bottom: 1px solid var(--border);
}

.yanta-dash-widget-head > svg {
  color: var(--accent);
  flex: 0 0 auto;
}

.yanta-dash-widget-title {
  color: var(--text);
  font-size: 13px;
  font-weight: 750;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yanta-dash-widget-count {
  flex: 0 0 auto;

  min-width: 20px;
  padding: 1px 7px;

  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);

  font-size: 11px;
  font-weight: 750;
  text-align: center;
}

.yanta-dash-widget-spacer {
  flex: 1;
}

.yanta-dash-widget-head .icon-btn {
  width: 30px;
  height: 30px;
  color: var(--text-dim);
}

.yanta-dash-widget-scroll {
  display: flex;
  gap: 10px;

  padding: 12px;

  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
}

.yanta-rss-dash-card {
  flex: 0 0 220px;

  display: flex;
  flex-direction: column;

  border: 1px solid var(--border);
  border-radius: 11px;

  background: var(--bg);

  overflow: hidden;
  cursor: pointer;
  text-align: left;
}

.yanta-rss-dash-card:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

.yanta-rss-dash-thumb {
  height: 92px;

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--text-faint);
  background: var(--bg-elev-2, var(--bg-elev));

  overflow: hidden;
}

.yanta-rss-dash-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.yanta-rss-dash-main {
  display: flex;
  flex-direction: column;
  gap: 4px;

  padding: 9px 11px 10px;
}

.yanta-rss-dash-title {
  color: var(--text);

  font-size: 12.5px;
  font-weight: 650;
  line-height: 1.35;

  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.yanta-rss-dash-meta {
  color: var(--text-faint);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yanta-rss-dash-config {
  position: absolute;
  z-index: 60;

  width: min(320px, calc(100vw - 24px));
  max-height: 340px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  padding: 12px;

  border: 1px solid var(--border);
  border-radius: 12px;

  background: var(--bg-elev-3, var(--bg-elev));
  box-shadow: 0 16px 48px rgba(0,0,0,0.28);
}

.yanta-rss-dash-config h5 {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 750;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.yanta-rss-dash-config-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.yanta-rss-dash-config-tags button {
  min-height: 24px;
  padding: 2px 9px;

  border: 1px solid var(--border);
  border-radius: 999px;

  background: transparent;
  color: var(--text-dim);

  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.yanta-rss-dash-config-feeds {
  overflow-y: auto;

  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-rss-dash-config-feeds label {
  display: flex;
  align-items: center;
  gap: 8px;

  padding: 5px 6px;
  border-radius: 7px;

  color: var(--text);
  font-size: 12.5px;

  cursor: pointer;
}

.yanta-rss-dash-config-feeds label:hover {
  background: var(--bg-elev-2, var(--bg-elev));
}

.yanta-rss-dash-config-feeds input {
  accent-color: var(--accent);
}

.yanta-rss-dash-config-foot {
  display: flex;
  align-items: center;
  gap: 8px;

  padding-top: 4px;
  border-top: 1px solid var(--border);
}
`;

  document.head.append(style);
}

async function collectItems(config) {
  const feeds = await getRssFeeds();
  if (!feeds.length) return { feeds, items: [] };

  const allowed = config.feedIds.length
    ? new Set(config.feedIds)
    : null;

  const items = (await listRssItems({ unreadOnly: true, limit: 120 }))
    .filter((item) => !allowed || allowed.has(item.feedId))
    .slice(0, MAX_ITEMS);

  return { feeds, items };
}

async function buildCard(item) {
  const card = el('div', {
    class: 'yanta-rss-dash-card',
    role: 'button',
    tabindex: '0',
  });

  const openItem = () => {
    window.dispatchEvent(new CustomEvent('yanta-open-rss-item', {
      detail: { itemId: item.id },
    }));
  };

  card.addEventListener('click', openItem);

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openItem();
    }
  });

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    openRssItemContextMenu({
      x: e.clientX,
      y: e.clientY,
      item,
      onOpen: openItem,
    }).catch(() => {});
  });

  const thumb = el('div', { class: 'yanta-rss-dash-thumb' });

  if (item.imageUrl) {
    try {
      const src = await rssImageProxyUrl(item.imageUrl);

      if (src) {
        const img = el('img', {
          src,
          alt: '',
          loading: 'lazy',
          referrerpolicy: 'no-referrer',
        });

        img.addEventListener('error', () => {
          thumb.innerHTML = lucide('rss', 22);
        });

        thumb.append(img);
      }
    } catch {}
  }

  if (!thumb.childElementCount) {
    thumb.innerHTML = lucide('rss', 22);
  }

  const meta = [
    item.feedTitle || 'Source',
    relativeTime(item.publishedAt || item.discoveredAt),
  ].filter(Boolean).join(' · ');

  card.append(
    thumb,
    el('div', { class: 'yanta-rss-dash-main' },
      el('div', { class: 'yanta-rss-dash-title' }, item.title || 'Untitled'),
      el('div', { class: 'yanta-rss-dash-meta' }, meta)
    )
  );

  return card;
}

function openConfigPopover(anchor, { feeds, config, onSaved }) {
  document.querySelector('.yanta-rss-dash-config')?.remove();

  const panel = el('div', { class: 'yanta-rss-dash-config' });

  // Empty selection means "all feeds" — materialize it for editing.
  const selected = new Set(config.feedIds.length ? config.feedIds : feeds.map((f) => f.id));

  const tags = rssTagCountsFromFeeds(feeds).map((entry) => entry.tag);

  if (tags.length) {
    panel.append(el('h5', {}, 'Toggle by tag'));

    const tagRow = el('div', { class: 'yanta-rss-dash-config-tags' });

    for (const tag of tags) {
      const chip = el('button', { type: 'button' }, `#${tag}`);

      chip.addEventListener('click', () => {
        const tagged = feeds.filter((f) => (f.tags || []).includes(tag));
        const allSelected = tagged.every((f) => selected.has(f.id));

        for (const feed of tagged) {
          if (allSelected) selected.delete(feed.id);
          else selected.add(feed.id);
        }

        panel.querySelectorAll('[data-feed-id]').forEach((input) => {
          input.checked = selected.has(input.dataset.feedId);
        });
      });

      tagRow.append(chip);
    }

    panel.append(tagRow);
  }

  panel.append(el('h5', {}, 'Sources'));

  const list = el('div', { class: 'yanta-rss-dash-config-feeds' });

  for (const feed of feeds) {
    const label = el('label');

    const input = el('input', {
      type: 'checkbox',
      dataset: { feedId: feed.id },
    });

    input.checked = selected.has(feed.id);

    input.addEventListener('change', () => {
      if (input.checked) selected.add(feed.id);
      else selected.delete(feed.id);
    });

    label.append(input, document.createTextNode(feed.title || feed.feedUrl));
    list.append(label);
  }

  panel.append(list);

  const foot = el('div', { class: 'yanta-rss-dash-config-foot' });

  const hide = el('button', { class: 'btn' }, 'Hide widget');

  hide.addEventListener('click', async () => {
    await saveWidgetConfig({ enabled: false });
    panel.remove();
    toast('Widget hidden — re-enable it in Sources settings');
    onSaved?.();
  });

  const apply = el('button', { class: 'btn primary' }, 'Apply');

  apply.addEventListener('click', async () => {
    const all = selected.size >= feeds.length;

    await saveWidgetConfig({
      feedIds: all ? [] : [...selected],
    });

    panel.remove();
    onSaved?.();
  });

  foot.append(hide, el('span', { class: 'yanta-dash-widget-spacer' }), apply);
  panel.append(foot);

  // Position below the gear, clamped to the viewport.
  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 6}px`;
  panel.style.right = `${Math.max(10, window.innerWidth - rect.right)}px`;
  panel.style.position = 'fixed';

  document.body.append(panel);

  const close = (e) => {
    if (panel.contains(e.target) || e.target === anchor || anchor.contains(e.target)) return;
    panel.remove();
    document.removeEventListener('pointerdown', close, true);
  };

  document.addEventListener('pointerdown', close, true);
}

async function renderWidgetContent(section) {
  const config = await getWidgetConfig();

  if (!config.enabled) {
    section.hidden = true;
    section.replaceChildren();
    return;
  }

  const { feeds, items } = await collectItems(config);

  if (!items.length) {
    section.hidden = true;
    section.replaceChildren();
    return;
  }

  section.hidden = false;

  const head = el('div', { class: 'yanta-dash-widget-head' });
  head.innerHTML = `
    ${lucide('rss', 15)}
    <span class="yanta-dash-widget-title">New from your sources</span>
    <span class="yanta-dash-widget-count">${escapeHtml(String(items.length))}</span>
    <span class="yanta-dash-widget-spacer"></span>
    <button class="icon-btn" data-widget-config title="Choose sources">${lucide('settings-2', 15)}</button>
    <button class="icon-btn" data-widget-open title="Open Sources">${lucide('arrow-right', 15)}</button>
  `;

  head.querySelector('[data-widget-open]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('yanta-open-rss'));
  });

  head.querySelector('[data-widget-config]')?.addEventListener('click', (e) => {
    openConfigPopover(e.currentTarget, {
      feeds,
      config,
      onSaved: () => renderWidgetContent(section).catch(() => {}),
    });
  });

  const scroll = el('div', { class: 'yanta-dash-widget-scroll' });

  for (const item of items) {
    scroll.append(await buildCard(item));
  }

  section.replaceChildren(head, scroll);
}

async function renderRssWidget() {
  const settings = await getRssSettings();
  if (!settings.enabled) return null;

  const config = await getWidgetConfig();
  if (!config.enabled) return null;

  const feeds = await getRssFeeds();
  if (!feeds.length) return null;

  injectCss();

  const section = el('section', {
    class: 'yanta-dash-widget yanta-dash-widget-rss',
  });

  // The widget keeps itself fresh: the dashboard's structure cache
  // intentionally does not re-render widgets on every pass.
  const onRssUpdated = () => {
    if (!section.isConnected) {
      window.removeEventListener('yanta-rss-updated', onRssUpdated);
      return;
    }

    renderWidgetContent(section).catch(() => {});
  };

  window.addEventListener('yanta-rss-updated', onRssUpdated);

  await renderWidgetContent(section);

  return section;
}

registerDashboardWidget({
  id: 'rss-latest',
  order: 10,
  render: renderRssWidget,
});

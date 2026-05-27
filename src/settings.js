// ============================================================
// YANTA — Settings: appearance (themes, colors, fonts), persistence.
// Settings live in two scopes:
//   - device-only: localStorage (not synced, not exported)
//   - synced:     IndexedDB settings store (included in sync + exports)
// Users can toggle "this device only" per settings group.
// ============================================================

import { $, el, state, store, toast, lucide, safeCssColor, cssColorToHex } from './core.js';

// ----------------------------------------------------------------
// Theme tokens — these map 1:1 to CSS custom properties.
// Each has a default for dark + light mode.
// ----------------------------------------------------------------

export const COLOR_TOKENS = [
  // Backgrounds
  { key: 'bg',           label: 'Background',           group: 'Backgrounds' },
  { key: 'bg-elev',      label: 'Surface',              group: 'Backgrounds' },
  { key: 'bg-elev-2',    label: 'Surface (hover)',      group: 'Backgrounds' },
  { key: 'bg-elev-3',    label: 'Surface (raised)',     group: 'Backgrounds' },

  // Borders
  { key: 'border',        label: 'Border',              group: 'Borders' },
  { key: 'border-strong', label: 'Border (strong)',     group: 'Borders' },

  // Text
  { key: 'text',       label: 'Text',          group: 'Text' },
  { key: 'text-dim',   label: 'Text (dim)',    group: 'Text' },
  { key: 'text-faint', label: 'Text (faint)',  group: 'Text' },

  // Accents
  { key: 'accent',   label: 'Accent (primary)',   group: 'Accents' },
  { key: 'accent-2', label: 'Accent (secondary)', group: 'Accents' },

  // Semantic
  { key: 'green',  label: 'Success', group: 'Semantic' },
  { key: 'yellow', label: 'Warning', group: 'Semantic' },
  { key: 'red',    label: 'Danger',  group: 'Semantic' },

  // Selection
  { key: 'selection', label: 'Text selection', group: 'Selection' },
];

// Neutral, AI-slop-free defaults.
// Dark: warm-neutral grays (no blue tint), accent retained.
// Light: clean off-white with subtle warmth.
export const DEFAULT_THEMES = {
  dark: {
    'bg':            '#141414',
    'bg-elev':       '#1c1c1c',
    'bg-elev-2':     '#242424',
    'bg-elev-3':     '#2e2e2e',
    'border':        '#333333',
    'border-strong': '#454545',
    'text':          '#e8e6e3',
    'text-dim':      '#9a9794',
    'text-faint':    '#6b6864',
    'accent':        '#6ea8fe',
    'accent-2':      '#a78bfa',
    'green':         '#4ade80',
    'yellow':        '#fbbf24',
    'red':           '#f87171',
    'selection':     'rgba(110, 168, 254, 0.28)',
  },
  light: {
    'bg':            '#fdfcfa',
    'bg-elev':       '#f5f4f1',
    'bg-elev-2':     '#ecebe7',
    'bg-elev-3':     '#e2e0dc',
    'border':        '#d6d4ce',
    'border-strong': '#b5b2ab',
    'text':          '#1f1e1c',
    'text-dim':      '#5a5854',
    'text-faint':    '#8a8884',
    'accent':        '#2563eb',
    'accent-2':      '#7c3aed',
    'green':         '#16a34a',
    'yellow':        '#d97706',
    'red':           '#dc2626',
    'selection':     'rgba(37, 99, 235, 0.22)',
  },
};

// Font stacks the user can pick from.
export const FONT_OPTIONS = [
  { id: 'system',     label: 'System sans',        stack: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  { id: 'inter',      label: 'Inter',              stack: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { id: 'serif',      label: 'Serif',              stack: 'Georgia, "Times New Roman", "Iowan Old Style", serif' },
  { id: 'merriweather', label: 'Merriweather-ish', stack: '"Charter", "Iowan Old Style", "Apple Garamond", Georgia, serif' },
  { id: 'humanist',   label: 'Humanist',           stack: 'Optima, Candara, "Trebuchet MS", sans-serif' },
  { id: 'rounded',    label: 'Rounded',            stack: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif' },
];

export const MONO_OPTIONS = [
  { id: 'system',   label: 'System mono',  stack: 'ui-monospace, SFMono-Regular, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace' },
  { id: 'jetbrains', label: 'JetBrains-ish', stack: '"JetBrains Mono", "Fira Code", ui-monospace, monospace' },
  { id: 'fira',     label: 'Fira-ish',     stack: '"Fira Code", "JetBrains Mono", ui-monospace, monospace' },
  { id: 'iaWriter', label: 'iA Writer-ish', stack: '"iA Writer Mono S", "iA Writer Duo S", "JetBrains Mono", ui-monospace, monospace' },
];

export const FONT_SIZES = [
  { id: 'sm', label: 'Small',   px: 13 },
  { id: 'md', label: 'Medium',  px: 15 },
  { id: 'lg', label: 'Large',   px: 16 },
  { id: 'xl', label: 'X-Large', px: 18 },
];

// ----------------------------------------------------------------
// Storage layer.
//
// Two scopes:
//   - synced: store.settings.set('appearance', { ... })
//   - device: localStorage.setItem('yanta.appearance.device', JSON)
//
// A `deviceOnly` flag in each settings group decides which scope is used.
// When `deviceOnly` flips, settings move between scopes.
// ----------------------------------------------------------------

const DEVICE_KEY_PREFIX = 'yanta.settings.device.';
const SYNCED_KEY = 'appearance';

const DEFAULT_APPEARANCE = {
  deviceOnly: false,
  mode: 'auto',                  // 'auto' | 'dark' | 'light' | 'system-colors'
  fontId: 'system',
  monoId: 'system',
  fontSizeId: 'md',
  lineHeight: 1.7,
  colors: {
    dark:  { ...DEFAULT_THEMES.dark },
    light: { ...DEFAULT_THEMES.light },
  },
};

function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(target[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function readDeviceSettings() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY_PREFIX + 'appearance');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeDeviceSettings(data) {
  try {
    localStorage.setItem(DEVICE_KEY_PREFIX + 'appearance', JSON.stringify(data));
  } catch {}
}

function clearDeviceSettings() {
  try {
    localStorage.removeItem(DEVICE_KEY_PREFIX + 'appearance');
  } catch {}
}

async function readSyncedSettings() {
  try {
    return await store.settings.get(SYNCED_KEY, null);
  } catch {
    return null;
  }
}

async function writeSyncedSettings(data) {
  try {
    await store.settings.set(SYNCED_KEY, data);
  } catch {}
}

async function clearSyncedSettings() {
  try {
    await store.settings.set(SYNCED_KEY, null);
  } catch {}
}

// Current effective appearance settings, kept in memory.
let appearance = deepMerge(DEFAULT_APPEARANCE, {});

export function getAppearance() {
  return deepMerge(DEFAULT_APPEARANCE, appearance);
}

export async function loadAppearance() {
  const deviceData = readDeviceSettings();
  const syncedData = await readSyncedSettings();

  // Legacy migration aus dem alten core.js-theme-System.
  let legacyTheme = null;
  try {
    legacyTheme = await store.settings.get('theme', null);
  } catch {}

  if (deviceData && deviceData.deviceOnly) {
    appearance = deepMerge(DEFAULT_APPEARANCE, deviceData);
  } else if (syncedData) {
    appearance = deepMerge(DEFAULT_APPEARANCE, syncedData);
  } else if (deviceData) {
    appearance = deepMerge(DEFAULT_APPEARANCE, {
      ...deviceData,
      deviceOnly: true,
    });
  } else if (['auto', 'dark', 'light'].includes(legacyTheme)) {
    // Alte Theme-Einstellung übernehmen.
    appearance = deepMerge(DEFAULT_APPEARANCE, {
      mode: legacyTheme,
    });

    await writeSyncedSettings(appearance);
  } else {
    appearance = deepMerge(DEFAULT_APPEARANCE, {});
  }

  applyAppearance();
}

export async function saveAppearance(next, { reason = 'user' } = {}) {
  appearance = deepMerge(appearance, next);

  if (appearance.deviceOnly) {
    writeDeviceSettings(appearance);
    // Also clear synced copy so other devices don't override.
    await clearSyncedSettings();
  } else {
    await writeSyncedSettings(appearance);
    clearDeviceSettings();
  }

  applyAppearance();

  window.dispatchEvent(new CustomEvent('yanta-appearance-changed', {
    detail: { appearance: getAppearance(), reason },
  }));
}

// ----------------------------------------------------------------
// Apply settings to the document.
// ----------------------------------------------------------------

export function resolveEffectiveMode() {
  const mode = appearance.mode || 'auto';
  if (mode === 'dark' || mode === 'light') return mode;
  // 'auto' and 'system-colors' both follow the OS for light/dark.
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

function tryReadSystemAccent() {
  // No reliable cross-browser API; the closest is the user agent's
  // accent-color resolution. We sniff a hidden element styled with
  // accent-color: auto, then read its computed color. Browsers vary;
  // we just return something sensible or null.
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;accent-color:auto;color:AccentColor;';
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    if (c && c !== 'rgb(0, 0, 0)' && c !== 'rgba(0, 0, 0, 0)') return c;
  } catch {}
  return null;
}

export async function cycleAppearanceMode() {
  const order = ['auto', 'dark', 'light'];
  const a = getAppearance();

  const current = order.includes(a.mode) ? a.mode : 'auto';
  const next = order[(order.indexOf(current) + 1) % order.length];

  await saveAppearance({ mode: next });
  toast(`Theme: ${next}`, 'success');
}

export function applyAppearance() {
  const root = document.documentElement;
  const mode = resolveEffectiveMode();

  // WICHTIG:
  // data-theme ist ab jetzt immer der EFFEKTIVE Modus: "dark" oder "light".
  // Die ursprüngliche Einstellung bleibt separat in data-appearance-mode.
  root.dataset.theme = mode;
  root.dataset.appearanceMode = appearance.mode || 'auto';

  // Für Module wie draw.js: auch state.theme ist immer effektiv.
  state.theme = mode;

  const themeBtn = $('btn-theme');
  if (themeBtn) {
    themeBtn.title = `Theme: ${appearance.mode} → ${mode} (click to cycle)`;
  }

  // Color tokens
  const palette = (appearance.colors && appearance.colors[mode]) || DEFAULT_THEMES[mode];
  for (const tok of COLOR_TOKENS) {
    const val = palette[tok.key] || DEFAULT_THEMES[mode][tok.key];
    const safe = tok.key === 'selection' ? val : (safeCssColor(val) || val);
    root.style.setProperty('--' + tok.key, safe);
  }

  // System accent override
  if (appearance.mode === 'system-colors') {
    const sys = tryReadSystemAccent();
    if (sys) {
      root.style.setProperty('--accent', sys);
    }
  }

  // Fonts
  const font = FONT_OPTIONS.find((f) => f.id === appearance.fontId) || FONT_OPTIONS[0];
  const mono = MONO_OPTIONS.find((f) => f.id === appearance.monoId) || MONO_OPTIONS[0];
  root.style.setProperty('--font', font.stack);
  root.style.setProperty('--font-mono', mono.stack);

  const size = FONT_SIZES.find((s) => s.id === appearance.fontSizeId) || FONT_SIZES[1];
  root.style.setProperty('--fs-base', size.px + 'px');

  const lh = Number(appearance.lineHeight) || 1.7;
  root.style.setProperty('--lh-base', String(lh));

  window.dispatchEvent(new CustomEvent('yanta-theme-change', {
    detail: {
      theme: mode,                       // effektiv: "dark" | "light"
      appearanceMode: appearance.mode,   // Einstellung: "auto" | "dark" | ...
      appearance: getAppearance(),
    },
  }));
}

// React to OS theme changes when in 'auto' or 'system-colors' mode.
export function watchSystemTheme() {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (appearance.mode === 'auto' || appearance.mode === 'system-colors') {
        applyAppearance();
      }
    };
    mq.addEventListener?.('change', handler);
  } catch {}
}

// ----------------------------------------------------------------
// Settings modal UI.
// ----------------------------------------------------------------

let modal = null;
let activeSection = 'appearance';

export function openSettings() {
  ensureModal();
  modal.hidden = false;
  renderSettingsBody();
}

export function closeSettings() {
  if (modal) modal.hidden = true;
}

function ensureModal() {
  if (modal) return;

  injectSettingsCss();

  modal = el('div', { class: 'modal yanta-settings-modal', hidden: true });

  const card = el('div', { class: 'modal-card yanta-settings-card' });

  const head = el('header', { class: 'modal-head' },
    el('h3', {}, 'Settings'),
    el('button', { class: 'icon-btn', onclick: closeSettings, title: 'Close' }, '✕'),
  );

  const body = el('div', { class: 'yanta-settings-body' });

  // Left rail: sections
  const rail = el('nav', { class: 'yanta-settings-rail' });
  const sections = [
    { id: 'appearance', label: 'Appearance', icon: 'palette' },
    { id: 'colors',     label: 'Colors',     icon: 'paintbrush' },
    { id: 'typography', label: 'Typography', icon: 'type' },
    { id: 'sync',       label: 'Sync & Backup', icon: 'refresh-cw' },
    { id: 'about',      label: 'About',      icon: 'info' },
  ];

  for (const s of sections) {
    const btn = el('button', {
      class: 'yanta-settings-rail-btn' + (activeSection === s.id ? ' active' : ''),
      dataset: { section: s.id },
      onclick: () => {
        activeSection = s.id;
        renderSettingsBody();
      },
    });
    btn.innerHTML = `${lucide(s.icon, 14)} <span>${s.label}</span>`;
    rail.append(btn);
  }

  const content = el('div', { class: 'yanta-settings-content' });

  body.append(rail, content);
  card.append(head, body);
  modal.append(card);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSettings();
  });

  document.body.append(modal);
}

function rerenderSettingsBody() {
  if (!modal) return;
  renderSettingsBody();
}

function renderSettingsBody() {
  if (!modal) return;

  // Update rail active state
  for (const btn of modal.querySelectorAll('.yanta-settings-rail-btn')) {
    btn.classList.toggle('active', btn.dataset.section === activeSection);
  }

  const content = modal.querySelector('.yanta-settings-content');
  content.replaceChildren();

  if (activeSection === 'appearance') renderAppearanceSection(content);
  else if (activeSection === 'colors') renderColorsSection(content);
  else if (activeSection === 'typography') renderTypographySection(content);
  else if (activeSection === 'sync') renderSyncSection(content);
  else if (activeSection === 'about') renderAboutSection(content);
}

// ---- Appearance section ----
function renderAppearanceSection(host) {
  const a = getAppearance();

  host.append(sectionHeader('Appearance', 'Choose how YANTA looks.'));

  // Mode picker
  const modeGroup = el('div', { class: 'yanta-settings-group' });
  modeGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Theme'));

  const modes = [
    { id: 'auto', label: 'Follow system', hint: 'Match OS light/dark' },
    { id: 'dark', label: 'Dark', hint: 'Always dark' },
    { id: 'light', label: 'Light', hint: 'Always light' },
    { id: 'system-colors', label: 'System colors', hint: 'Follow OS theme + use system accent' },
  ];

  const modeRow = el('div', { class: 'yanta-settings-mode-row' });
  for (const m of modes) {
    const card = el('button', {
      class: 'yanta-settings-mode' + (a.mode === m.id ? ' active' : ''),
onclick: async () => {
  await saveAppearance({ mode: m.id });
  rerenderSettingsBody();
},
    });
    card.innerHTML = `
      <div class="yanta-settings-mode-label">${m.label}</div>
      <div class="yanta-settings-mode-hint">${m.hint}</div>
    `;
    modeRow.append(card);
  }
  modeGroup.append(modeRow);
  host.append(modeGroup);

  // Device-only toggle for appearance
  host.append(renderDeviceOnlyToggle(a));

  // Quick reset
  const reset = el('div', { class: 'yanta-settings-group' });
  reset.append(el('div', { class: 'yanta-settings-group-title' }, 'Reset'));
  reset.append(el('button', {
    class: 'btn',
    onclick: async () => {
      if (!confirm('Reset appearance, colors, and typography to defaults?')) return;
      appearance = deepMerge(DEFAULT_APPEARANCE, { deviceOnly: a.deviceOnly });
      await saveAppearance({}, { reason: 'reset' });
      renderSettingsBody();
      toast('Appearance reset', 'success');
    },
  }, 'Reset all appearance to defaults'));
  host.append(reset);
}

// ---- Colors section ----
function renderColorsSection(host) {
  host.replaceChildren();

  const a = getAppearance();

  host.append(sectionHeader('Colors', 'Customize the color palette. Dark and light modes are configured separately.'));

  // Sub-tabs: dark / light
  const targetMode = host.dataset.colorMode || (resolveEffectiveMode());
  host.dataset.colorMode = targetMode;

  const tabs = el('div', { class: 'yanta-settings-color-tabs' });
  for (const m of ['dark', 'light']) {
    tabs.append(el('button', {
      class: 'yanta-settings-color-tab' + (targetMode === m ? ' active' : ''),
        onclick: () => {
        host.dataset.colorMode = m;
        rerenderSettingsBody();
        },
    }, m === 'dark' ? '🌙 Dark mode' : '☀️ Light mode'));
  }
  host.append(tabs);

  // Grouped color editors
  const grouped = {};
  for (const tok of COLOR_TOKENS) {
    if (!grouped[tok.group]) grouped[tok.group] = [];
    grouped[tok.group].push(tok);
  }

  for (const [groupName, tokens] of Object.entries(grouped)) {
    const groupEl = el('div', { class: 'yanta-settings-group' });
    groupEl.append(el('div', { class: 'yanta-settings-group-title' }, groupName));

    const grid = el('div', { class: 'yanta-settings-color-grid' });

    for (const tok of tokens) {
      const current = a.colors[targetMode]?.[tok.key] || DEFAULT_THEMES[targetMode][tok.key];

      const row = el('div', { class: 'yanta-settings-color-row' });

      const swatch = el('label', { class: 'yanta-settings-swatch' });
      const colorInput = el('input', {
        type: 'color',
        value: cssColorToHex(current) || '#000000',
      });
      colorInput.addEventListener('input', () => {
        updateColorToken(targetMode, tok.key, colorInput.value);
      });
      swatch.append(colorInput);
      swatch.style.background = current;

      const meta = el('div', { class: 'yanta-settings-color-meta' });
      meta.append(el('div', { class: 'yanta-settings-color-label' }, tok.label));

      const textInput = el('input', {
        type: 'text',
        class: 'text-input yanta-settings-color-text',
        value: current,
      });
      textInput.addEventListener('change', () => {
        const v = textInput.value.trim();
        if (v) updateColorToken(targetMode, tok.key, v);
      });
      meta.append(textInput);

      row.append(swatch, meta);
      grid.append(row);
    }

    groupEl.append(grid);
    host.append(groupEl);
  }

  // Reset colors for this mode
  const resetGroup = el('div', { class: 'yanta-settings-group' });
  resetGroup.append(el('button', {
    class: 'btn',
    onclick: async () => {
      const next = { colors: { ...a.colors } };
      next.colors[targetMode] = { ...DEFAULT_THEMES[targetMode] };
      await saveAppearance(next);
      renderSettingsBody();
      toast(`${targetMode} colors reset`, 'success');
    },
  }, `Reset ${targetMode} colors to defaults`));
  host.append(resetGroup);
}

function updateColorToken(mode, key, value) {
  const a = getAppearance();
  const colors = { ...a.colors };
  colors[mode] = { ...colors[mode], [key]: value };
  saveAppearance({ colors });

  // Re-render to update the swatch backgrounds.
  // Use a microtask so the input event finishes first.
  requestAnimationFrame(() => {
    const host = modal?.querySelector('.yanta-settings-content');
    if (host && activeSection === 'colors') {
      // Only update visible swatches in place for smoothness; full rerender is fine too.
      for (const sw of host.querySelectorAll('.yanta-settings-swatch')) {
        const inp = sw.querySelector('input[type="color"]');
        if (inp) sw.style.background = inp.value;
      }
    }
  });
}

// ---- Typography section ----
function renderTypographySection(host) {
  const a = getAppearance();

  host.append(sectionHeader('Typography', 'Choose fonts and sizing.'));

  // Body font
  const fontGroup = el('div', { class: 'yanta-settings-group' });
  fontGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Body font'));
  const fontGrid = el('div', { class: 'yanta-settings-font-grid' });
  for (const f of FONT_OPTIONS) {
    const card = el('button', {
      class: 'yanta-settings-font-card' + (a.fontId === f.id ? ' active' : ''),
      style: { fontFamily: f.stack },
onclick: async () => {
  await saveAppearance({ fontId: f.id });
  rerenderSettingsBody();
},
    });
    card.innerHTML = `
      <div class="yanta-settings-font-name">${f.label}</div>
      <div class="yanta-settings-font-sample">The quick brown fox jumps</div>
    `;
    fontGrid.append(card);
  }
  fontGroup.append(fontGrid);
  host.append(fontGroup);

  // Mono font
  const monoGroup = el('div', { class: 'yanta-settings-group' });
  monoGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Monospace font (code)'));
  const monoGrid = el('div', { class: 'yanta-settings-font-grid' });
  for (const f of MONO_OPTIONS) {
    const card = el('button', {
      class: 'yanta-settings-font-card' + (a.monoId === f.id ? ' active' : ''),
      style: { fontFamily: f.stack },
onclick: async () => {
  await saveAppearance({ monoId: f.id });
  rerenderSettingsBody();
},
    });
    card.innerHTML = `
      <div class="yanta-settings-font-name">${f.label}</div>
      <div class="yanta-settings-font-sample">const x = 42;</div>
    `;
    monoGrid.append(card);
  }
  monoGroup.append(monoGrid);
  host.append(monoGroup);

  // Font size
  const sizeGroup = el('div', { class: 'yanta-settings-group' });
  sizeGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Font size'));
  const sizeRow = el('div', { class: 'yanta-settings-size-row' });
  for (const s of FONT_SIZES) {
    sizeRow.append(el('button', {
      class: 'yanta-settings-size-btn' + (a.fontSizeId === s.id ? ' active' : ''),
onclick: async () => {
  await saveAppearance({ fontSizeId: s.id });
  rerenderSettingsBody();
},
    }, `${s.label} (${s.px}px)`));
  }
  sizeGroup.append(sizeRow);
  host.append(sizeGroup);

  // Line height
  const lhGroup = el('div', { class: 'yanta-settings-group' });
  lhGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Line height'));
  const lhRow = el('div', { class: 'yanta-settings-lh-row' });
  const lhSlider = el('input', {
    type: 'range',
    min: '1.3',
    max: '2.1',
    step: '0.05',
    value: String(a.lineHeight),
  });
  const lhValue = el('span', { class: 'yanta-settings-lh-value' }, a.lineHeight.toFixed(2));
  lhSlider.addEventListener('input', () => {
    lhValue.textContent = Number(lhSlider.value).toFixed(2);
    saveAppearance({ lineHeight: Number(lhSlider.value) });
  });
  lhRow.append(lhSlider, lhValue);
  lhGroup.append(lhRow);
  host.append(lhGroup);
}

// ---- Sync section ----
function renderSyncSection(host) {
  const a = getAppearance();

  host.append(sectionHeader('Sync & Backup', 'Control how your settings travel between devices.'));

  host.append(renderDeviceOnlyToggle(a));

  const info = el('div', { class: 'yanta-settings-info' });
  info.innerHTML = `
    <p><strong>Synced settings</strong> live in your YANTA database and travel with your notes — through the sync folder, exports, and bundle backups.</p>
    <p><strong>Device-only</strong> settings stay in this browser's localStorage. Useful if you prefer a different theme on your phone vs your desktop, for example.</p>
  `;
  host.append(info);

  // Sync Capsule
  const capsuleGroup = el('div', { class: 'yanta-settings-group' });
  capsuleGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Encrypted Sync Capsule'));
  capsuleGroup.append(el('p', { class: 'yanta-settings-hint' },
    'Create an encrypted .yanta file that contains your notes, folders, drawings, metadata, tombstones and image assets. Importing a capsule merges it into this vault instead of replacing everything.'));

  const capsuleActions = el('div', {
    class: 'compress-actions',
    style: {
      justifyContent: 'flex-start',
      flexWrap: 'wrap',
      marginTop: '10px',
    },
  });

  capsuleActions.append(
    el('button', {
      class: 'btn primary',
      onclick: async () => {
        const { exportSyncCapsule } = await import('./sync2/capsule.js');
        await exportSyncCapsule();
      },
    }, 'Back up now'),

    el('button', {
      class: 'btn',
      onclick: async () => {
        const { pickAndImportSyncCapsule } = await import('./sync2/capsule.js');
        await pickAndImportSyncCapsule();
      },
    }, 'Restore from backup'),

    el('button', {
      class: 'btn',
      onclick: async () => {
        const { copySyncCapsuleRecoveryKey } = await import('./sync2/capsule.js');
        await copySyncCapsuleRecoveryKey();
      },
    }, 'Copy sync key')
  );

  capsuleGroup.append(capsuleActions);

  const capsuleNote = el('div', { class: 'yanta-settings-info', style: { marginTop: '10px' } });
  capsuleNote.innerHTML = `
    <p><strong>Private by default.</strong> The capsule encrypts note contents, drawings, folders, tags and image files before they leave this device.</p>
    <p>The sync key is required to restore this capsule on another device. Keep it private.</p>
  `;
  capsuleGroup.append(capsuleNote);

  host.append(capsuleGroup);

  // Future Cloud Sync placeholder
  const cloudGroup = el('div', { class: 'yanta-settings-group' });
  cloudGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Cloud Sync'));
  cloudGroup.append(el('p', { class: 'yanta-settings-hint' },
    'Coming later: encrypted Cloud Sync through Google Drive, Dropbox, OneDrive or YANTA Cloud. No provider setup or OAuth client IDs will be required.'));
  cloudGroup.append(el('button', {
    class: 'btn',
    disabled: true,
  }, 'Cloud Sync coming soon'));
  host.append(cloudGroup);

  // Sync folder shortcut
  const syncGroup = el('div', { class: 'yanta-settings-group' });
  syncGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Advanced: Sync Folder'));
  syncGroup.append(el('p', { class: 'yanta-settings-hint' },
    'Advanced option: mirror your notes to a folder on disk and sync that folder with Syncthing, Dropbox, iCloud, SMB or your own backup tool.'));
  syncGroup.append(el('button', {
    class: 'btn',
    onclick: async () => {
      closeSettings();
      const { openSyncSetup } = await import('./sync.js');
      openSyncSetup();
    },
  }, 'Set up sync folder…'));
  host.append(syncGroup);
}

// ---- About section ----
function renderAboutSection(host) {
  host.append(sectionHeader('About', null));
  const about = el('div', { class: 'yanta-settings-info' });
  about.innerHTML = `
    <p><strong>YANTA</strong> — Yet Another Note Taking App.</p>
    <p>Local-first Markdown notes with built-in live collaboration.</p>
    <p style="color:var(--text-faint);font-size:12px;margin-top:12px">All data stays in your browser. Sync happens through a folder you control. Live shares are end-to-end encrypted via WebRTC.</p>
  `;
  host.append(about);

  // Danger zone
  const danger = el('div', { class: 'yanta-settings-group' });
  danger.append(el('div', { class: 'yanta-settings-group-title' }, 'Reset all settings'));
  danger.append(el('p', { class: 'yanta-settings-hint' },
    'This clears all appearance preferences (both device-only and synced). Your notes are untouched.'));
  danger.append(el('button', {
    class: 'btn danger',
    onclick: async () => {
      if (!confirm('Reset all settings to defaults? Your notes are not affected.')) return;
      clearDeviceSettings();
      await clearSyncedSettings();
      appearance = deepMerge(DEFAULT_APPEARANCE, {});
      applyAppearance();
      renderSettingsBody();
      toast('All settings reset', 'success');
    },
  }, 'Reset all settings'));
  host.append(danger);
}

// ---- Shared helpers ----
function sectionHeader(title, subtitle) {
  const wrap = el('div', { class: 'yanta-settings-section-header' });
  wrap.append(el('h4', {}, title));
  if (subtitle) wrap.append(el('p', { class: 'yanta-settings-subtitle' }, subtitle));
  return wrap;
}

function renderDeviceOnlyToggle(a) {
  const group = el('div', { class: 'yanta-settings-group' });
  group.append(el('div', { class: 'yanta-settings-group-title' }, 'Scope'));

  const row = el('label', { class: 'yanta-settings-toggle' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = !!a.deviceOnly;
cb.addEventListener('change', async () => {
  await saveAppearance({ deviceOnly: cb.checked });
  toast(cb.checked ? 'Settings saved for this device only' : 'Settings now synced across devices', 'success');
  rerenderSettingsBody();
});
  row.append(cb);
  row.append(el('div', { class: 'yanta-settings-toggle-meta' },
    el('div', { class: 'yanta-settings-toggle-label' }, 'For this device only'),
    el('div', { class: 'yanta-settings-toggle-hint' },
      'When on, these settings stay on this device and are not synced or exported with your notes.'),
  ));
  group.append(row);
  return group;
}

// ----------------------------------------------------------------
// Settings CSS — injected at runtime so it's self-contained.
// ----------------------------------------------------------------

let cssInjected = false;
function injectSettingsCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-settings-css';
  style.textContent = `
.yanta-settings-modal .yanta-settings-card {
  width: min(880px, 96vw);
  height: min(720px, 92vh);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
}

.yanta-settings-body {
  display: grid;
  grid-template-columns: 200px 1fr;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.yanta-settings-rail {
  border-right: 1px solid var(--border);
  background: var(--bg-elev-2);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.yanta-settings-rail-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.yanta-settings-rail-btn:hover {
  background: var(--bg-elev-3);
  color: var(--text);
}

.yanta-settings-rail-btn.active {
  background: var(--bg-elev-3);
  color: var(--accent);
  font-weight: 600;
}

.yanta-settings-content {
  overflow-y: auto;
  padding: 20px 24px 30px;
}

.yanta-settings-section-header {
  margin-bottom: 18px;
}

.yanta-settings-section-header h4 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 4px;
}

.yanta-settings-subtitle {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0;
}

.yanta-settings-group {
  margin-bottom: 22px;
}

.yanta-settings-group-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  margin-bottom: 10px;
}

.yanta-settings-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin: 0 0 10px;
  line-height: 1.5;
}

.yanta-settings-info {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.6;
  padding: 14px 16px;
  background: var(--bg-elev-2);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.yanta-settings-info p {
  margin: 0 0 8px;
}

.yanta-settings-info p:last-child {
  margin-bottom: 0;
}

.yanta-settings-info strong {
  color: var(--text);
}

/* Mode picker */
.yanta-settings-mode-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.yanta-settings-mode {
  text-align: left;
  padding: 12px 14px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  color: var(--text);
  transition: border-color 0.1s, background 0.1s;
}

.yanta-settings-mode:hover {
  border-color: var(--border-strong);
}

.yanta-settings-mode.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.yanta-settings-mode-label {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 3px;
}

.yanta-settings-mode-hint {
  font-size: 11px;
  color: var(--text-dim);
}

/* Device-only toggle */
.yanta-settings-toggle {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}

.yanta-settings-toggle:hover {
  border-color: var(--border-strong);
}

.yanta-settings-toggle input[type="checkbox"] {
  margin-top: 2px;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  flex: 0 0 auto;
}

.yanta-settings-toggle-meta { flex: 1; }

.yanta-settings-toggle-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.yanta-settings-toggle-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
  line-height: 1.5;
}

/* Colors */
.yanta-settings-color-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--bg-elev-2);
  border-radius: 8px;
  margin-bottom: 18px;
}

.yanta-settings-color-tab {
  flex: 1;
  padding: 8px 12px;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 13px;
}

.yanta-settings-color-tab.active {
  background: var(--bg-elev-3);
  color: var(--text);
  font-weight: 600;
}

.yanta-settings-color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.yanta-settings-color-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.yanta-settings-swatch {
  position: relative;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--border);
  overflow: hidden;
}

.yanta-settings-swatch input[type="color"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  opacity: 0;
  cursor: pointer;
}

.yanta-settings-color-meta {
  flex: 1;
  min-width: 0;
}

.yanta-settings-color-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 3px;
}

.yanta-settings-color-text {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 4px 6px;
  width: 100%;
  background: var(--bg);
  margin: 0;
}

/* Typography */
.yanta-settings-font-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.yanta-settings-font-card {
  text-align: left;
  padding: 12px 14px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  color: var(--text);
}

.yanta-settings-font-card:hover {
  border-color: var(--border-strong);
}

.yanta-settings-font-card.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.yanta-settings-font-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-dim);
  margin-bottom: 6px;
  font-family: var(--font);
}

.yanta-settings-font-sample {
  font-size: 15px;
  color: var(--text);
}

.yanta-settings-size-row,
.yanta-settings-lh-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.yanta-settings-size-btn {
  padding: 7px 12px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  font-size: 12px;
}

.yanta-settings-size-btn:hover {
  border-color: var(--border-strong);
}

.yanta-settings-size-btn.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.yanta-settings-lh-row input[type="range"] {
  flex: 1;
  accent-color: var(--accent);
}

.yanta-settings-lh-value {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-dim);
  min-width: 50px;
  text-align: right;
}

/* Mobile */
@media (max-width: 720px) {
  .yanta-settings-body {
    grid-template-columns: 1fr;
  }

  .yanta-settings-rail {
    flex-direction: row;
    border-right: 0;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    padding: 8px;
    gap: 4px;
  }

  .yanta-settings-rail-btn {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .yanta-settings-rail-btn span {
    display: none;
  }
}
  `;

  document.head.append(style);
}
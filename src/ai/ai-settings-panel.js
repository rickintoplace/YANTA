// ============================================================
// YANTA AI — Reusable AI settings panel
// Used by:
// - AI assistant settings drawer
// - Main YANTA settings → AI category
// ============================================================

import {
  escapeHtml,
  lucide,
  toast,
} from '../core.js';

import {
  getAiSettings,
  saveAiSettings,
  getAiApiKey,
  setAiApiKey,
  clearAiApiKey,
  resetAssistantPrompt,
  DEFAULT_ASSISTANT_PROMPT,
  DEFAULT_AI_SETTINGS,
} from './ai-settings.js';

import {
  getExternalAgentSettings,
  saveExternalAgentSettings,
  regenerateExternalAgentToken,
} from '../agent/agent-settings.js';

import {
  connectAgentBridge,
  disconnectAgentBridge,
  getAgentBridgeStatus,
  buildAgentReadmeText,
} from '../agent/agent-bridge-client.js';

import {
  getApproxUserLocation,
  clearApproxUserLocation,
  searchApproxLocations,
  setApproxUserLocationFromCandidate,
} from './location.js';

let locationSearchResults = [];
let locationSearchBusy = false;
let locationSearchError = '';

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);

  return String(value || '').replace(/["\\]/g, '\\$&');
}

function checkboxValue(panel, key) {
  return !!panel
    ?.querySelector(`[data-ai-permission="${cssEscape(key)}"]`)
    ?.checked;
}

function agentPermissionValue(panel, key) {
  return !!panel
    ?.querySelector(`[data-agent-permission="${cssEscape(key)}"]`)
    ?.checked;
}

function permissionCheckboxHtml(key, label, badge, checked) {
  const recommended = /recommended/i.test(badge) && !/not/i.test(badge);

  return `
    <label class="yanta-ai-permission">
      <input type="checkbox" data-ai-permission="${escapeHtml(key)}" ${checked ? 'checked' : ''} />
      <span>
        <strong>${escapeHtml(label)}</strong>
        <small class="${recommended ? 'good' : 'warn'}">${escapeHtml(badge)}</small>
      </span>
    </label>
  `;
}

function externalAgentPermissionHtml(key, label, badge, checked) {
  const recommended = /recommended/i.test(badge) && !/not/i.test(badge);

  return `
    <label class="yanta-ai-permission compact">
      <input type="checkbox" data-agent-permission="${escapeHtml(key)}" ${checked ? 'checked' : ''} />
      <span>
        <strong>${escapeHtml(label)}</strong>
        <small class="${recommended ? 'good' : 'warn'}">${escapeHtml(badge)}</small>
      </span>
    </label>
  `;
}

function approxLocationSettingsHtml() {
  const loc = getApproxUserLocation();

  const resultsHtml = locationSearchBusy
    ? `
      <div class="yanta-ai-location-state">
        <span class="yanta-ai-spinner small"></span>
        Searching locations…
      </div>
    `
    : locationSearchError
      ? `
        <div class="yanta-ai-location-state error">
          ${escapeHtml(locationSearchError)}
        </div>
      `
      : locationSearchResults.length
        ? `
          <div class="yanta-ai-location-results">
            ${locationSearchResults.map((r, i) => `
              <button
                type="button"
                class="yanta-ai-location-result"
                data-ai-location-pick="${i}">
                <span class="yanta-ai-location-result-main">
                  <strong>${escapeHtml(r.label || 'Location')}</strong>
                  <small>
                    ${escapeHtml(String(r.latitude))}, ${escapeHtml(String(r.longitude))}
                    ${r.countryCode ? ` · ${escapeHtml(r.countryCode)}` : ''}
                    ${r.source ? ` · ${escapeHtml(r.source)}` : ''}
                  </small>
                </span>
                ${lucide('check', 14)}
              </button>
            `).join('')}
          </div>
        `
        : '';

  return `
    <section class="yanta-ai-settings-section">
      <h4>Approximate location</h4>

      <div class="yanta-ai-warning">
        Used for weather questions like “weather here”.
        Enter a city, region or postcode instead.
        ${loc
          ? `<br><br>Stored:
             ${loc.label ? `${escapeHtml(loc.label)} · ` : ''}
             ${escapeHtml(String(loc.latitude))}, ${escapeHtml(String(loc.longitude))}
             ${loc.timezone ? ` · ${escapeHtml(loc.timezone)}` : ''}
             ${loc.updatedAt ? ` · ${escapeHtml(loc.updatedAt)}` : ''}`
          : '<br><br>No approximate location stored.'}
      </div>

      <div class="yanta-ai-location-grid">
        <label class="wide">
          City, region or postcode
          <input
            class="text-input"
            data-ai-location-place
            value=""
            placeholder="e.g. Göttingen, 37073, 10001, SW1A 1AA"
            autocomplete="postal-code"
            spellcheck="false" />
        </label>

        <label>
          Country code optional
          <input
            class="text-input"
            data-ai-location-country
            value=""
            maxlength="2"
            placeholder="DE, US, GB…" />
        </label>
      </div>

      <div class="compress-actions">
        <button class="btn primary" data-ai-location-search>
          ${lucide('search', 14)}
          Find matches
        </button>

        <button style="display:none;" class="btn primary" data-ai-location-save-best>
          ${lucide('map-pin', 14)}
          Save best match
        </button>

        <button class="btn" data-ai-location-clear>
          ${lucide('trash', 14)}
          Clear location
        </button>
      </div>

      ${resultsHtml}
    </section>
  `;
}

function externalAgentSettingsHtml() {
  const s = getExternalAgentSettings();
  const p = s.permissions || {};
  const status = getAgentBridgeStatus();

  const enabled = !!s.enabled;

  return `
    <section class="yanta-ai-settings-section yanta-ai-external-agent">
      <h4>External Agents</h4>

      <label class="yanta-ai-permission">
        <input type="checkbox" data-agent-enabled ${enabled ? 'checked' : ''} />
        <span>
          <strong>Allow external AI agents to connect</strong>
          <small class="${enabled ? 'good' : 'warn'}">${enabled ? 'Enabled' : 'Disabled'}</small>
        </span>
      </label>

      ${
        enabled
          ? `
            <div class="yanta-ai-settings-grid">
              <label class="wide">
                Local bridge URL
                <input class="text-input" data-agent-url value="${escapeHtml(s.bridgeUrl)}" />
              </label>

              <label class="wide">
                Session token
                <input class="text-input" data-agent-token value="${escapeHtml(s.token)}" readonly />
              </label>
            </div>

            <div class="yanta-ai-agent-status ${status.connected ? 'connected' : ''}">
              ${status.connected ? 'Connected to local bridge' : 'Not connected'}
              ${status.lastError ? ` · ${escapeHtml(status.lastError)}` : ''}
            </div>

            <div class="yanta-ai-settings-section-sub">
              ${externalAgentPermissionHtml('allowReadNotes', 'Allow external agents to read notes', 'Recommended', p.allowReadNotes)}
              ${externalAgentPermissionHtml('allowCreateNotes', 'Allow external agents to create notes', 'Recommended', p.allowCreateNotes)}
              ${externalAgentPermissionHtml('allowEditNotes', 'Allow external agents to edit notes', 'Recommended', p.allowEditNotes)}
              ${externalAgentPermissionHtml('allowDeleteNotes', 'Allow external agents to delete notes', 'Recommended', p.allowDeleteNotes)}
              ${externalAgentPermissionHtml('allowManageCalendar', 'Allow external agents to manage calendar events', 'Recommended', p.allowManageCalendar)}
            </div>

            <textarea class="text-input yanta-ai-agent-readme" data-agent-readme rows="8" readonly>${escapeHtml(buildAgentReadmeText())}</textarea>

            <div class="compress-actions">
              <button class="btn" data-agent-copy-readme>${lucide('copy', 14)} Copy setup text</button>
              <button class="btn" data-agent-regenerate-token>${lucide('rotate-ccw', 14)} Regenerate token</button>
              <span class="grow"></span>
              <button class="btn" data-agent-disconnect>Disconnect</button>
              <button class="btn primary" data-agent-connect>Connect</button>
            </div>
          `
          : `
            <div class="yanta-ai-warning">
              External agent bridge settings are hidden while external agent access is disabled.
              Enable this option to show bridge URL, token, permissions and setup text.
            </div>
          `
      }
    </section>
  `;
}

function readExternalAgentSettingsFromPanel(panel) {
  const current = getExternalAgentSettings();
  const currentPermissions = current.permissions || {};

  const enabled = !!panel.querySelector('[data-agent-enabled]')?.checked;

  const permissionValue = (key) => {
    const input = panel.querySelector(`[data-agent-permission="${cssEscape(key)}"]`);

    // If the detailed settings are hidden, preserve the existing permission.
    if (!input) {
      return currentPermissions[key] === true;
    }

    return !!input.checked;
  };

  return {
    enabled,

    bridgeUrl:
      panel.querySelector('[data-agent-url]')?.value?.trim() ||
      current.bridgeUrl ||
      'ws://127.0.0.1:18791',

    permissions: {
      allowReadNotes: permissionValue('allowReadNotes'),
      allowCreateNotes: permissionValue('allowCreateNotes'),
      allowEditNotes: permissionValue('allowEditNotes'),
      allowDeleteNotes: permissionValue('allowDeleteNotes'),
      allowManageCalendar: permissionValue('allowManageCalendar'),
    },
  };
}

function wireExternalAgentSettingsPanel(panel, rerender) {
  panel.querySelector('[data-agent-enabled]')?.addEventListener('change', () => {
    const next = readExternalAgentSettingsFromPanel(panel);

    saveExternalAgentSettings(next);

    if (!next.enabled) {
      disconnectAgentBridge();
    }

    rerender();
  });

  panel.querySelector('[data-agent-copy-readme]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildAgentReadmeText());
      toast('External agent setup text copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  });

  panel.querySelector('[data-agent-regenerate-token]')?.addEventListener('click', () => {
    regenerateExternalAgentToken();
    toast('External agent token regenerated', 'success');
    rerender();
  });

  panel.querySelector('[data-agent-connect]')?.addEventListener('click', async () => {
    saveExternalAgentSettings(readExternalAgentSettingsFromPanel(panel));

    try {
      await connectAgentBridge();
      toast('External agent bridge connected', 'success');
    } catch (err) {
      toast(err?.message || 'Could not connect bridge', 'error');
    }

    rerender();
  });

  panel.querySelector('[data-agent-disconnect]')?.addEventListener('click', () => {
    disconnectAgentBridge();
    toast('External agent disconnected', 'success');
    rerender();
  });
}

async function runLocationSearch(panel, rerender, { saveFirst = false } = {}) {
  const placeInput = panel.querySelector('[data-ai-location-place]');
  const countryInput = panel.querySelector('[data-ai-location-country]');

  const query = placeInput?.value?.trim() || '';
  const countryCode = countryInput?.value?.trim().toUpperCase() || '';

  if (!query) {
    toast('Enter a city, region or postcode', 'error');
    return;
  }

  locationSearchBusy = true;
  locationSearchError = '';
  locationSearchResults = [];
  rerender();

  try {
    const results = await searchApproxLocations(query, {
      countryCode,
      limit: 6,
    });

    locationSearchResults = results;
    locationSearchError = '';

    if (saveFirst && results[0]) {
      setApproxUserLocationFromCandidate(results[0]);
      locationSearchResults = [];
      toast('Approximate location saved', 'success');
    }
  } catch (err) {
    console.warn('[YANTA AI] location search failed', err);
    locationSearchError = err?.message || 'Could not find location';
    locationSearchResults = [];
  } finally {
    locationSearchBusy = false;
    rerender();
  }
}

function injectAiSettingsPanelCss() {
  if (document.getElementById('yanta-ai-settings-panel-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-ai-settings-panel-css';
  style.textContent = `
.yanta-ai-settings-panel {
  min-width: 0;
}

.yanta-ai-settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.yanta-ai-settings-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.yanta-ai-settings-grid .wide {
  grid-column: 1 / -1;
}

.yanta-ai-settings-section {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.yanta-ai-settings-section h4 {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text);
}

.yanta-ai-settings-section-sub {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.yanta-ai-permission {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elev-2);
  margin-bottom: 6px;
  cursor: pointer;
}

.yanta-ai-permission.compact {
  padding: 7px 9px;
  margin-bottom: 0;
}

.yanta-ai-permission input {
  margin-top: 2px;
  accent-color: var(--accent);
}

.yanta-ai-permission span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-ai-permission strong {
  font-size: 12px;
  color: var(--text);
}

.yanta-ai-permission small {
  font-size: 11px;
}

.yanta-ai-permission small.good {
  color: var(--green);
}

.yanta-ai-permission small.warn {
  color: var(--yellow);
}

.yanta-ai-prompt-editor,
.yanta-ai-agent-readme {
  font-family: var(--font-mono);
  font-size: 12px;
  resize: vertical;
}

.yanta-ai-agent-readme {
  margin-top: 10px;
  font-size: 11px;
}

.yanta-ai-warning {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--yellow) 40%, var(--border));
  background: color-mix(in srgb, var(--yellow) 8%, transparent);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-ai-agent-status {
  margin: 8px 0;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 12px;
}

.yanta-ai-agent-status.connected {
  border-color: color-mix(in srgb, var(--green) 45%, var(--border));
  color: var(--green);
}

.yanta-ai-location-grid {
  display: grid;
  grid-template-columns: 1fr 150px;
  gap: 10px;
  margin-top: 10px;
}

.yanta-ai-location-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
}

.yanta-ai-location-grid .wide {
  min-width: 0;
}

.yanta-ai-location-state {
  margin-top: 10px;
  padding: 8px 10px;

  display: flex;
  align-items: center;
  gap: 8px;

  border: 1px solid var(--border);
  border-radius: 8px;

  background: var(--bg-elev-2);
  color: var(--text-dim);

  font-size: 12px;
}

.yanta-ai-location-state.error {
  border-color: color-mix(in srgb, var(--red) 45%, var(--border));
  color: var(--red);
  background: color-mix(in srgb, var(--red) 8%, transparent);
}

.yanta-ai-location-results {
  display: flex;
  flex-direction: column;
  gap: 6px;

  margin-top: 10px;
}

.yanta-ai-location-result {
  width: 100%;

  display: flex;
  align-items: center;
  gap: 10px;

  padding: 9px 10px;

  border: 1px solid var(--border);
  border-radius: 9px;

  background: var(--bg-elev-2);
  color: var(--text);

  text-align: left;
  cursor: pointer;
}

.yanta-ai-location-result:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
}

.yanta-ai-location-result-main {
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
}

.yanta-ai-location-result-main strong {
  font-size: 12px;
  color: var(--text);
}

.yanta-ai-location-result-main small {
  font-size: 11px;
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

.yanta-ai-settings-actions {
  position: sticky;
  bottom: 0;
  z-index: 2;

  padding-top: 10px;
  padding-bottom: max(0px, env(safe-area-inset-bottom));
}

@media (max-width: 880px) {
  .yanta-ai-settings-grid,
  .yanta-ai-location-grid {
    grid-template-columns: 1fr;
  }

  .yanta-ai-settings-grid .wide {
    grid-column: auto;
  }
}
  `;

  document.head.append(style);
}

export function renderAiSettingsPanel(panel) {
  if (!panel) return;

  injectAiSettingsPanelCss();

  const rerender = () => renderAiSettingsPanel(panel);

  const settings = getAiSettings();
  const key = getAiApiKey();
  const p = settings.permissions || {};

  panel.innerHTML = `
    <div class="yanta-ai-settings-panel">
      <div class="yanta-ai-settings-grid">
        <label>
          Provider
          <input class="text-input" value="OpenRouter" disabled />
        </label>

        <label>
          AI access
          <select class="text-input" data-ai-billing-mode>
            <option value="byok" ${settings.billingMode !== 'included' ? 'selected' : ''}>BYOK: my OpenRouter key</option>
            <option value="included" ${settings.billingMode === 'included' ? 'selected' : ''}>Included AI: YANTA Cloud credits</option>
          </select>
        </label>

        <label>
          Base URL
          <input class="text-input" data-ai-base-url value="${escapeHtml(settings.baseUrl)}" />
        </label>

        <label>
          Model
          <input class="text-input" data-ai-model value="${escapeHtml(settings.model)}" />
        </label>

        <label>
          Privacy
          <select class="text-input" data-ai-privacy>
            <option value="current-note" ${settings.privacyMode === 'current-note' ? 'selected' : ''}>Include current note</option>
            <option value="metadata-only" ${settings.privacyMode === 'metadata-only' ? 'selected' : ''}>Metadata only</option>
          </select>
        </label>

        <label>
          API key storage
          <select class="text-input" data-ai-key-storage>
            <option value="session" ${settings.apiKeyStorage === 'session' ? 'selected' : ''}>Session only</option>
            <option value="local" ${settings.apiKeyStorage === 'local' ? 'selected' : ''}>Remember on this device (localStorage)</option>
            <option value="none" ${settings.apiKeyStorage === 'none' ? 'selected' : ''}>Do not store</option>
          </select>
        </label>

        <label class="wide">
          OpenRouter API key
          <input class="text-input" data-ai-key type="password" value="${escapeHtml(key)}" placeholder="sk-or-..." />
        </label>
      </div>

      <section class="yanta-ai-settings-section">
        <h4>Permissions</h4>

        ${permissionCheckboxHtml('allowReadNotes', 'Allow assistant to read notes', 'Recommended', p.allowReadNotes)}
        ${permissionCheckboxHtml('allowCreateNotes', 'Allow assistant to create notes', 'Recommended', p.allowCreateNotes)}
        ${permissionCheckboxHtml('allowEditNotes', 'Allow assistant to edit notes', 'Recommended', p.allowEditNotes)}
        ${permissionCheckboxHtml('allowDeleteNotes', 'Allow assistant to delete notes', 'Not recommended', p.allowDeleteNotes)}
        ${permissionCheckboxHtml('allowManageCalendar', 'Allow assistant to manage calendar events', 'Recommended', p.allowManageCalendar)}
        ${permissionCheckboxHtml('allowReadAiBrain', 'Allow assistant to read AI Brain', 'Recommended', p.allowReadAiBrain)}
        ${permissionCheckboxHtml('allowWriteAiBrain', 'Allow assistant to write AI Brain', 'Recommended', p.allowWriteAiBrain)}
        ${permissionCheckboxHtml('allowWeather', 'Allow assistant to fetch weather via Open-Meteo', 'Recommended', p.allowWeather)}
        ${permissionCheckboxHtml('allowApproxLocationContext', 'Allow assistant to receive approximate location context', 'Optional', p.allowApproxLocationContext)}
        ${permissionCheckboxHtml('allowReadRss', 'Allow assistant to read Sources/RSS items', 'Recommended', p.allowReadRss)}
        ${permissionCheckboxHtml('allowManageRss', 'Allow assistant to refresh/manage Sources', 'Optional', p.allowManageRss)}
        ${permissionCheckboxHtml('allowSaveRssToNotes', 'Allow assistant to save Sources items as notes', 'Recommended', p.allowSaveRssToNotes)}

      </section>

      ${approxLocationSettingsHtml()}

      ${externalAgentSettingsHtml()}

      <section class="yanta-ai-settings-section">
        <h4>Assistant prompt</h4>
        <textarea class="text-input yanta-ai-prompt-editor" data-ai-prompt rows="10">${escapeHtml(settings.assistantPrompt)}</textarea>

        <div class="compress-actions">
          <button class="btn" data-ai-reset-prompt>
            ${lucide('rotate-ccw', 14)}
            Reset to default
          </button>
        </div>
      </section>

      <div class="yanta-ai-warning">
        BYOK privacy note: your API key stays in this browser, but prompts and included context are sent to OpenRouter/the chosen model.
        Persistent localStorage is convenient but less safe than session-only.
      </div>

      <div class="compress-actions yanta-ai-settings-actions">
        <button class="btn" data-ai-clear-key>Clear key</button>
        <span class="grow"></span>
        <button class="btn primary" data-ai-save-settings>Save AI settings</button>
      </div>
    </div>
  `;

  panel.querySelector('[data-ai-save-settings]')?.addEventListener('click', () => {
    const baseUrl = panel.querySelector('[data-ai-base-url]')?.value || '';
    const model = panel.querySelector('[data-ai-model]')?.value || '';
    const privacyMode = panel.querySelector('[data-ai-privacy]')?.value || 'current-note';
    const apiKeyStorage = panel.querySelector('[data-ai-key-storage]')?.value || 'session';
    const apiKey = panel.querySelector('[data-ai-key]')?.value || '';
    const prompt = panel.querySelector('[data-ai-prompt]')?.value || DEFAULT_ASSISTANT_PROMPT;
    const billingMode = panel.querySelector('[data-ai-billing-mode]')?.value || 'byok';
    const permissions = {
      allowReadNotes: checkboxValue(panel, 'allowReadNotes'),
      allowCreateNotes: checkboxValue(panel, 'allowCreateNotes'),
      allowEditNotes: checkboxValue(panel, 'allowEditNotes'),
      allowDeleteNotes: checkboxValue(panel, 'allowDeleteNotes'),
      allowManageCalendar: checkboxValue(panel, 'allowManageCalendar'),
      allowReadAiBrain: checkboxValue(panel, 'allowReadAiBrain'),
      allowWriteAiBrain: checkboxValue(panel, 'allowWriteAiBrain'),
      allowWeather: checkboxValue(panel, 'allowWeather'),
      allowApproxLocationContext: checkboxValue(panel, 'allowApproxLocationContext'),
      allowReadRss: checkboxValue(panel, 'allowReadRss'),
      allowManageRss: checkboxValue(panel, 'allowManageRss'),
      allowSaveRssToNotes: checkboxValue(panel, 'allowSaveRssToNotes'),
    };

    saveAiSettings({
      baseUrl: baseUrl.trim() || DEFAULT_AI_SETTINGS.baseUrl,
      model: model.trim() || DEFAULT_AI_SETTINGS.model,
      privacyMode,
      apiKeyStorage,
      assistantPrompt: prompt.trim() || DEFAULT_ASSISTANT_PROMPT,
      permissions,
      billingMode,
    });

    setAiApiKey(apiKey, apiKeyStorage);

    saveExternalAgentSettings(readExternalAgentSettingsFromPanel(panel));

    toast('AI settings saved', 'success');
    rerender();
  });

  panel.querySelector('[data-ai-clear-key]')?.addEventListener('click', () => {
    clearAiApiKey();
    toast('AI key cleared', 'success');
    rerender();
  });

  panel.querySelector('[data-ai-reset-prompt]')?.addEventListener('click', () => {
    resetAssistantPrompt();
    toast('Assistant prompt reset', 'success');
    rerender();
  });

  panel.querySelector('[data-ai-location-search]')?.addEventListener('click', async () => {
    await runLocationSearch(panel, rerender);
  });

  panel.querySelector('[data-ai-location-save-best]')?.addEventListener('click', async () => {
    await runLocationSearch(panel, rerender, {
      saveFirst: true,
    });
  });

  panel.querySelector('[data-ai-location-place]')?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;

    e.preventDefault();

    await runLocationSearch(panel, rerender);
  });

  panel.querySelectorAll('[data-ai-location-pick]')?.forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.aiLocationPick);
      const candidate = locationSearchResults[idx];

      if (!candidate) return;

      try {
        setApproxUserLocationFromCandidate(candidate);
        locationSearchResults = [];
        locationSearchError = '';

        toast('Approximate location saved', 'success');
        rerender();
      } catch (err) {
        toast(err?.message || 'Could not save location', 'error');
      }
    });
  });

  panel.querySelector('[data-ai-location-clear]')?.addEventListener('click', () => {
    clearApproxUserLocation();
    toast('Approximate location cleared', 'success');
    rerender();
  });

  wireExternalAgentSettingsPanel(panel, rerender);
}
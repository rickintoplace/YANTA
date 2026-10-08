// ============================================================
// YANTA AI — Reusable AI settings panel
// Used by:
// - AI assistant settings drawer
// - Main YANTA settings → AI category
// ============================================================

// @i18n-locked

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

import {
  INCLUDED_AI_CLIENT_POLICY,
  includedAiModels,
  OPENROUTER_ZDR_POLICY,
  isIncludedAiMode,
  canUseIncludedAi,
  normalizeIncludedAiModel,
} from './ai-access-policy.js';

import { t } from '../i18n/index.js';

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

function permissionCheckboxHtml(key, label, badge, checked) {
  const recommended = badge === t('ai.settings.badges.recommended');

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
  const recommended = badge === t('ai.settings.badges.recommended');

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
        ${escapeHtml(t('ai.settings.location.searching'))}
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
                  <strong>${escapeHtml(r.label || t('ai.settings.location.resultFallback'))}</strong>
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
      <h4>${escapeHtml(t('ai.settings.location.heading'))}</h4>

      <div class="yanta-ai-warning">
        ${escapeHtml(t('ai.settings.location.intro'))}
        ${loc
          ? `<br><br>${escapeHtml(t('ai.settings.location.stored'))}
             ${loc.label ? `${escapeHtml(loc.label)} · ` : ''}
             ${escapeHtml(String(loc.latitude))}, ${escapeHtml(String(loc.longitude))}
             ${loc.timezone ? ` · ${escapeHtml(loc.timezone)}` : ''}
             ${loc.updatedAt ? ` · ${escapeHtml(loc.updatedAt)}` : ''}`
          : `<br><br>${escapeHtml(t('ai.settings.location.none'))}`}
      </div>

      <div class="yanta-ai-location-grid">
        <label class="wide">
          ${escapeHtml(t('ai.settings.location.placeLabel'))}
          <input
            class="text-input"
            data-ai-location-place
            value=""
            placeholder="${escapeHtml(t('ai.settings.location.placePlaceholder'))}"
            autocomplete="postal-code"
            spellcheck="false" />
        </label>

        <label>
          ${escapeHtml(t('ai.settings.location.countryLabel'))}
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
          ${escapeHtml(t('ai.settings.location.find'))}
        </button>

        <button style="display:none;" class="btn primary" data-ai-location-save-best>
          ${lucide('map-pin', 14)}
          ${escapeHtml(t('ai.settings.location.saveBest'))}
        </button>

        <button class="btn" data-ai-location-clear>
          ${lucide('trash', 14)}
          ${escapeHtml(t('ai.settings.location.clear'))}
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
      <h4>${escapeHtml(t('ai.settings.externalAgents.heading'))}</h4>

      <label class="yanta-ai-permission">
        <input type="checkbox" data-agent-enabled ${enabled ? 'checked' : ''} />
        <span>
          <strong>${escapeHtml(t('ai.settings.externalAgents.allow'))}</strong>
          <small class="${enabled ? 'good' : 'warn'}">${escapeHtml(enabled ? t('ai.settings.externalAgents.enabled') : t('ai.settings.externalAgents.disabled'))}</small>
        </span>
      </label>

      ${
        enabled
          ? `
            <div class="yanta-ai-settings-grid">
              <label class="wide">
                ${escapeHtml(t('ai.settings.externalAgents.bridgeUrl'))}
                <input class="text-input" data-agent-url value="${escapeHtml(s.bridgeUrl)}" />
              </label>

              <label class="wide">
                ${escapeHtml(t('ai.settings.externalAgents.token'))}
                <input class="text-input" data-agent-token value="${escapeHtml(s.token)}" readonly />
              </label>
            </div>

            <div class="yanta-ai-agent-status ${status.connected ? 'connected' : ''}">
              ${escapeHtml(status.connected ? t('ai.settings.externalAgents.connected') : t('ai.settings.externalAgents.notConnected'))}
              ${status.lastError ? ` · ${escapeHtml(status.lastError)}` : ''}
            </div>

            <div class="yanta-ai-settings-section-sub">
              ${externalAgentPermissionHtml('allowReadNotes', t('ai.settings.externalAgents.permissions.readNotes'), t('ai.settings.badges.recommended'), p.allowReadNotes)}
              ${externalAgentPermissionHtml('allowCreateNotes', t('ai.settings.externalAgents.permissions.createNotes'), t('ai.settings.badges.recommended'), p.allowCreateNotes)}
              ${externalAgentPermissionHtml('allowEditNotes', t('ai.settings.externalAgents.permissions.editNotes'), t('ai.settings.badges.recommended'), p.allowEditNotes)}
              ${externalAgentPermissionHtml('allowDeleteNotes', t('ai.settings.externalAgents.permissions.deleteNotes'), t('ai.settings.badges.recommended'), p.allowDeleteNotes)}
              ${externalAgentPermissionHtml('allowManageCalendar', t('ai.settings.externalAgents.permissions.manageCalendar'), t('ai.settings.badges.recommended'), p.allowManageCalendar)}
            </div>

            <textarea class="text-input yanta-ai-agent-readme" data-agent-readme rows="8" readonly>${escapeHtml(buildAgentReadmeText())}</textarea>

            <div class="compress-actions">
              <button class="btn" data-agent-copy-readme>${lucide('copy', 14)} ${escapeHtml(t('ai.settings.externalAgents.copySetup'))}</button>
              <button class="btn" data-agent-regenerate-token>${lucide('rotate-ccw', 14)} ${escapeHtml(t('ai.settings.externalAgents.regenerateToken'))}</button>
              <span class="grow"></span>
              <button class="btn" data-agent-disconnect>${escapeHtml(t('ai.settings.externalAgents.disconnect'))}</button>
              <button class="btn primary" data-agent-connect>${escapeHtml(t('ai.settings.externalAgents.connect'))}</button>
            </div>
          `
          : `
            <div class="yanta-ai-warning">
              ${escapeHtml(t('ai.settings.externalAgents.hidden'))}
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
      toast(t('ai.settings.externalAgents.setupCopied'), 'success');
    } catch {
      toast(t('ai.settings.copyFailed'), 'error');
    }
  });

  panel.querySelector('[data-agent-regenerate-token]')?.addEventListener('click', () => {
    regenerateExternalAgentToken();
    toast(t('ai.settings.externalAgents.tokenRegenerated'), 'success');
    rerender();
  });

  panel.querySelector('[data-agent-connect]')?.addEventListener('click', async () => {
    saveExternalAgentSettings(readExternalAgentSettingsFromPanel(panel));

    try {
      await connectAgentBridge();
      toast(t('ai.settings.externalAgents.bridgeConnected'), 'success');
    } catch (err) {
      toast(err?.message || t('ai.settings.externalAgents.connectFailed'), 'error');
    }

    rerender();
  });

  panel.querySelector('[data-agent-disconnect]')?.addEventListener('click', () => {
    disconnectAgentBridge();
    toast(t('ai.settings.externalAgents.disconnected'), 'success');
    rerender();
  });
}

async function runLocationSearch(panel, rerender, { saveFirst = false } = {}) {
  const placeInput = panel.querySelector('[data-ai-location-place]');
  const countryInput = panel.querySelector('[data-ai-location-country]');

  const query = placeInput?.value?.trim() || '';
  const countryCode = countryInput?.value?.trim().toUpperCase() || '';

  if (!query) {
    toast(t('ai.settings.location.enterQuery'), 'error');
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
      toast(t('ai.settings.location.saved'), 'success');
    }
  } catch (err) {
    // Developer log, not UI.
    // eslint-disable-next-line yanta/no-untranslated-literal
    console.warn('[YANTA AI] location search failed', err);
    locationSearchError = err?.message || t('ai.settings.location.notFound');
    locationSearchResults = [];
  } finally {
    locationSearchBusy = false;
    rerender();
  }
}

function includedAiModelOptionsHtml(selectedModel) {
  const selected = normalizeIncludedAiModel(selectedModel);

  return includedAiModels().map((model) => `
    <option value="${escapeHtml(model.id)}" ${model.id === selected ? 'selected' : ''}>
      ${escapeHtml(model.label)} · ${escapeHtml(model.hint)}
    </option>
  `).join('');
}

function citationCheckSelectHtml(settings) {
  const value = String(settings.citationCheck || 'check');
  const option = (v, label) => `<option value="${v}" ${value === v ? 'selected' : ''}>${escapeHtml(label)}</option>`;

  return `
    <label class="wide">
      ${escapeHtml(t('ai.settings.citations.label'))}
      <select class="text-input" data-ai-citation-check>
        ${option('check', t('ai.settings.citations.check'))}
        ${option('revise', t('ai.settings.citations.revise'))}
        ${option('off', t('ai.settings.citations.off'))}
      </select>
    </label>
  `;
}

function thinkingSelectHtml(settings) {
  const value = String(settings.reasoningEffort || 'off');
  const option = (v, label) => `<option value="${v}" ${value === v ? 'selected' : ''}>${escapeHtml(label)}</option>`;

  return `
    <label class="wide">
      ${escapeHtml(t('ai.settings.thinking.label'))}
      <select class="text-input" data-ai-reasoning>
        ${option('off', t('ai.settings.thinking.off'))}
        ${option('low', t('ai.settings.thinking.low'))}
        ${option('medium', t('ai.settings.thinking.medium'))}
      </select>
    </label>
  `;
}

function aiAccessSettingsHtml(settings, apiKey) {
  const includedMode = isIncludedAiMode(settings);

  if (includedMode) {
    return `
      <div class="yanta-ai-settings-grid">
        <label class="wide">
          ${escapeHtml(t('ai.settings.access.label'))}
          <select class="text-input" data-ai-billing-mode>
            <option value="included" selected>${escapeHtml(t('ai.settings.access.included'))}</option>
            <option value="byok">${escapeHtml(t('ai.settings.access.byok'))}</option>
          </select>
        </label>

        <label class="wide">
          ${escapeHtml(t('ai.settings.access.includedModel'))}
          <select class="text-input" data-ai-included-model>
            ${includedAiModelOptionsHtml(settings.includedModel || settings.model)}
          </select>
        </label>

        ${thinkingSelectHtml(settings)}
        ${citationCheckSelectHtml(settings)}

        <label class="wide" style="display:none;">
          ${escapeHtml(t('ai.settings.privacy.label'))}
          <select class="text-input" data-ai-privacy>
            <option value="current-note" ${settings.privacyMode === 'current-note' ? 'selected' : ''}>${escapeHtml(t('ai.settings.privacy.currentNote'))}</option>
            <option value="metadata-only" ${settings.privacyMode === 'metadata-only' ? 'selected' : ''}>${escapeHtml(t('ai.settings.privacy.metadataOnly'))}</option>
          </select>
        </label>
      </div>

      <section class="yanta-ai-settings-section">
        <h4>${escapeHtml(t('ai.settings.includedLimits.heading'))}</h4>
        <div class="yanta-ai-warning">
          ${escapeHtml(t('ai.settings.includedLimits.body'))}
          <br><br>
          ${escapeHtml(t('ai.settings.includedLimits.current', {
            context: Number(INCLUDED_AI_CLIENT_POLICY.maxContextChars),
            rounds: Number(INCLUDED_AI_CLIENT_POLICY.maxToolRounds),
            output: Number(INCLUDED_AI_CLIENT_POLICY.maxOutputTokens),
          }))}
        </div>
      </section>
    `;
  }

  return `
    <div class="yanta-ai-settings-grid">
      <label>
        ${escapeHtml(t('ai.settings.access.label'))}
        <select class="text-input" data-ai-billing-mode>
          <option value="included">${escapeHtml(t('ai.settings.access.included'))}</option>
          <option value="byok" selected>${escapeHtml(t('ai.settings.access.byok'))}</option>
        </select>
      </label>

      <label>
        ${escapeHtml(t('ai.settings.access.provider'))}
        <input class="text-input" value="OpenRouter" disabled />
      </label>

      <label>
        ${escapeHtml(t('ai.settings.access.baseUrl'))}
        <input class="text-input" data-ai-base-url value="${escapeHtml(settings.baseUrl)}" />
      </label>

      <label>
        ${escapeHtml(t('ai.settings.access.model'))}
        <input class="text-input" data-ai-model value="${escapeHtml(settings.model)}" />
      </label>

      ${thinkingSelectHtml(settings)}
        ${citationCheckSelectHtml(settings)}

      <label style="display:none;">
        ${escapeHtml(t('ai.settings.privacy.label'))}
        <select class="text-input" data-ai-privacy>
          <option value="current-note" ${settings.privacyMode === 'current-note' ? 'selected' : ''}>${escapeHtml(t('ai.settings.privacy.currentNote'))}</option>
          <option value="metadata-only" ${settings.privacyMode === 'metadata-only' ? 'selected' : ''}>${escapeHtml(t('ai.settings.privacy.metadataOnly'))}</option>
        </select>
      </label>

      <label>
        ${escapeHtml(t('ai.settings.access.keyStorage'))}
        <select class="text-input" data-ai-key-storage>
          <option value="session" ${settings.apiKeyStorage === 'session' ? 'selected' : ''}>${escapeHtml(t('ai.settings.access.keyStorageSession'))}</option>
          <option value="local" ${settings.apiKeyStorage === 'local' ? 'selected' : ''}>${escapeHtml(t('ai.settings.access.keyStorageLocal'))}</option>
          <option value="none" ${settings.apiKeyStorage === 'none' ? 'selected' : ''}>${escapeHtml(t('ai.settings.access.keyStorageNone'))}</option>
        </select>
      </label>

      <label class="wide">
        ${escapeHtml(t('ai.settings.access.apiKey'))}
        <div class="yanta-ai-key-row">
          <input class="text-input" data-ai-key type="password" value="${escapeHtml(apiKey)}" placeholder="sk-or-..." />
          <button class="btn" type="button" data-ai-clear-key>
            ${lucide('trash', 14)}
            ${escapeHtml(t('ai.settings.access.clearKey'))}
          </button>
        </div>
      </label>
    </div>

    <section class="yanta-ai-settings-section">
      <h4>${escapeHtml(t('ai.settings.byokLimits.heading'))}</h4>

      <div class="yanta-ai-settings-grid">
        <label>
          ${escapeHtml(t('ai.settings.byokLimits.maxContext'))}
          <input class="text-input" data-ai-max-context value="${escapeHtml(settings.maxContextChars)}" inputmode="numeric" />
        </label>

        <label>
          ${escapeHtml(t('ai.settings.byokLimits.maxToolRounds'))}
          <input class="text-input" data-ai-max-tool-rounds value="${escapeHtml(settings.maxToolRounds)}" inputmode="numeric" />
        </label>
      </div>

      <div class="yanta-ai-warning">
        ${escapeHtml(t('ai.settings.byokLimits.body'))}
      </div>
    </section>
  `;
}

function advancedAiOptionsHtml(settings) {
  return `
    <details class="yanta-ai-advanced-options">
      <summary>
        ${lucide('sliders-horizontal', 14)}
        ${escapeHtml(t('ai.settings.advanced'))}
      </summary>

      <div class="yanta-ai-advanced-body">
        ${externalAgentSettingsHtml()}

        <section class="yanta-ai-settings-section">
          <h4>${escapeHtml(t('ai.settings.prompt.heading'))}</h4>
          <textarea class="text-input yanta-ai-prompt-editor" data-ai-prompt rows="10">${escapeHtml(settings.assistantPrompt)}</textarea>

          <div class="compress-actions">
            <button class="btn" data-ai-reset-prompt>
              ${lucide('rotate-ccw', 14)}
              ${escapeHtml(t('ai.settings.prompt.reset'))}
            </button>
          </div>
        </section>
      </div>
    </details>
  `;
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
  /* minmax(0, …): a select sizes itself to its longest option, and with
     plain 1fr that pushed the panel wider than a phone screen. */
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.yanta-ai-settings-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
  color: var(--text-dim);
}

.yanta-ai-settings-grid select,
.yanta-ai-settings-grid input,
.yanta-ai-settings-grid textarea {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  text-overflow: ellipsis;
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
    grid-template-columns: minmax(0, 1fr);
  }

  .yanta-ai-settings-grid .wide {
    grid-column: auto;
  }
}

.yanta-ai-key-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.yanta-ai-key-row .text-input {
  margin: 0;
}

.yanta-ai-advanced-options {
  margin-top: 14px;
  padding: 0;

  border: 1px solid var(--border);
  border-radius: 10px;

  background: var(--bg-elev-2);
  overflow: hidden;
}

.yanta-ai-advanced-options summary {
  display: flex;
  align-items: center;
  gap: 8px;

  padding: 11px 12px;

  color: var(--text);
  font-size: 12px;
  font-weight: 800;

  cursor: pointer;
  user-select: none;
}

.yanta-ai-advanced-options summary:hover {
  color: var(--accent);
}

.yanta-ai-advanced-body {
  padding: 0 12px 12px;
}

.yanta-ai-advanced-body > .yanta-ai-settings-section:first-child {
  margin-top: 0;
}

@media (max-width: 880px) {
  .yanta-ai-key-row {
    grid-template-columns: 1fr;
  }

  .yanta-ai-key-row .btn {
    justify-content: center;
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
  const includedMode = isIncludedAiMode(settings);

  panel.innerHTML = `
    <div class="yanta-ai-settings-panel">

      ${aiAccessSettingsHtml(settings, key)}

      <section class="yanta-ai-settings-section">
        <h4>${escapeHtml(t('ai.settings.permissions.heading'))}</h4>

        ${permissionCheckboxHtml('allowReadNotes', t('ai.settings.permissions.readNotes'), t('ai.settings.badges.recommended'), p.allowReadNotes)}
        ${permissionCheckboxHtml('allowCreateNotes', t('ai.settings.permissions.createNotes'), t('ai.settings.badges.recommended'), p.allowCreateNotes)}
        ${permissionCheckboxHtml('allowEditNotes', t('ai.settings.permissions.editNotes'), t('ai.settings.badges.recommended'), p.allowEditNotes)}
        ${permissionCheckboxHtml('allowDeleteNotes', t('ai.settings.permissions.deleteNotes'), t('ai.settings.badges.recommended'), p.allowDeleteNotes)}
        ${permissionCheckboxHtml('allowManageCalendar', t('ai.settings.permissions.manageCalendar'), t('ai.settings.badges.recommended'), p.allowManageCalendar)}
        ${permissionCheckboxHtml('allowReadAiBrain', t('ai.settings.permissions.readAiBrain'), t('ai.settings.badges.recommended'), p.allowReadAiBrain)}
        ${permissionCheckboxHtml('allowWriteAiBrain', t('ai.settings.permissions.writeAiBrain'), t('ai.settings.badges.recommended'), p.allowWriteAiBrain)}
        ${permissionCheckboxHtml('allowWeather', t('ai.settings.permissions.weather'), t('ai.settings.badges.recommended'), p.allowWeather)}
        ${permissionCheckboxHtml('allowWebSearch', t('ai.settings.permissions.webSearch'), t('ai.settings.badges.optional'), p.allowWebSearch)}
        ${permissionCheckboxHtml('allowApproxLocationContext', t('ai.settings.permissions.approxLocation'), t('ai.settings.badges.optional'), p.allowApproxLocationContext)}
        ${permissionCheckboxHtml('allowReadRss', t('ai.settings.permissions.readRss'), t('ai.settings.badges.recommended'), p.allowReadRss)}
        ${permissionCheckboxHtml('allowManageRss', t('ai.settings.permissions.manageRss'), t('ai.settings.badges.optional'), p.allowManageRss)}
        ${permissionCheckboxHtml('allowAddRssSources', t('ai.settings.permissions.addRssSources'), t('ai.settings.badges.recommended'), p.allowAddRssSources)}
        ${permissionCheckboxHtml('allowSaveRssToNotes', t('ai.settings.permissions.saveRssToNotes'), t('ai.settings.badges.recommended'), p.allowSaveRssToNotes)}
        ${permissionCheckboxHtml('allowReadChatMessages', t('ai.settings.permissions.readChat'), t('ai.settings.badges.optional'), p.allowReadChatMessages)}
        ${permissionCheckboxHtml('allowSendChatMessages', t('ai.settings.permissions.sendChat'), t('ai.settings.badges.optional'), p.allowSendChatMessages)}
        ${permissionCheckboxHtml(
          'allowAutonomousChatMessages',
          t('ai.settings.permissions.sendChatAutonomous'),
          t('ai.settings.badges.optional'),
          p.allowAutonomousChatMessages
        )}
      </section>

      ${approxLocationSettingsHtml()}
    
      ${advancedAiOptionsHtml(settings)}


      <div class="yanta-ai-warning">
        <strong>${escapeHtml(t('ai.settings.privacyNote.zdrEnabled', { label: OPENROUTER_ZDR_POLICY.label }))}</strong>
        ${escapeHtml(OPENROUTER_ZDR_POLICY.description)}
        <br><br>
        ${
          includedMode
            ? `
              ${escapeHtml(t('ai.settings.privacyNote.includedTitle'))}
              ${escapeHtml(t('ai.settings.privacyNote.includedBody'))}
            `
            : `
              ${escapeHtml(t('ai.settings.privacyNote.byokTitle'))}
              ${escapeHtml(t('ai.settings.privacyNote.byokBody'))}
            `
        }
      </div>

      <div class="compress-actions yanta-ai-settings-actions">
        <span class="grow"></span>
        <button class="btn primary" data-ai-save-settings>${escapeHtml(t('ai.settings.save'))}</button>
      </div>
    </div>
  `;

  panel.querySelector('[data-ai-save-settings]')?.addEventListener('click', () => {
    const currentSettings = getAiSettings();

    const billingMode = panel.querySelector('[data-ai-billing-mode]')?.value || 'included';
    const includedModeNext = billingMode === 'included';

    const baseUrl = includedModeNext
      ? currentSettings.baseUrl
      : panel.querySelector('[data-ai-base-url]')?.value || '';

    const model = includedModeNext
      ? currentSettings.model
      : panel.querySelector('[data-ai-model]')?.value || '';

    const includedModel = includedModeNext
      ? normalizeIncludedAiModel(panel.querySelector('[data-ai-included-model]')?.value || currentSettings.includedModel)
      : currentSettings.includedModel;

    const privacyMode = panel.querySelector('[data-ai-privacy]')?.value || 'current-note';

    const apiKeyStorage = includedModeNext
      ? currentSettings.apiKeyStorage
      : panel.querySelector('[data-ai-key-storage]')?.value || 'session';

    const apiKey = includedModeNext
      ? ''
      : panel.querySelector('[data-ai-key]')?.value || '';

    const prompt =
      panel.querySelector('[data-ai-prompt]')?.value ||
      currentSettings.assistantPrompt ||
      DEFAULT_ASSISTANT_PROMPT;

    const maxContextChars = includedModeNext
      ? currentSettings.maxContextChars
      : Number(panel.querySelector('[data-ai-max-context]')?.value || DEFAULT_AI_SETTINGS.maxContextChars);

    const maxToolRounds = includedModeNext
      ? currentSettings.maxToolRounds
      : Number(panel.querySelector('[data-ai-max-tool-rounds]')?.value || DEFAULT_AI_SETTINGS.maxToolRounds);

    const permissions = {
      allowReadNotes: checkboxValue(panel, 'allowReadNotes'),
      allowCreateNotes: checkboxValue(panel, 'allowCreateNotes'),
      allowEditNotes: checkboxValue(panel, 'allowEditNotes'),
      allowDeleteNotes: checkboxValue(panel, 'allowDeleteNotes'),
      allowManageCalendar: checkboxValue(panel, 'allowManageCalendar'),
      allowReadAiBrain: checkboxValue(panel, 'allowReadAiBrain'),
      allowWriteAiBrain: checkboxValue(panel, 'allowWriteAiBrain'),
      allowWeather: checkboxValue(panel, 'allowWeather'),
      allowWebSearch: checkboxValue(panel, 'allowWebSearch'),
      allowApproxLocationContext: checkboxValue(panel, 'allowApproxLocationContext'),
      allowReadRss: checkboxValue(panel, 'allowReadRss'),
      allowManageRss: checkboxValue(panel, 'allowManageRss'),
      allowAddRssSources: checkboxValue(panel, 'allowAddRssSources'),
      allowSaveRssToNotes: checkboxValue(panel, 'allowSaveRssToNotes'),
      allowReadChatMessages: checkboxValue(panel, 'allowReadChatMessages'),
      allowSendChatMessages: checkboxValue(panel, 'allowSendChatMessages'),
      allowAutonomousChatMessages: checkboxValue(panel, 'allowAutonomousChatMessages'),

    };

    saveAiSettings({
      baseUrl: baseUrl.trim() || DEFAULT_AI_SETTINGS.baseUrl,
      model: model.trim() || DEFAULT_AI_SETTINGS.model,
      includedModel,
      privacyMode,
      apiKeyStorage,
      assistantPrompt: prompt.trim() || DEFAULT_ASSISTANT_PROMPT,
      permissions,
      billingMode,
      maxContextChars,
      maxToolRounds,
      reasoningEffort: panel.querySelector('[data-ai-reasoning]')?.value || currentSettings.reasoningEffort || 'off',
      citationCheck: panel.querySelector('[data-ai-citation-check]')?.value || currentSettings.citationCheck || 'check',
    });

    if (!includedModeNext) {
      setAiApiKey(apiKey, apiKeyStorage);
    }

    saveExternalAgentSettings(readExternalAgentSettingsFromPanel(panel));

    toast(t('ai.settings.saved'), 'success');
    rerender();
  });

  panel.querySelector('[data-ai-clear-key]')?.addEventListener('click', () => {
    clearAiApiKey();
    toast(t('ai.settings.keyCleared'), 'success');
    rerender();
  });

  panel.querySelector('[data-ai-reset-prompt]')?.addEventListener('click', () => {
    resetAssistantPrompt();
    toast(t('ai.settings.prompt.resetDone'), 'success');
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

        toast(t('ai.settings.location.saved'), 'success');
        rerender();
      } catch (err) {
        toast(err?.message || t('ai.settings.location.saveFailed'), 'error');
      }
    });
  });

  panel.querySelector('[data-ai-location-clear]')?.addEventListener('click', () => {
    clearApproxUserLocation();
    toast(t('ai.settings.location.cleared'), 'success');
    rerender();
  });

  panel.querySelector('[data-ai-billing-mode]')?.addEventListener('change', async (e) => {
    const nextMode = e.target.value || 'included';

    if (nextMode !== 'included') {
      saveAiSettings({
        billingMode: 'byok',
      });

      rerender();
      return;
    }

    const check = await canUseIncludedAi();

    if (!check.ok) {
      e.target.value = 'byok';
      toast(check.reason, 'error');
      return;
    }

    saveAiSettings({
      billingMode: 'included',
      includedModel: normalizeIncludedAiModel(
        panel.querySelector('[data-ai-included-model]')?.value || getAiSettings().includedModel
      ),
    });

    toast(t('ai.settings.includedEnabled'), 'success');
    rerender();
  });

  wireExternalAgentSettingsPanel(panel, rerender);
}
// ============================================================
// YANTA — shared form styling and submit plumbing for site pages
//
// /cancel, /delete-account and /report are all "public form that posts to
// the Worker and then replaces itself with a receipt". Only the fields and
// the copy differ, so the chrome lives here.
// ============================================================

import { escapeHtml } from './legal-links.js';

export function ensureSiteFormCss() {
  if (document.getElementById('yanta-site-form-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-site-form-css';
  style.textContent = `
.yanta-form {
  display: grid;
  gap: 20px;
  margin-top: 26px;
}

.yanta-form__field {
  display: grid;
  gap: 6px;
}

.yanta-form__field > label,
.yanta-form__legend {
  color: var(--text, #29251d);
  font-size: 14px;
  font-weight: 700;
}

.yanta-form__optional {
  font-weight: 400;
  color: var(--text-dim, #625a49);
}

.yanta-form__hint {
  margin: 0;
  color: var(--text-dim, #625a49);
  font-size: 13px;
}

.yanta-form input[type="text"],
.yanta-form input[type="email"],
.yanta-form select,
.yanta-form textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 10px;
  background: var(--bg, #fff8ef);
  color: var(--text, #29251d);
  font: inherit;
  font-size: 15px;
}

.yanta-form textarea {
  min-height: 110px;
  resize: vertical;
}

.yanta-form :is(input, select, textarea):focus-visible {
  outline: 2px solid var(--accent, #8FA31E);
  outline-offset: 1px;
}

.yanta-form__choices {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  border: 0;
}

.yanta-form__choice {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 12px;
  cursor: pointer;
}

.yanta-form__choice:has(input:checked) {
  border-color: var(--accent, #8FA31E);
  background: color-mix(in srgb, var(--accent, #8FA31E) 8%, transparent);
}

.yanta-form__choice input {
  margin-top: 3px;
  accent-color: var(--accent, #8FA31E);
  flex: none;
}

.yanta-form__choice-text {
  display: grid;
  gap: 2px;
}

.yanta-form__choice-text b {
  color: var(--text, #29251d);
  font-size: 14.5px;
}

.yanta-form__choice-text span {
  color: var(--text-dim, #625a49);
  font-size: 13px;
}

.yanta-form__declaration {
  padding: 14px 16px;
  border: 1px solid var(--border, #d8c7a5);
  border-radius: 12px;
  background: var(--bg-elev, #f7efd8);
  color: var(--text, #29251d);
  font-size: 14px;
}

.yanta-form__submit {
  min-height: 46px;
  padding: 12px 20px;
  font-size: 15px;
}

.yanta-form__submit.danger {
  border-color: var(--red, #a13b2f);
  background: var(--red, #a13b2f);
  color: #fff;
}

.yanta-form__status {
  margin: 0;
  font-size: 14px;
  color: var(--text-dim, #625a49);
}

.yanta-form__status[data-tone="error"] {
  color: var(--red, #a13b2f);
}

.yanta-receipt h2 {
  margin-top: 0;
}

.yanta-receipt__reference {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 7px;
  background: var(--bg-elev-2, #efe3c7);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}
`;
  document.head.append(style);
}

/**
 * Substitute `{token}` placeholders with already-safe HTML fragments.
 *
 * Legal sentences put links and addresses in different places per language,
 * so the strings carry tokens rather than being split into fragments the
 * translator cannot reorder.
 */
export function fill(template, values) {
  return String(template ?? '').replace(
    /\{(\w+)\}/g,
    (match, name) => (name in values ? values[name] : match)
  );
}

export function textField({
  id,
  label,
  type = 'text',
  hint = '',
  optional = false,
  autocomplete = '',
}) {
  return `
    <div class="yanta-form__field">
      <label for="${escapeHtml(id)}">
        ${escapeHtml(label)}${optional ? ' <span class="yanta-form__optional">(optional)</span>' : ''}
      </label>
      <input
        type="${escapeHtml(type)}"
        id="${escapeHtml(id)}"
        name="${escapeHtml(id.replace(/^yanta-[a-z]+-/, ''))}"
        ${autocomplete ? `autocomplete="${escapeHtml(autocomplete)}"` : ''}
      >
      ${hint ? `<p class="yanta-form__hint">${hint}</p>` : ''}
    </div>
  `;
}

export function radioChoice({ name, value, title, description, checked = false }) {
  return `
    <label class="yanta-form__choice">
      <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(value)}"${checked ? ' checked' : ''}>
      <span class="yanta-form__choice-text">
        <b>${escapeHtml(title)}</b>
        <span>${escapeHtml(description)}</span>
      </span>
    </label>
  `;
}

/**
 * Wire a site form: validate, POST, then replace the form with a receipt.
 *
 * `submit` receives the FormData and returns the API response; `receipt`
 * turns that response into the markup shown in the form's place.
 */
export function wireSiteForm({
  formId,
  submit,
  receipt,
  validate = () => '',
  errorMessage,
  busyLabel = 'Sending…',
}) {
  const form = document.getElementById(formId);

  if (!form) return;

  const status = form.querySelector('.yanta-form__status');
  const button = form.querySelector('button[type="submit"]');

  const setStatus = (message, tone = '') => {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const problem = validate(data, form);

    if (problem) {
      setStatus(problem.message, 'error');
      form.querySelector(`#${problem.focus}`)?.focus();
      return;
    }

    button.disabled = true;
    setStatus(busyLabel);

    try {
      const res = await submit(data);
      form.outerHTML = receipt(res);
    } catch (err) {
      console.error(err);
      button.disabled = false;
      setStatus(errorMessage(err), 'error');
    }
  });
}

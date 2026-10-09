// ============================================================
// YANTA — Editor facade
//
// CodeMirror and its language packages are over a megabyte of source,
// and the first surface is usually the dashboard. The editor itself
// lives in editor-cm.js and loads when the first note opens (and once
// at idle after boot, so opening a note stays instant). Everything here
// works before it has loaded: with no editor mounted there is no view,
// and the helpers do what they did before a note was opened.
// ============================================================

let impl = null;
let implPromise = null;

/** Loads the editor. Resolves once mountEditor can run synchronously. */
export function ensureEditor() {
  if (impl) return Promise.resolve(impl);

  implPromise ||= import('./editor-cm.js')
    .then((mod) => {
      impl = mod;
      return mod;
    })
    .catch((err) => {
      implPromise = null;
      throw err;
    });

  return implPromise;
}

export function isEditorLoaded() {
  return !!impl;
}

/** Mounts the editor into `host`; loads it first if needed. */
export async function mountEditor(host, options) {
  await ensureEditor();
  return impl.mountEditor(host, options);
}

export function getView() {
  return impl ? impl.getView() : null;
}

export function setEditorReadOnly(readOnly) {
  impl?.setEditorReadOnly(readOnly);
}

export function destroyEditor() {
  impl?.destroyEditor();
}

export function focusEditor() {
  impl?.focusEditor();
}

export function focusEditorEnd() {
  impl?.focusEditorEnd();
}

export function insertAtCursor(text) {
  impl?.insertAtCursor(text);
}

export function insertTextAtCoords(text, clientX, clientY) {
  return impl ? impl.insertTextAtCoords(text, clientX, clientY) : false;
}

export function currentMarkdown() {
  return impl ? impl.currentMarkdown() : '';
}

export function setEditorLineSpacers(extraByLine) {
  impl?.setEditorLineSpacers(extraByLine);
}

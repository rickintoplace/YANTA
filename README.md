# YANTA

A **local-first** Markdown notes app with live collaboration.

- **Editor**: CodeMirror 6 — fast, modern, with slash commands and autocomplete
- **Content**: each note is a Yjs document — robust, conflict-free, collab-ready
- **Storage**: IndexedDB (notes + assets) — works fully offline, no account
- **Device sync**: pick a folder, point Syncthing (or Dropbox / iCloud / SMB) at it — `.md` files live alongside a small `.yanta/` directory of CRDT snapshots
- **Live sharing**: each note can be shared via a URL or QR code. Transport is WebRTC; traffic is end-to-end encrypted with the room password baked into the link

No build step — open `index.html` over HTTPS or `localhost`. Modules are loaded from `esm.sh` on first run.

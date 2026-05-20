# YANTA

A **local-first** Markdown notes app with live collaboration.

- **Editor**: CodeMirror 6 — slash commands, autocomplete, inline image & video previews
- **Content**: each note is a Yjs document — robust, conflict-free, collab-ready
- **Storage**: IndexedDB (notes + assets) — works fully offline, no account
- **Device sync**: pick a folder, point Syncthing (or Dropbox / iCloud / SMB) at it. `.md` files live next to a small `.yanta/` directory of CRDT snapshots
- **Live sharing**: each note can be shared via a URL or QR code. Transport is WebRTC; traffic is end-to-end encrypted with the room password baked into the link

No build step.

## Running locally

```sh
# Any static server works. Examples:
npx serve .
# or
python3 -m http.server 5500
```

Then open <http://localhost:5500/index.html>. The File System Access API (sync folder) requires HTTPS or `localhost`.

## Deploying to Vercel

The repo is a static site, so the deploy is trivial:

1. Push this repo to GitHub.
2. Go to <https://vercel.com/new>, import the repo.
3. Framework: **Other**. Root directory: `./`. No build command, no output dir.
4. Deploy. Your shared notes will live at e.g. `https://yanta.vercel.app/#share=…`.

The included `vercel.json` keeps caches honest and ensures `src/*.js` is served with the correct `Content-Type`.

A Vercel deployment is the easiest way to make share links openable from a phone — scan the QR, the URL opens in mobile Safari/Chrome, and you're collaborating.

## Drawings

YANTA supports Excalidraw drawings locally and without accounts.

- Insert via `/drawing` or Command Palette → “Insert drawing”
- Drawings are stored inside the current note’s Yjs document
- Markdown embeds use `draw://<id>`
- Export ZIP includes `drawings/<noteId>/<drawingId>.excalidraw`
- `.excalidraw` and `.excalidraw.json` files can be imported
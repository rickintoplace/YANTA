# YANTA

**A local-first workspace — notes, drawings, calendar, chat and AI — that works fully offline and whose cloud can never read your data.**

Your notes are encrypted on your device before they sync anywhere. YANTA Cloud (or your own Google Drive) only ever stores ciphertext; the keys stay with you.

## Features

- **Markdown notes** — CodeMirror 6 editor with slash commands, autocomplete, inline image/video previews. Every note is a Yjs CRDT document: conflict-free, offline-first, collaboration-ready.
- **Drawings & slides** — Excalidraw drawings embedded in notes (`/drawing`), Mermaid import, slide decks with camera targets and presenter notes.
- **Calendar** — FullCalendar-based agenda with ICS sources, recurrence, holidays, and notes ↔ events linking.
- **Chat** — end-to-end encrypted Matrix chat built in (`src/chat/`), used both for messaging and for delivering share invitations.
- **AI assistant** — bring your own OpenRouter key, or use the AI quota included with YANTA Plus. Context building from notes, drawings and calendar.
- **Live sharing (Shared Spaces)** — share a note or a whole folder as a live space. Writers collaborate over WebRTC; readers get near-live updates through the cloud relay. Everything is end-to-end encrypted; the keys travel in the URL fragment or over encrypted Matrix DMs, never to the server.
- **Public pages** — publish a note as a read-only page (`/share/<id>#k=…`). The payload is encrypted client-side; the decryption key stays in the link fragment.
- **Sync, three ways** (all client-side encrypted, see below):
  1. **YANTA Cloud** — zero-setup account sync ("it just works").
  2. **Your own Google Drive** — encrypted blobs in your Drive's hidden app data folder.
  3. **A local folder** — plain `.md` files next to a `.yanta/` CRDT directory; point Syncthing, Dropbox or iCloud at it.
- **Recovery Kit** — printable one-page document with the Recovery Key and a pairing QR code. Zero-knowledge means YANTA cannot reset your key; the kit is the guaranteed way back in.

## Security model

- All sync payloads are encrypted **on the client** with AES-256-GCM; keys are derived (HKDF) from a 256-bit Sync Key that never leaves your devices (`src/sync2/crypto.js`).
- Remote object names are HMAC-derived — the storage provider learns neither titles nor structure.
- Share links carry their keys in the URL **fragment** (`#…`), which browsers do not send to servers.
- The server enforces quotas and access roles, but can never decrypt content.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/` | The web app (vanilla JS + Vite; React only where Excalidraw needs it) |
| `yanta-cloud-worker/` | Cloudflare Worker: accounts, encrypted object storage (D1/R2), public shares, shared spaces, billing webhooks |
| `signaling/` | WebRTC signaling server for live collaboration |
| `sync-broker/` | Generic encrypted-object sync broker (self-hostable storage backend) |
| `yanta-agent-bridge/` | Local bridge for driving the app in automated tests |

## Development

```sh
npm install
npm run dev          # Vite dev server on 0.0.0.0

# In another terminal — the cloud backend:
cd yanta-cloud-worker
npm run db:migrate:local
npm run dev          # wrangler dev
```

Configuration is via Vite env vars (`VITE_YANTA_CLOUD_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_YANTA_MATRIX_HOMESERVER_URL`, `VITE_PADDLE_*`, …). Without any of them the app still runs fully local-first.

```sh
npm run build        # production build to dist/
npm run preview
```

The File System Access API (folder sync) requires HTTPS or `localhost`.

## Deployment

The app is a static Vite build — any static host works (`vercel.json` included). The backend is a Cloudflare Worker:

```sh
cd yanta-cloud-worker
npm run db:migrate:remote
npm run deploy
```

## Bring your own everything

YANTA is designed so the cloud is a convenience, not a dependency:

- **Storage**: local folder, Syncthing/Dropbox/iCloud, or your Google Drive.
- **AI**: your own OpenRouter API key.
- **Chat**: any Matrix homeserver.
- **Cloud**: the worker is in this repo — self-host it if you like.

## License

YANTA is licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE). If you run a modified version as a network service, the AGPL requires you to offer its source to your users.

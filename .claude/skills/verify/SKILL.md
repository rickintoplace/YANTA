---
name: verify
description: Build, launch and drive YANTA (Vite app + yanta-cloud-worker) locally to verify changes end-to-end, including multi-profile sharing flows.
---

# Verifying YANTA changes

## Build

- App: `npm run build` (Vite; predev/prebuild copy Excalidraw assets automatically).
- Worker: no build — `yanta-cloud-worker/src/index.js` is the deployed artifact; `node --check` it after edits.
- ESLint is configured for eslintrc-style but repo has no `eslint.config.js` — `npm run lint` fails on ESLint 9; don't use it as a gate.

## Launch (local full stack)

1. Worker (wrangler is NOT installed in the repo — install `wrangler@4` with `--ignore-scripts` into a scratch dir; `sharp` postinstall fails otherwise):
   ```bash
   cd yanta-cloud-worker
   <scratch>/node_modules/.bin/wrangler d1 execute yanta-cloud-db --local --file=./schema.sql --persist-to <scratch>/wrangler-state
   <scratch>/node_modules/.bin/wrangler dev --local --port 8787 --persist-to <scratch>/wrangler-state \
     --var SESSION_SECRET:dev-secret --var ALLOWED_ORIGINS:http://localhost:5173
   ```
2. App: `VITE_YANTA_CLOUD_API_BASE_URL=http://localhost:8787 npm run dev` → http://localhost:5173

## Auth against the local worker

Without `RESEND_API_KEY`, the login code is printed to the wrangler log:
```bash
curl -s -X POST http://localhost:8787/api/auth/send-code -H 'content-type: application/json' -d '{"email":"owner@test.dev"}'
grep -a "Login code" <wrangler log>   # → 6-digit code
curl -s -X POST http://localhost:8787/api/auth/verify-code -H 'content-type: application/json' \
  -d '{"email":"owner@test.dev","code":"<code>"}' -c cookies.txt
```
Cookie name: `yanta_cloud_session`.

## Browser driving

- `playwright-core` + system `/usr/bin/chromium` works headless (`--no-sandbox`).
- Inject the session cookie into the browser context (`domain: 'localhost'`, `secure: false`) instead of driving the magic-link UI.
- Simulating "same device returns later" requires `launchPersistentContext` (IndexedDB must survive); fresh contexts simulate new devices/anonymous users.
- Useful selectors: sidebar note `aside >> text=<title>`, editor `.cm-content`, title `#noteTitle`, share button `#btn-share`, share modal tabs `[data-share-tab="live"|"public"]`.
- First app boot seeds welcome notes ("Start here" etc.) after ~3s.

## Shared Spaces specifics

- Member grants (Phase 2) resolve a Matrix ID → YANTA user via `chat_accounts`. To test without a real homeserver, create a second cloud user, then insert mappings directly:
  `wrangler d1 execute yanta-cloud-db --local --persist-to <state> --command "INSERT OR REPLACE INTO chat_accounts (user_id, matrix_localpart, matrix_user_id, created_at) VALUES ('<uid>','anna','@anna:yanta.me',1)"`.
  Then drive `/api/spaces/:id/members` with each user's session cookie.
- Folder workspaces / note spaces: seed and drive through the app's ES modules from the page, e.g. `await import('/src/spaces/space-session.js')` then `createSpaceForFolder(folderId)` / `spaceLinksFor(session)`. Reading `state.notes`/`state.folders` from `/src/core.js` is more reliable than scraping the tree DOM (folders render collapsed).
- The headline case is always: create/share, close the owner context entirely, then drive a fresh guest context against the write link — content must still appear (server-restorable heads), and on owner return the two converge.
- Matrix key delivery itself (invite events over Megolm) needs a real/staging homeserver; the worker-side member enforcement is fully testable offline.

## Gotchas

- Free plan allows only 3 active shared spaces — DELETE leftover test spaces via `/api/spaces` between runs or creation 403s.
- Anonymous pages log a 401 from `GET /api/public-shares` on boot — pre-existing noise, not a failure.
- The shared-spaces poke channel uses the production signaling server (`wss://yanta-signaling-…run.app`) even in local dev; near-live delivery ~2-3s.

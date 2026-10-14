// ============================================================
// YANTA Present — styles for the join page, the screen, the remote and the
// presenter's connect panel. One sheet, injected once.
// ============================================================

const CSS = `
/* ---------- Join page (yanta.page/present) ---------- */

html.yanta-present-page,
body.yanta-present-page {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #101010;
  color: #ecebe8;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.yanta-pj {
  position: fixed;
  inset: 0;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: max(20px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom));
  background:
    radial-gradient(circle at 20% 0%, rgba(150, 170, 60, 0.16), transparent 42%),
    radial-gradient(circle at 100% 100%, rgba(110, 168, 254, 0.10), transparent 40%),
    #101010;
}

.yanta-pj-wrap {
  width: min(980px, 100%);
  display: grid;
  gap: 18px;
}

.yanta-pj-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  letter-spacing: -0.01em;
  font-size: 17px;
}

.yanta-pj-brand svg {
  width: 30px;
  height: 30px;
}

.yanta-pj-cards {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 16px;
}

.yanta-pj-card {
  border: 1px solid #2c2c2c;
  border-radius: 22px;
  padding: 22px;
  background: rgba(26, 26, 26, 0.9);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.yanta-pj-card h1,
.yanta-pj-card h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.yanta-pj-card h2 {
  font-size: 19px;
}

.yanta-pj-card p {
  margin: 0;
  color: #a9a6a1;
  font-size: 14px;
  line-height: 1.5;
}

.yanta-pj-show {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px;
  align-items: center;
}

.yanta-pj-qr {
  width: 220px;
  height: 220px;
  padding: 10px;
  border-radius: 18px;
  background: #fff;
  display: grid;
  place-items: center;
}

.yanta-pj-qr svg {
  width: 100%;
  height: 100%;
}

.yanta-pj-qr.is-loading {
  background: #1d1d1d;
}

.yanta-pj-code-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #8d8a85;
}

.yanta-pj-code {
  font: 800 44px/1.1 ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
  letter-spacing: 0.08em;
  color: #fff;
  white-space: nowrap;
}

.yanta-pj-steps {
  margin: 4px 0 0;
  padding-left: 18px;
  color: #a9a6a1;
  font-size: 13px;
  line-height: 1.6;
}

.yanta-pj-form {
  display: grid;
  gap: 12px;
}

.yanta-pj-input {
  width: 100%;
  box-sizing: border-box;
  height: 58px;
  border-radius: 14px;
  border: 1px solid #3a3a3a;
  background: #121212;
  color: #fff;
  padding: 0 16px;
  font: 800 26px/1 ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-align: center;
  outline: none;
}

.yanta-pj-input:focus {
  border-color: #9fb33a;
  box-shadow: 0 0 0 3px rgba(159, 179, 58, 0.25);
}

.yanta-pj-roles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 4px;
  border-radius: 14px;
  background: #121212;
  border: 1px solid #2c2c2c;
}

.yanta-pj-role {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  border-radius: 10px;
  color: #a9a6a1;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.yanta-pj-role[aria-pressed="true"] {
  background: #2a2a2a;
  color: #fff;
}

.yanta-pj-btn {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 50px;
  padding: 0 20px;
  border-radius: 14px;
  background: #9fb33a;
  color: #10120a;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
}

.yanta-pj-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.yanta-pj-btn.is-quiet {
  background: #262626;
  color: #ecebe8;
}

.yanta-pj-note {
  min-height: 20px;
  font-size: 13px;
  color: #a9a6a1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.yanta-pj-note.is-error {
  color: #ff8a80;
}

.yanta-pj-check {
  font: 800 34px/1 ui-monospace, Menlo, monospace;
  letter-spacing: 0.2em;
  color: #fff;
}

.yanta-pj-center {
  width: min(460px, 100%);
  text-align: center;
  display: grid;
  gap: 16px;
  justify-items: center;
}

.yanta-pj-center h1 {
  margin: 0;
  font-size: 24px;
}

.yanta-pj-center p {
  margin: 0;
  color: #a9a6a1;
  line-height: 1.5;
}

.yanta-pj-spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid #333;
  border-top-color: #9fb33a;
  animation: yanta-pj-spin 0.8s linear infinite;
}

@keyframes yanta-pj-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 760px) {
  .yanta-pj {
    place-items: start center;
  }

  .yanta-pj-cards {
    grid-template-columns: 1fr;
  }

  /* On a phone, joining comes first; showing is for the big screen. */
  .yanta-pj-card.is-join {
    order: -1;
  }

  .yanta-pj-show {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }

  .yanta-pj-qr {
    width: 180px;
    height: 180px;
  }

  .yanta-pj-code {
    font-size: 36px;
  }
}

/* ---------- Screen ---------- */

.yanta-present-screen {
  position: fixed;
  inset: 0;
  background: #000;
  cursor: none;
}

.yanta-present-screen.show-cursor {
  cursor: default;
}

.yanta-present-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.yanta-present-stage-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.yanta-present-stage-canvas .excalidraw {
  width: 100%;
  height: 100%;
}

.yanta-present-stage .layer-ui__wrapper,
.yanta-present-stage .App-menu,
.yanta-present-stage .App-toolbar,
.yanta-present-stage .FixedSideContainer,
.yanta-present-stage .HintViewer,
.yanta-present-stage .help-icon,
.yanta-present-stage .Island,
.yanta-present-stage footer,
.yanta-present-stage .welcome-screen-center,
.yanta-present-stage .disable-zen-mode,
.yanta-present-stage .scroll-back-to-content {
  display: none !important;
}

.yanta-present-laser {
  position: absolute;
  left: -9px;
  top: -9px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ff3b30;
  box-shadow: 0 0 0 4px rgba(255, 59, 48, 0.25), 0 0 22px 6px rgba(255, 59, 48, 0.55);
  opacity: 0;
  transition: opacity 0.12s ease;
  pointer-events: none;
  z-index: 5;
  will-change: transform;
}

.yanta-present-laser.is-visible {
  opacity: 1;
}

.yanta-present-blank {
  position: absolute;
  inset: 0;
  background: #000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
  z-index: 6;
}

.yanta-present-blank.is-on {
  opacity: 1;
}

.yanta-present-overlay {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  background: rgba(10, 10, 10, 0.86);
  color: #ecebe8;
  text-align: center;
  padding: 24px;
  font-size: 18px;
}

.yanta-present-overlay[hidden] {
  display: none;
}

.yanta-present-pill {
  position: absolute;
  top: max(12px, env(safe-area-inset-top));
  right: 12px;
  z-index: 9;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(20, 20, 20, 0.82);
  color: #ecebe8;
  font-size: 13px;
  font-weight: 600;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: none;
}

.yanta-present-pill.is-visible,
.yanta-present-screen.show-cursor .yanta-present-pill {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}

.yanta-present-pill button {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  padding: 2px;
  border-radius: 6px;
}

.yanta-present-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4caf50;
  flex: 0 0 auto;
}

[data-state="reconnecting"] .yanta-present-dot,
.yanta-present-dot[data-state="reconnecting"],
.yanta-present-dot[data-state="connecting"] {
  background: #ffb300;
}

.yanta-present-dot[data-state="presenter-away"],
.yanta-present-dot[data-state="offline"] {
  background: #ff5252;
}

/* ---------- Remote ---------- */

.yanta-present-remote {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0f0f0f;
  color: #ecebe8;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  z-index: 1000; /* over slideshow (620) and drawing (220), under toasts (1100) and menus */
}

.yanta-pr-top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: max(10px, env(safe-area-inset-top)) 12px 10px;
}

.yanta-pr-status {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4caf50;
  flex: 0 0 auto;
}

.yanta-pr-status[data-state="reconnecting"] {
  background: #ffb300;
  animation: yanta-pr-pulse 1s ease-in-out infinite;
}

.yanta-pr-status[data-state="presenter-away"] {
  background: #ff5252;
}

@keyframes yanta-pr-pulse {
  50% { opacity: 0.35; }
}

.yanta-pr-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.yanta-pr-timer {
  font: 700 15px/1 ui-monospace, Menlo, monospace;
  color: #a9a6a1;
  font-variant-numeric: tabular-nums;
}

.yanta-pr-icon {
  all: unset;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: #ecebe8;
  cursor: pointer;
}

.yanta-pr-icon:active {
  background: #222;
}

.yanta-pr-banner {
  margin: 0 12px 8px;
  padding: 9px 12px;
  border-radius: 12px;
  background: rgba(255, 179, 0, 0.14);
  color: #ffd166;
  font-size: 13px;
  font-weight: 600;
}

.yanta-pr-banner[hidden] {
  display: none;
}

.yanta-pr-main {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 0 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.yanta-pr-now {
  position: relative;
  flex: 0 0 auto;
  aspect-ratio: 16 / 9;
  max-height: 46vh;
  border-radius: 16px;
  overflow: hidden;
  background: #1b1b1b;
  display: grid;
  place-items: center;
  touch-action: none;
  cursor: pointer;
}

.yanta-pr-now img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.yanta-pr-now img:not([src]) {
  visibility: hidden;
}

.yanta-pr-laser {
  position: absolute;
  left: -8px;
  top: -8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ff3b30;
  box-shadow: 0 0 16px 4px rgba(255, 59, 48, 0.6);
  opacity: 0;
  pointer-events: none;
}

.yanta-pr-laser.is-visible {
  opacity: 1;
}

.yanta-pr-paused {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  padding: 16px;
  text-align: center;
  background: rgba(15, 15, 15, 0.82);
  font-size: 14px;
}

.yanta-pr-paused[hidden] {
  display: none;
}

.yanta-pr-paused p {
  margin: 0;
  color: #cfccc7;
}

.yanta-pr-start {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-radius: 12px;
  background: #9fb33a;
  color: #10120a;
  font-weight: 800;
  cursor: pointer;
}

.yanta-pr-next-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.yanta-pr-next {
  width: 38%;
  max-width: 220px;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  background: #1b1b1b;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.yanta-pr-next img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.yanta-pr-next img[hidden],
.yanta-pr-next img:not([src]) {
  display: none;
}

.yanta-pr-next-meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.yanta-pr-next-label {
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
}

.yanta-pr-count {
  font-size: 13px;
  color: #a9a6a1;
  font-variant-numeric: tabular-nums;
}

.yanta-pr-notes {
  flex: 1 0 auto;
  min-height: 80px;
  padding: 14px;
  border-radius: 14px;
  background: #171717;
  font-size: 17px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}

.yanta-pr-notes.is-empty::before {
  content: attr(data-empty);
  color: #6f6c68;
  font-size: 14px;
}

.yanta-pr-controls {
  display: grid;
  grid-template-columns: 1fr auto 1.6fr;
  gap: 10px;
  padding: 12px 12px max(12px, env(safe-area-inset-bottom));
}

.yanta-pr-btn {
  all: unset;
  box-sizing: border-box;
  min-height: 76px;
  border-radius: 20px;
  background: #222;
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 0.08s ease, background 0.12s ease;
}

.yanta-pr-btn:active {
  transform: scale(0.97);
  background: #2c2c2c;
}

.yanta-pr-btn:disabled {
  opacity: 0.35;
}

.yanta-pr-btn.is-next {
  background: #9fb33a;
  color: #10120a;
}

.yanta-pr-btn.is-next:active {
  background: #b1c64a;
}

.yanta-pr-btn.is-blank {
  min-width: 64px;
  color: #a9a6a1;
}

.yanta-pr-btn.is-blank.is-on {
  background: #ecebe8;
  color: #111;
}

.yanta-pr-progress {
  height: 3px;
  background: #1d1d1d;
}

.yanta-pr-progress i {
  display: block;
  height: 100%;
  width: 0;
  background: #9fb33a;
  transition: width 0.25s ease;
}

@media (min-width: 900px) and (min-height: 560px) {
  /* A laptop or tablet as the remote: slide and notes side by side. */
  .yanta-pr-main {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    grid-template-rows: auto 1fr;
    align-content: start;
  }

  .yanta-pr-now {
    grid-row: 1 / span 2;
    max-height: none;
  }

  .yanta-pr-notes {
    min-height: 0;
    overflow: auto;
  }

  .yanta-pr-controls {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
}

/* ---------- Connect panel (presenter) ---------- */

.yanta-pc-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1600; /* above the slideshow and the presenter view */
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.48);
  animation: fade-in 0.12s ease;
}

.yanta-pc {
  width: min(560px, 100%);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.4);
}

.yanta-pc-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 10px 18px;
}

.yanta-pc-head h3 {
  flex: 1;
  margin: 0;
  font-size: 16px;
}

.yanta-pc-body {
  padding: 0 18px 18px;
  display: grid;
  gap: 16px;
}

.yanta-pc-join {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 18px;
  align-items: center;
}

.yanta-pc-qr {
  width: 168px;
  height: 168px;
  padding: 8px;
  border-radius: 14px;
  background: #fff;
  display: grid;
  place-items: center;
}

.yanta-pc-qr svg {
  width: 100%;
  height: 100%;
}

.yanta-pc-join p {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-dim);
}

.yanta-pc-code {
  font: 800 30px/1.1 ui-monospace, "SF Mono", Menlo, monospace;
  letter-spacing: 0.08em;
  color: var(--text);
}

.yanta-pc-url {
  font-size: 12px;
  color: var(--text-faint);
}

.yanta-pc-section-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  margin: 0 0 6px;
}

.yanta-pc-devices {
  display: grid;
  gap: 6px;
}

.yanta-pc-device {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-elev-2);
}

.yanta-pc-device.is-offline {
  opacity: 0.6;
}

.yanta-pc-device-name {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
  font-size: 14px;
  font-weight: 600;
}

.yanta-pc-device-name small {
  font-weight: 500;
  color: var(--text-faint);
  font-size: 12px;
}

.yanta-pc-device.is-pending {
  border: 1px solid color-mix(in srgb, var(--accent) 50%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev-2));
}

.yanta-pc-check {
  font: 800 16px/1 ui-monospace, Menlo, monospace;
  letter-spacing: 0.12em;
}

.yanta-pc-empty {
  font-size: 13px;
  color: var(--text-faint);
  padding: 4px 2px;
}

.yanta-pc-screen {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
}

.yanta-pc-screen input {
  min-width: 0;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 700;
}

.yanta-pc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.yanta-pc-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-faint);
}

@media (max-width: 560px) {
  .yanta-pc-join {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }
}

/* Asked from anywhere: a device wants in. */
.yanta-pc-ask {
  position: fixed;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 1700;
  width: min(440px, calc(100vw - 24px));
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}

.yanta-pc-ask-row {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
`;

export function injectPresentCss() {
  if (document.getElementById('yanta-present-css')) return;

  const style = document.createElement('style');
  style.id = 'yanta-present-css';
  style.textContent = CSS;
  document.head.append(style);
}

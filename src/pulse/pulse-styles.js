// ============================================================
// YANTA Pulse — shared styles
//
// The small vocabulary Pulse surfaces have in common: routine rows,
// chips, mini buttons, the on/off switch, icon buttons. Kept in one
// place so the Inbox widget and the overview cannot drift apart, and
// so neither depends on the other having been rendered first.
// ============================================================

const CSS_ID = 'yanta-pulse-shared-css';

export function injectPulseCss() {
  if (document.getElementById(CSS_ID)) return;

  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
.yanta-pulse-routines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yanta-pulse-routine {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  padding: 11px 13px;

  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev);
}

.yanta-pulse-routine.is-off { opacity: .62; }

.yanta-pulse-routine-meta {
  flex: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yanta-pulse-routine-name {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.yanta-pulse-routine-desc,
.yanta-pulse-routine-when {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-pulse-routine-when {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.yanta-pulse-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  padding: 1px 7px;

  border-radius: 999px;
  background: var(--bg);

  font-size: 11px;
}

.yanta-pulse-chip.warn {
  background: color-mix(in srgb, var(--yellow, #eab308) 18%, transparent);
  color: var(--yellow, #eab308);
}

.yanta-pulse-routine-side {
  display: flex;
  align-items: center;
  gap: 6px;
}

.yanta-pulse-mini {
  padding: 4px 9px;

  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;

  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.yanta-pulse-mini:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg);
}

.yanta-pulse-mini:disabled { opacity: .5; cursor: default; }

/* A real switch: next to a "Run now" button a bare checkbox reads as a
   selection box rather than an on/off state. */
.yanta-pulse-switch {
  appearance: none;
  -webkit-appearance: none;

  flex: 0 0 auto;
  position: relative;

  width: 36px;
  height: 21px;
  margin: 0;

  border: 0;
  border-radius: 999px;
  background: var(--border);

  cursor: pointer;
  transition: background .16s ease;
}

.yanta-pulse-switch::after {
  content: '';

  position: absolute;
  top: 2px;
  left: 2px;

  width: 17px;
  height: 17px;

  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / .3);

  transition: transform .16s ease;
}

.yanta-pulse-switch:checked { background: var(--accent); }
.yanta-pulse-switch:checked::after { transform: translateX(15px); }

.yanta-pulse-switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.yanta-pulse-icon-btn {
  padding: 4px;

  border: 0;
  border-radius: 6px;
  background: transparent;

  color: var(--text-dim);
  line-height: 0;
  cursor: pointer;
}

.yanta-pulse-icon-btn:hover {
  background: var(--bg-elev);
  color: var(--text);
}

.yanta-pulse-empty {
  padding: 14px;

  border: 1px dashed var(--border);
  border-radius: 10px;

  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
}

/*
  Phones: name, description and chips have no room to share a line with
  three controls — everything ends up two words wide. Stack instead, and
  give the controls their own full-width row where they can breathe.
*/
@media (max-width: 720px) {
  .yanta-pulse-routine {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;

    padding: 14px;
  }

  .yanta-pulse-routine-name { font-size: 14px; }
  .yanta-pulse-routine-desc { font-size: 12.5px; }

  .yanta-pulse-routine-when { gap: 6px; margin-top: 2px; }
  .yanta-pulse-chip { padding: 3px 9px; font-size: 11.5px; }

  .yanta-pulse-routine-side {
    gap: 10px;
    padding-top: 11px;
    border-top: 1px solid var(--border);
  }

  /* "Run now" takes the free space; the icon and switch keep their size
     and stay reachable at the right edge under a thumb. */
  .yanta-pulse-routine-side .yanta-pulse-mini:first-child { flex: 1; }

  .yanta-pulse-mini {
    padding: 9px 12px;
    font-size: 12.5px;
  }

  .yanta-pulse-switch {
    width: 42px;
    height: 25px;
  }

  .yanta-pulse-switch::after { width: 21px; height: 21px; }
  .yanta-pulse-switch:checked::after { transform: translateX(17px); }
}
`;

  document.head.append(style);
}

// ============================================================
// YANTA Present — the laser pointer
//
// One look everywhere (the presenter's screen, connected screens, the
// remote): a bright core with a soft glow and a short fading trail, the way
// presentation apps draw it. Positions from other devices arrive ~16 times a
// second; the dot glides towards each one instead of jumping, so a remote
// laser looks as smooth as a local one.
// ============================================================

const TRAIL_MS = 260;
const IDLE_HIDE_MS = 900;

let cssDone = false;

function injectCss() {
  if (cssDone) return;
  cssDone = true;

  const style = document.createElement('style');
  style.id = 'yanta-laser-css';
  style.textContent = `
.yanta-laser {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 5;
}

.yanta-laser canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.yanta-laser-core {
  position: absolute;
  left: 0;
  top: 0;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0 20%, #ff6b5f 42%, #ff3326 70%);
  box-shadow:
    0 0 6px 2px rgba(255, 51, 38, 0.9),
    0 0 22px 8px rgba(255, 51, 38, 0.45),
    0 0 48px 18px rgba(255, 51, 38, 0.18);
  opacity: 0;
  transition: opacity 0.18s ease;
  will-change: transform;
}

.yanta-laser.is-on .yanta-laser-core {
  opacity: 1;
}
`;
  document.head.append(style);
}

/**
 * A laser inside `host` (which must be positioned). Coordinates are pixels
 * relative to the host's box.
 */
export function createLaser(host) {
  injectCss();

  const root = document.createElement('div');
  root.className = 'yanta-laser';
  root.innerHTML = '<canvas></canvas><div class="yanta-laser-core"></div>';
  host.append(root);

  const canvas = root.querySelector('canvas');
  const core = root.querySelector('.yanta-laser-core');
  const ctx = canvas.getContext('2d');

  let target = null; // where the pointer is
  let pos = null; // where the dot is drawn (glides to target)
  let trail = []; // { x, y, t }
  let raf = 0;
  let hideTimer = 0;
  let visible = false;

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = root.clientWidth;
    const h = root.clientHeight;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const frame = () => {
    raf = 0;
    const now = performance.now();

    if (target && visible) {
      if (!pos) pos = { ...target };

      // Ease towards the target: smooth between network updates, still
      // practically immediate for a local mouse.
      pos.x += (target.x - pos.x) * 0.45;
      pos.y += (target.y - pos.y) * 0.45;

      trail.push({ x: pos.x, y: pos.y, t: now });
      core.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    }

    trail = trail.filter((p) => now - p.t < TRAIL_MS);

    resize();
    ctx.clearRect(0, 0, root.clientWidth, root.clientHeight);

    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1];
      const b = trail[i];
      const life = 1 - (now - b.t) / TRAIL_MS;

      ctx.strokeStyle = `rgba(255, 51, 38, ${0.55 * life})`;
      ctx.lineWidth = 2 + 6 * life;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    const moving = visible && target && pos && (Math.abs(target.x - pos.x) > 0.3 || Math.abs(target.y - pos.y) > 0.3);
    if (moving || trail.length) raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const hide = () => {
    clearTimeout(hideTimer);
    visible = false;
    target = null;
    root.classList.remove('is-on');
    kick();
  };

  return {
    moveTo(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      if (!visible) {
        visible = true;
        pos = null;
        root.classList.add('is-on');
      }

      target = { x, y };
      kick();

      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, IDLE_HIDE_MS);
    },

    hide,

    get visible() {
      return visible;
    },

    destroy() {
      clearTimeout(hideTimer);
      cancelAnimationFrame(raf);
      root.remove();
    },
  };
}

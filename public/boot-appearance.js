(() => {
  try {
    const raw = localStorage.getItem('yanta.appearance.boot.v1');
    if (!raw) return;

    const boot = JSON.parse(raw);
    const root = document.documentElement;

    const pref = boot.appearanceMode || 'auto';

    const effective =
      pref === 'dark' || pref === 'light'
        ? pref
        : window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
          ? 'dark'
          : 'light';

    root.dataset.theme = effective;
    root.dataset.appearanceMode = pref;
    root.style.colorScheme = effective;

    const palette = boot.colors?.[effective] || {};

    for (const [key, value] of Object.entries(palette)) {
      if (typeof value === 'string' && value) {
        root.style.setProperty('--' + key, value);
      }
    }

    const themeColor =
      palette.bg ||
      (effective === 'dark' ? '#141414' : '#fdfcfa');

    const metaTheme = document.getElementById('meta-theme-color');

    if (metaTheme) {
      metaTheme.setAttribute('content', themeColor);
    }

    if (boot.font) {
      root.style.setProperty('--font', boot.font);
    }

    if (boot.mono) {
      root.style.setProperty('--font-mono', boot.mono);
    }

    if (boot.fontSize) {
      root.style.setProperty('--fs-base', boot.fontSize);
    }

    if (boot.lineHeight) {
      root.style.setProperty('--lh-base', boot.lineHeight);
    }
  } catch {}
})();
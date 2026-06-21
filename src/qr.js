import qrcode from 'qrcode-generator';

/**
 * Renders a branded QR code as an inline SVG element.
 * Uses a gentle SVG Goo Filter for data modules while keeping finder patterns
 * sharp for high scannability and performance.
 *
 * @param {string} text The data to encode.
 * @param {object} [options] Configuration options.
 * @param {number} [options.size=220] The pixel size of the generated SVG.
 * @param {string} [options.color='#000000'] The foreground color.
 * @param {string} [options.bgColor='#ffffff'] The background color.
 * @param {string|null} [options.logo=null] An SVG string to render in the center.
 * @returns {SVGSVGElement} The generated QR code SVG element.
 */
export function renderBrandedQrSvg(text, options = {}) {
  const {
    size = 220,
    color = '#000000',
    bgColor = '#ffffff',
    logo = null,
  } = options;

  // 'Q' error correction allows up to 25% recovery.
  const qr = qrcode(0, 'Q');
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const padding = 2; // Standard quiet zone
  const scale = 10;  // Scale factor to allow precise filter rendering
  const totalSize = (moduleCount + padding * 2) * scale;
  const pad = padding * scale;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${totalSize} ${totalSize}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code');

  // Background
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', totalSize);
  bg.setAttribute('height', totalSize);
  bg.setAttribute('fill', bgColor);
  svg.append(bg);

  // SVG Goo Filter (Applied only to data modules)
  const filterId = `qr-goo-${Math.random().toString(36).slice(2, 9)}`;
  const defs = document.createElementNS(ns, 'defs');
  // stdDeviation is fine-tuned for a 10x10 module size
  defs.innerHTML = `
    <filter id="${filterId}" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
      <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" />
    </filter>
  `;
  svg.append(defs);

  // Helper to identify finder patterns (7x7 blocks in the corners)
  const isFinderPattern = (x, y) => {
    return (
      (x < 7 && y < 7) || // Top-Left
      (x >= moduleCount - 7 && y < 7) || // Top-Right
      (x < 7 && y >= moduleCount - 7) // Bottom-Left
    );
  };

  // Determine logo area to skip rendering modules underneath
  const logoPercent = 0.22;
  const skipSize = logo ? Math.floor(moduleCount * logoPercent) : 0;
  const skipStart = Math.floor((moduleCount - skipSize) / 2);
  const skipEnd = skipStart + skipSize;

  let finderPath = '';
  let dataPath = '';

  for (let y = 0; y < moduleCount; y++) {
    for (let x = 0; x < moduleCount; x++) {
      if (qr.isDark(y, x)) {
        // Skip modules in the center if there is a logo to preserve error correction
        if (logo && x >= skipStart && x < skipEnd && y >= skipStart && y < skipEnd) {
          continue;
        }

        const px = pad + x * scale;
        const py = pad + y * scale;

        if (isFinderPattern(x, y)) {
          // Sharp finder patterns (no overlap needed)
          finderPath += `M${px} ${py} h${scale} v${scale} h-${scale}z`;
        } else {
          // Data modules with slight overlap (scale + 1) to assist the goo filter merging
          dataPath += `M${px - 0.5} ${py - 0.5} h${scale + 1} v${scale + 1} h-${scale + 1}z`;
        }
      }
    }
  }

  // 1. Render data modules with the goo filter
  if (dataPath) {
    const dataPathEl = document.createElementNS(ns, 'path');
    dataPathEl.setAttribute('d', dataPath);
    dataPathEl.setAttribute('fill', color);
    dataPathEl.setAttribute('filter', `url(#${filterId})`);
    svg.append(dataPathEl);
  }

  // 2. Render finder patterns without the filter (keeps them sharp and scannable)
  if (finderPath) {
    const finderPathEl = document.createElementNS(ns, 'path');
    finderPathEl.setAttribute('d', finderPath);
    finderPathEl.setAttribute('fill', color);
    svg.append(finderPathEl);
  }

  // 3. Embed logo in the center
  if (logo) {
    const logoBoxSize = totalSize * logoPercent;
    const logoOffset = (totalSize - logoBoxSize) / 2;
    const logoPadding = logoBoxSize * 0.15;

    // White background for contrast
    const logoBg = document.createElementNS(ns, 'rect');
    logoBg.setAttribute('x', logoOffset - logoPadding / 2);
    logoBg.setAttribute('y', logoOffset - logoPadding / 2);
    logoBg.setAttribute('width', logoBoxSize + logoPadding);
    logoBg.setAttribute('height', logoBoxSize + logoPadding);
    logoBg.setAttribute('rx', (logoBoxSize + logoPadding) * 0.2);
    logoBg.setAttribute('ry', (logoBoxSize + logoPadding) * 0.2);
    logoBg.setAttribute('fill', bgColor);
    svg.append(logoBg);

    const parser = new DOMParser();
    const doc = parser.parseFromString(logo, 'image/svg+xml');
    const logoSvg = doc.querySelector('svg');

    if (logoSvg) {
      const nestedSvg = document.createElementNS(ns, 'svg');
      nestedSvg.setAttribute('x', logoOffset);
      nestedSvg.setAttribute('y', logoOffset);
      nestedSvg.setAttribute('width', logoBoxSize);
      nestedSvg.setAttribute('height', logoBoxSize);
      nestedSvg.setAttribute('viewBox', logoSvg.getAttribute('viewBox') || '0 0 100 100');
      nestedSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      nestedSvg.style.color = color;

      while (logoSvg.firstChild) {
        nestedSvg.append(logoSvg.firstChild);
      }

      svg.append(nestedSvg);
    }
  }

  return svg;
}
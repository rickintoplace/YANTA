// ============================================================
// YANTA — building blocks shared by every locale's legal documents
//
// Only structure and locale-independent data live here: markup helpers, the
// provider block, and the tables whose cells are proper nouns or URLs. All
// prose sits in the per-locale document modules next to this file.
// ============================================================

import {
  escapeHtml,
  SOURCE_URL,
  YANTA_LEGAL,
} from '../legal-links.js';

export {
  escapeHtml,
  SOURCE_URL,
  YANTA_LEGAL,
};

/** Bumped by hand when a document changes in substance. */
export const UPDATED = '2026-08-08';

export const CONTACT_EMAIL = YANTA_LEGAL.contactEmail;

export function providerBlock() {
  return `
    ${escapeHtml(YANTA_LEGAL.providerName)}<br>
    ${escapeHtml(YANTA_LEGAL.street)}<br>
    ${escapeHtml(YANTA_LEGAL.city)}<br>
    ${escapeHtml(YANTA_LEGAL.country)}
  `;
}

/** Provider address on one line, for running text. */
export function providerInline() {
  return [
    YANTA_LEGAL.providerName,
    YANTA_LEGAL.street,
    YANTA_LEGAL.city,
    YANTA_LEGAL.country,
  ].map(escapeHtml).join(', ');
}

export function mailLink(address = CONTACT_EMAIL) {
  return `<a href="mailto:${escapeHtml(address)}">${escapeHtml(address)}</a>`;
}

export function table(headers, rows) {
  return `
    <div class="yanta-legal-table">
      <table>
        <thead>
          <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function docHeader(title, updatedLabel) {
  return `
    <h1>${escapeHtml(title)}</h1>
    <p><strong>${escapeHtml(updatedLabel)}</strong> ${escapeHtml(UPDATED)}</p>
  `;
}

/*
  Recipients that can receive data. `purpose` is a key the locale modules
  translate; name and location are proper nouns and stay as they are.
  `thirdCountry` drives the transfer footnote.
*/
export const PROCESSORS = [
  ['Cloudflare', 'cloudflare', 'USA / EU', true],
  ['Vercel', 'vercel', 'USA / EU', true],
  ['Paddle.com Market Ltd.', 'paddle', 'UK / USA', true],
  ['Resend', 'resend', 'USA', true],
  ['OpenRouter', 'openrouter', 'USA', true],
  ['Brave Search', 'brave', 'USA', true],
  ['Google (YouTube Data API, Drive)', 'google', 'USA', true],
  ['Open-Meteo', 'weather', 'Germany', false],
  ['Nominatim / OpenStreetMap', 'geo', 'Germany / EU', false],
  ['Crossref, DataCite, OpenLibrary', 'citations', 'USA / EU', true],
  ['Matrix homeserver (matrix.yanta.me)', 'matrix', 'EU', false],
];

export function processorRows(purposes) {
  return PROCESSORS.map(([name, key, place, thirdCountry]) => [
    `<strong>${escapeHtml(name)}</strong>`,
    escapeHtml(purposes[key] || key),
    `${escapeHtml(place)}${thirdCountry ? ' <sup>*</sup>' : ''}`,
  ]);
}

/** Component names, licence identifiers and URLs — nothing to translate. */
export const THIRD_PARTY_LICENCES = [
  ['CodeMirror 6', 'MIT', 'https://codemirror.net'],
  ['Excalidraw', 'MIT', 'https://excalidraw.com'],
  ['FullCalendar', 'MIT', 'https://fullcalendar.io'],
  ['Yjs, y-indexeddb, y-webrtc', 'MIT', 'https://yjs.dev'],
  ['React, React DOM', 'MIT', 'https://react.dev'],
  ['Lucide icons', 'ISC', 'https://lucide.dev'],
  ['qrcode-generator', 'MIT', 'https://github.com/kazuhikoarase/qrcode-generator'],
  ['unicode-emoji-json', 'MIT', 'https://github.com/muan/unicode-emoji-json'],
  ['matrix-js-sdk, matrix-sdk-crypto-wasm', 'Apache-2.0', 'https://github.com/matrix-org'],
  ['matrix-encrypt-attachment', 'Apache-2.0', 'https://github.com/matrix-org/matrix-encrypt-attachment'],
  ['Transformers.js', 'Apache-2.0', 'https://github.com/huggingface/transformers.js'],
  ['PDF.js (pdfjs-dist)', 'Apache-2.0', 'https://mozilla.github.io/pdf.js/'],
  ['Paddle.js', 'Apache-2.0', 'https://developer.paddle.com/paddlejs/overview'],
  ['DOMPurify', 'MPL-2.0 or Apache-2.0', 'https://github.com/cure53/DOMPurify'],
  ['mammoth.js', 'BSD-2-Clause', 'https://github.com/mwilliamson/mammoth.js'],
  ['rrule', 'BSD-3-Clause', 'https://github.com/jkbrzt/rrule'],
  ['date-holidays', 'ISC and CC-BY-3.0', 'https://github.com/commenthol/date-holidays'],
];

export function licenceRows() {
  return THIRD_PARTY_LICENCES.map(([name, licence, url]) => [
    `<strong>${escapeHtml(name)}</strong>`,
    escapeHtml(licence),
    `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url.replace(/^https?:\/\//, ''))}</a>`,
  ]);
}

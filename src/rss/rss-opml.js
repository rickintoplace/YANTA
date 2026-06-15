// ============================================================
// YANTA Sources / RSS — OPML import/export
// ============================================================

import {
    downloadBlob,
    safeFilename,
  } from '../core.js';
  
  function escapeXml(s) {
    return String(s ?? '').replace(/[<>&"']/g, (c) => ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    }[c]));
  }
  
  export function parseOpml(text) {
    const doc = new DOMParser().parseFromString(String(text || ''), 'application/xml');
  
    if (doc.querySelector('parsererror')) {
      throw new Error('Invalid OPML file.');
    }
  
    const outlines = [...doc.querySelectorAll('outline')];
  
    return outlines
      .map((o) => ({
        title: o.getAttribute('title') || o.getAttribute('text') || o.getAttribute('xmlUrl') || '',
        feedUrl: o.getAttribute('xmlUrl') || '',
        siteUrl: o.getAttribute('htmlUrl') || '',
      }))
      .filter((x) => x.feedUrl);
  }
  
  export function feedsToOpml(feeds = []) {
    const body = feeds.map((f) =>
      `    <outline text="${escapeXml(f.title)}" title="${escapeXml(f.title)}" type="rss" xmlUrl="${escapeXml(f.feedUrl)}" htmlUrl="${escapeXml(f.siteUrl || '')}" />`
    ).join('\n');
  
    return `<?xml version="1.0" encoding="UTF-8"?>
  <opml version="2.0">
    <head>
      <title>YANTA Sources</title>
      <dateCreated>${new Date().toUTCString()}</dateCreated>
    </head>
    <body>
  ${body}
    </body>
  </opml>
  `;
  }
  
  export function exportFeedsOpml(feeds = []) {
    const opml = feedsToOpml(feeds);
  
    downloadBlob(
      new Blob([opml], { type: 'text/x-opml;charset=utf-8' }),
      safeFilename('yanta-sources') + '.opml'
    );
  }
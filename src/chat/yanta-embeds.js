// ============================================================
// YANTA Chat — AP8 YANTA Embeds
//
// S3 — Spezifikation YANTA-Embeds (Event-Schema, verbindlich)
//
// Alles bleibt ein normales m.room.message, damit fremde Clients einen
// sinnvollen Fallback sehen; YANTA erkennt sein Feld und rendert Karten.
// Namespace-Key: page.yanta.embed (reverse-DNS deiner Domain, Matrix-konform
// für Custom-Felder).
//
// jsonc{
//   "msgtype": "m.text",
//   "body": "📝 Notiz: „Projektplan Q3“ — geteilt aus YANTA (https://yanta.page)",  // Fallback
//   "page.yanta.embed": {
//     "v": 1,
//     "type": "note",                    // note | event | drawing | source | publicShare
//     "title": "Projektplan Q3",
//     "icon": "briefcase-business",      // lucide-Name, optional
//     "color": "#f59e0b",                // optional
//     // typabhängig genau EIN payload:
//     "note":    { "markdown": "…", "tags": ["…"], "truncated": false },   // Snapshot, ≤ 32 KB, sonst truncated+Hinweis
//     "event":   { "title": "…", "start": "ISO", "end": "ISO|null", "allDay": false,
//                  "location": "", "description": "", "recurrence": null }, // 1:1 kompatibel zu putCalendarEvent-Args
//     "drawing": { "imageEventNote": "Bild hängt als eigenes m.image direkt davor" },
//     "source":  { "title": "…", "url": "…", "feedTitle": "…", "publishedAt": "ISO" },
//     "publicShare": { "url": "https://yanta.page/share/…#k=…" }
//   }
// }
//
// Regeln:
//
// Drawings werden als zwei Events gesendet: zuerst das gerenderte PNG als
// normales m.image (funktioniert überall), direkt danach die Embed-Message
// mit Metadaten/Titel — YANTA fasst beide zu einer Karte zusammen
// (drawing.imageEventNote referenziert per m.relates_to → event_id des Bildes;
// nutze rel_type: 'page.yanta.embed.media').
//
// Note-Sharing bietet zwei Modi im UI: „Snapshot senden" (Inhalt eingefroren,
// E2EE, kein Server-Payload) und „Live-Link senden" (nutzt bestehendes
// createPublicShare → publicShare-Embed). Default: Snapshot.
//
// Empfangs-Karten-Aktionen: note→createNoteAction,
// event→putCalendarEvent (mit Bestätigungsdialog),
// source→addRssSourceAction optional („Quelle folgen").
//
// Security:
// Embeds are untrusted remote data. Markdown snapshots are safe to store as
// Notes because Notes are data. Never render embed Markdown as HTML in Chat;
// cards display only escaped title/metadata.
// ============================================================

import {
    el,
    escapeHtml,
    fmtBytes,
    lucide,
    state,
    toast,
    uid,
  } from '../core.js';
  
  import {
    yantaConfirm,
  } from '../dialogs.js';
  
  import {
    noteMarkdown,
    listAllDrawings,
    findDrawing,
  } from '../yjs.js';
  
  import {
    createNoteAction,
  } from '../ai/app-actions.js';
  
  import {
    putCalendarEvent,
    hydrateCalendarStateFromVault,
  } from '../calendar.js';
  
  import {
    mxcToBlobUrl,
  } from './chat-media.js';

  import {
    createPublicShareForNoteAction,
  } from '../public-share/public-share-actions.js';
  
  export const YANTA_EMBED_KEY = 'page.yanta.embed';
  export const YANTA_EMBED_MEDIA_REL_TYPE = 'page.yanta.embed.media';
  
  const NOTE_MARKDOWN_MAX_BYTES = 32 * 1024;
  
  let pickerOverlay = null;
  
  const te = new TextEncoder();
  
  function cleanText(value, fallback = '') {
    const s = String(value ?? '').trim();
    return s || fallback;
  }
  
  function safeColor(value = '') {
    const s = String(value || '').trim();
  
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  
    return '';
  }
  
  function isoOrNull(value) {
    if (!value) return null;
  
    const d = new Date(value);
  
    return Number.isNaN(d.getTime())
      ? null
      : d.toISOString();
  }
  
  function markdownBytes(markdown = '') {
    return te.encode(String(markdown || '')).byteLength;
  }
  
  function truncateMarkdown32k(markdown = '') {
    const raw = String(markdown || '');
  
    if (markdownBytes(raw) <= NOTE_MARKDOWN_MAX_BYTES) {
      return {
        markdown: raw,
        truncated: false,
      };
    }
  
    let out = raw.slice(0, NOTE_MARKDOWN_MAX_BYTES);
  
    while (markdownBytes(out) > NOTE_MARKDOWN_MAX_BYTES - 300) {
      out = out.slice(0, Math.floor(out.length * 0.92));
    }
  
    return {
      markdown:
        out.trimEnd() +
        '\n\n---\n_This YANTA chat note snapshot was truncated at 32 KB._\n',
      truncated: true,
    };
  }
  
  function fallbackBodyForEmbed(embed = {}) {
    const title = embed.title || 'YANTA item';
  
    if (embed.type === 'note') {
      return `📝 Notiz: „${title}“ — geteilt aus YANTA (https://yanta.page)`;
    }
  
    if (embed.type === 'event') {
      return `📅 Termin: „${title}“ — geteilt aus YANTA (https://yanta.page)`;
    }
  
    if (embed.type === 'drawing') {
      return `🎨 Zeichnung: „${title}“ — geteilt aus YANTA (https://yanta.page)`;
    }
  
    if (embed.type === 'source') {
      return `📰 Quelle: „${title}“ — geteilt aus YANTA (https://yanta.page)`;
    }
  
    if (embed.type === 'publicShare') {
      return `🔗 YANTA Live-Link: „${title}“ — ${embed.publicShare?.url || 'https://yanta.page'}`;
    }
  
    return `YANTA: ${title}`;
  }
  
  function normalizeEmbed(input = {}) {
    const type = String(input.type || '').trim();
  
    const base = {
      v: 1,
      type,
      title: cleanText(input.title, 'YANTA item'),
      icon: cleanText(input.icon || ''),
      color: safeColor(input.color || ''),
    };
  
    if (type === 'note') {
      return {
        ...base,
        note: {
          markdown: String(input.note?.markdown || ''),
          tags: Array.isArray(input.note?.tags)
            ? input.note.tags.map(String).slice(0, 32)
            : [],
          truncated: input.note?.truncated === true,
        },
      };
    }
  
    if (type === 'event') {
      return {
        ...base,
        event: {
          title: cleanText(input.event?.title || input.title, 'Untitled event'),
          start: isoOrNull(input.event?.start) || new Date().toISOString(),
          end: isoOrNull(input.event?.end),
          allDay: input.event?.allDay === true,
          location: String(input.event?.location || ''),
          description: String(input.event?.description || ''),
          recurrence: input.event?.recurrence || null,
        },
      };
    }
  
    if (type === 'drawing') {
      return {
        ...base,
        drawing: {
          imageEventNote: String(input.drawing?.imageEventNote || ''),
        },
      };
    }
  
    if (type === 'source') {
      return {
        ...base,
        source: {
          title: cleanText(input.source?.title || input.title, 'Source'),
          url: String(input.source?.url || ''),
          feedTitle: String(input.source?.feedTitle || ''),
          publishedAt: isoOrNull(input.source?.publishedAt),
        },
      };
    }
  
    if (type === 'publicShare') {
      return {
        ...base,
        publicShare: {
          url: String(input.publicShare?.url || ''),
        },
      };
    }
  
    throw new Error(`Unsupported YANTA embed type: ${type}`);
  }
  
  async function sendRoomMessage(client, roomId, content) {
    if (!client || !roomId) {
      throw new Error('Chat is not connected.');
    }
  
    if (typeof client.sendMessage === 'function') {
      return client.sendMessage(roomId, content);
    }
  
    if (typeof client.sendEvent === 'function') {
      return client.sendEvent(roomId, 'm.room.message', content);
    }
  
    throw new Error('Matrix sendMessage is not available.');
  }
  
  function eventIdFromSendResult(result) {
    return (
      result?.event_id ||
      result?.eventId ||
      result?.event?.event_id ||
      ''
    );
  }
  
  function roomIsEncrypted(client, roomId) {
    try {
      if (typeof client?.isRoomEncrypted === 'function') {
        return !!client.isRoomEncrypted(roomId);
      }
  
      const room = client?.getRoom?.(roomId);
      const state = room?.currentState || room?.getLiveTimeline?.()?.getState?.('f');
  
      return !!state?.getStateEvents?.('m.room.encryption', '');
    } catch (err) {
      console.warn('[YANTA Embeds] Could not determine room encryption', err);
      toast('Could not check chat encryption.', 'error');
      return false;
    }
  }
  
  async function encryptMatrixAttachment(blob) {
    const mod = await import('matrix-encrypt-attachment');
  
    const encryptAttachment =
      mod.encryptAttachment ||
      mod.default?.encryptAttachment ||
      mod.default;
  
    if (typeof encryptAttachment !== 'function') {
      throw new Error('Matrix attachment encryption is not available.');
    }
  
    const encrypted = await encryptAttachment(await blob.arrayBuffer());
  
    const data =
      encrypted?.data ||
      encrypted?.ciphertext ||
      encrypted?.encrypted ||
      null;
  
    const info =
      encrypted?.info ||
      encrypted?.file ||
      encrypted?.encryptedFile ||
      null;
  
    if (!data || !info) {
      throw new Error('Matrix attachment encryption returned unsupported data.');
    }
  
    return {
      blob: new Blob([data], {
        type: 'application/octet-stream',
      }),
      file: info,
    };
  }
  
  function mxcFromUploadResult(result) {
    if (typeof result === 'string') return result;
  
    return (
      result?.content_uri ||
      result?.contentUri ||
      result?.url ||
      ''
    );
  }
  
  async function uploadMatrixContent(client, blob, {
    name = 'file',
    type = '',
  } = {}) {
    if (!client?.uploadContent) {
      throw new Error('Matrix uploadContent is not available.');
    }
  
    const result = await client.uploadContent(blob, {
      name,
      type: type || blob.type || 'application/octet-stream',
      includeFilename: true,
    });
  
    const mxc = mxcFromUploadResult(result);
  
    if (!mxc) {
      throw new Error('Homeserver did not return an MXC URI.');
    }
  
    return mxc;
  }
  
  async function sendPngImageEvent(client, roomId, blob, {
    name = 'drawing.png',
    title = 'Drawing',
  } = {}) {
    const encrypted = roomIsEncrypted(client, roomId);
  
    const content = {
      msgtype: 'm.image',
      body: name,
      info: {
        mimetype: blob.type || 'image/png',
        size: blob.size || 0,
      },
    };
  
    if (encrypted) {
      const encryptedFile = await encryptMatrixAttachment(blob);
  
      encryptedFile.file.url = await uploadMatrixContent(client, encryptedFile.blob, {
        name,
        type: 'application/octet-stream',
      });
  
      content.file = encryptedFile.file;
    } else {
      content.url = await uploadMatrixContent(client, blob, {
        name,
        type: blob.type || 'image/png',
      });
    }
  
    return sendRoomMessage(client, roomId, content);
  }
  
  /**
   * Sends a normalized YANTA embed Matrix message.
   */
  export async function sendYantaEmbed(client, roomId, embed, {
    relatesTo = null,
  } = {}) {
    try {
      const clean = normalizeEmbed(embed);
  
      const content = {
        msgtype: 'm.text',
        body: fallbackBodyForEmbed(clean),
        [YANTA_EMBED_KEY]: clean,
      };
  
      if (relatesTo?.eventId) {
        content['m.relates_to'] = {
          rel_type: relatesTo.relType || YANTA_EMBED_MEDIA_REL_TYPE,
          event_id: relatesTo.eventId,
        };
      }
  
      const result = await sendRoomMessage(client, roomId, content);
  
      toast('Sent YANTA item', 'success');
  
      return result;
    } catch (err) {
      console.warn('[YANTA Embeds] Could not send embed', err);
      toast('Could not send YANTA item.', 'error');
      throw err;
    }
  }
  
  /**
   * Sends a note snapshot embed.
   */
  export async function sendNoteSnapshotEmbed(client, roomId, noteId) {
    const note = state.notes.get(String(noteId || ''));
  
    if (!note) {
      toast('Note not found.', 'error');
      throw new Error('Note not found.');
    }
  
    const markdown = noteMarkdown(note.id);
    const snap = truncateMarkdown32k(markdown);
  
    return sendYantaEmbed(client, roomId, {
      type: 'note',
      title: note.title || 'Untitled',
      icon: note.icon || 'file-text',
      color: note.color || '',
      note: {
        markdown: snap.markdown,
        tags: note.tags || [],
        truncated: snap.truncated,
      },
    });
  }

  async function createPublicShareForNote(noteId) {
    const res = await createPublicShareForNoteAction({
      noteId,
      publish: true,
      force: false,
      source: 'chat-embed',
    });
  
    if (!res?.url) {
      throw new Error('Public share URL missing after create/publish.');
    }
  
    return res.url;
  }
  
  /**
   * Sends a live public share embed for a note.
   */
  export async function sendNotePublicShareEmbed(client, roomId, noteId) {
    const note = state.notes.get(String(noteId || ''));
  
    if (!note) {
      toast('Note not found.', 'error');
      throw new Error('Note not found.');
    }
  
    const url = await createPublicShareForNote(note.id);
  
    return sendYantaEmbed(client, roomId, {
      type: 'publicShare',
      title: note.title || 'Untitled',
      icon: note.icon || 'share',
      color: note.color || '',
      publicShare: {
        url,
      },
    });
  }
  
  /**
   * Sends a calendar event embed.
   */
  export async function sendCalendarEventEmbed(client, roomId, eventId) {
    hydrateCalendarStateFromVault({
      silent: true,
    });
  
    const ev = state.calendarEvents.get(String(eventId || ''));
  
    if (!ev) {
      toast('Calendar event not found.', 'error');
      throw new Error('Calendar event not found.');
    }
  
    return sendYantaEmbed(client, roomId, {
      type: 'event',
      title: ev.title || 'Untitled event',
      icon: ev.icon || 'calendar-days',
      color: ev.color || '',
      event: {
        title: ev.title || 'Untitled event',
        start: ev.start,
        end: ev.end || null,
        allDay: !!ev.allDay,
        location: ev.location || '',
        description: ev.description || '',
        recurrence: ev.recurrence || null,
      },
    });
  }
  
  async function drawingPngBlob(noteId, drawingId) {
    const candidates = [
      () => import('../draw.js'),
    ];
  
    for (const load of candidates) {
      try {
        const mod = await load();
  
        const fns = [
          mod.exportDrawingPngBlob,
          mod.drawingPngBlob,
          mod.renderDrawingPngBlob,
          mod.exportDrawingAsPngBlob,
        ].filter((fn) => typeof fn === 'function');
  
        for (const fn of fns) {
          const blob = await fn({
            noteId,
            drawingId,
          });
  
          if (blob instanceof Blob) return blob;
        }
  
        if (typeof mod.drawingThumbnailUrl === 'function') {
          const url = await mod.drawingThumbnailUrl(noteId, drawingId);
          if (url) {
            const res = await fetch(url);
            const blob = await res.blob();
            if (blob?.size) return blob;
          }
        }
      } catch (err) {
        console.warn('[YANTA Embeds] Drawing export adapter failed', err);
      }
    }
  
    /*
      Fallback: no export adapter available.
      We intentionally do not try to render Excalidraw ourselves here because
      doing so would duplicate draw.js rendering logic and risk inconsistent
      output/security behavior.
    */
    throw new Error('Drawing PNG export is not available. Export helper missing in draw.js.');
  }
  
  /**
   * Sends drawing as m.image followed by YANTA drawing embed metadata.
   */
  export async function sendDrawingEmbed(client, roomId, {
    noteId,
    drawingId,
  } = {}) {
    const found = findDrawing(drawingId, noteId);
  
    if (!found?.drawing) {
      toast('Drawing not found.', 'error');
      throw new Error('Drawing not found.');
    }
  
    const title = found.drawing.title || 'Drawing';
    const blob = await drawingPngBlob(found.noteId, found.drawingId);
  
    const imageResult = await sendPngImageEvent(client, roomId, blob, {
      name: `${title.replace(/[^a-z0-9_-]+/gi, '_') || 'drawing'}.png`,
      title,
    });
  
    const imageEventId = eventIdFromSendResult(imageResult);
  
    return sendYantaEmbed(client, roomId, {
      type: 'drawing',
      title,
      icon: 'line-squiggle',
      color: '#38bdf8',
      drawing: {
        imageEventNote: imageEventId
          ? `Bild hängt als eigenes m.image direkt davor: ${imageEventId}`
          : 'Bild hängt als eigenes m.image direkt davor',
      },
    }, {
      relatesTo: {
        eventId: imageEventId,
        relType: YANTA_EMBED_MEDIA_REL_TYPE,
      },
    });
  }
  
  /**
   * Sends a source/article embed.
   */
  export async function sendSourceEmbed(client, roomId, source = {}) {
    return sendYantaEmbed(client, roomId, {
      type: 'source',
      title: source.title || 'Source',
      icon: 'rss',
      color: '#f59e0b',
      source: {
        title: source.title || 'Source',
        url: source.url || '',
        feedTitle: source.feedTitle || '',
        publishedAt: source.publishedAt || null,
      },
    });
  }
  
  function eventDateText(ev = {}) {
    const s = ev.start ? new Date(ev.start) : null;
  
    if (!s || Number.isNaN(s.getTime())) return '';
  
    const start = ev.allDay
      ? s.toLocaleDateString()
      : s.toLocaleString([], {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
  
    if (!ev.end) return start;
  
    const e = new Date(ev.end);
  
    if (Number.isNaN(e.getTime())) return start;
  
    const end = ev.allDay
      ? e.toLocaleDateString()
      : e.toLocaleString([], {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
  
    return `${start} – ${end}`;
  }
  
  function embedIcon(embed = {}) {
    if (embed.icon) return embed.icon;
  
    if (embed.type === 'note') return 'file-text';
    if (embed.type === 'event') return 'calendar-days';
    if (embed.type === 'drawing') return 'line-squiggle';
    if (embed.type === 'source') return 'rss';
    if (embed.type === 'publicShare') return 'share';
  
    return 'sparkles';
  }
  
  async function saveEmbedNote(embed) {
    const note = embed.note || {};
  
    await createNoteAction({
      title: embed.title || 'Imported chat note',
      body: String(note.markdown || ''),
      tags: Array.isArray(note.tags) ? note.tags : [],
      icon: embed.icon || 'file-text',
      color: embed.color || undefined,
    });
  
    toast('Saved as note', 'success');
  }
  
  async function importEmbedEvent(embed) {
    const event = embed.event || {};
  
    const ok = await yantaConfirm({
      title: 'Add event to calendar?',
      message: [
        event.title || embed.title || 'Untitled event',
        eventDateText(event),
        event.location ? `Location: ${event.location}` : '',
      ].filter(Boolean).join('\n'),
      confirmLabel: 'Add event',
      cancelLabel: 'Cancel',
      icon: 'calendar-plus',
    });
  
    if (!ok) return;
  
    const saved = putCalendarEvent({
      title: event.title || embed.title || 'Untitled event',
      start: event.start,
      end: event.end || null,
      allDay: !!event.allDay,
      location: event.location || '',
      description: event.description || '',
      recurrence: event.recurrence || null,
      icon: embed.icon || 'calendar-days',
      color: embed.color || undefined,
    });
  
    if (!saved) {
      toast('Could not add calendar event.', 'error');
      console.warn('[YANTA Embeds] putCalendarEvent returned null', embed);
      return;
    }
  
    toast('Event added to calendar', 'success');
  }
  
  async function followSource(embed) {
    const url = embed.source?.url || '';
  
    if (!url) {
      toast('Source has no URL.', 'error');
      return;
    }
  
    try {
      const mod = await import('../rss/rss-actions.js');
      const fn =
        mod.addRssSourceAction ||
        mod.rssAddSourceAction ||
        mod.addRssFeedFromUniversalInput;
  
      if (typeof fn !== 'function') {
        throw new Error('RSS source action is not available.');
      }
  
      await fn({
        input: url,
        url,
      });
  
      toast('Source followed', 'success');
    } catch (err) {
      console.warn('[YANTA Embeds] Could not follow source', err);
      toast('Could not follow source.', 'error');
    }
  }
  
  function openUrl(url = '') {
    const clean = String(url || '').trim();
  
    if (!clean) {
      toast('Link is missing.', 'error');
      return;
    }
  
    try {
      const u = new URL(clean, location.href);
  
      if (u.origin === location.origin) {
        location.href = u.href;
        return;
      }
  
      window.open(u.href, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.warn('[YANTA Embeds] Invalid URL', err);
      toast('Could not open link.', 'error');
    }
  }
  
  function actionsHtml(embed = {}) {
    if (embed.type === 'note') {
      return `
        <button class="btn compact primary" data-yanta-embed-action="save-note">
          ${lucide('notebook-pen', 13)}
          Als Note speichern
        </button>
      `;
    }
  
    if (embed.type === 'event') {
      return `
        <button class="btn compact primary" data-yanta-embed-action="import-event">
          ${lucide('calendar-plus', 13)}
          In Kalender übernehmen
        </button>
      `;
    }
  
    if (embed.type === 'source') {
      return `
        <button class="btn compact primary" data-yanta-embed-action="open-source">
          ${lucide('external-link', 13)}
          Öffnen
        </button>
        <button class="btn compact" data-yanta-embed-action="follow-source">
          ${lucide('rss', 13)}
          Quelle folgen
        </button>
      `;
    }
  
    if (embed.type === 'publicShare') {
      return `
        <button class="btn compact primary" data-yanta-embed-action="open-public-share">
          ${lucide('external-link', 13)}
          Öffnen
        </button>
      `;
    }
  
    return '';
  }
  
  function metaHtml(embed = {}) {
    if (embed.type === 'note') {
      const tags = embed.note?.tags || [];
      const suffix = embed.note?.truncated ? ' · truncated' : '';
  
      return [
        tags.length ? `#${tags.slice(0, 5).map(escapeHtml).join(' #')}` : '',
        `${fmtBytes(markdownBytes(embed.note?.markdown || ''))}${suffix}`,
      ].filter(Boolean).join(' · ');
    }
  
    if (embed.type === 'event') {
      return eventDateText(embed.event || {});
    }
  
    if (embed.type === 'source') {
      return [
        embed.source?.feedTitle || '',
        embed.source?.publishedAt
          ? new Date(embed.source.publishedAt).toLocaleDateString()
          : '',
      ].filter(Boolean).join(' · ');
    }
  
    if (embed.type === 'publicShare') {
      return embed.publicShare?.url || '';
    }
  
    if (embed.type === 'drawing') {
      return '';
    }
  
    return '';
  }
  
  /**
   * Renders one YANTA embed card for a Matrix event.
   */
  export function renderYantaEmbedCard(event, {
    client = null,
    room = null,
  } = {}) {
    const content = event?.getClearContent?.() || event?.getContent?.() || event?.event?.content || {};
    const embed = content?.[YANTA_EMBED_KEY];
  
    if (!embed || embed.v !== 1 || !embed.type) return null;
  
    const card = el('article', {
      class: `yanta-chat-embed-card yanta-chat-embed-${embed.type}`,
      style: {
        '--embed-color': safeColor(embed.color || '') || 'var(--accent)',
      },
    });
  
    const icon = el('span', {
      class: 'yanta-chat-embed-icon',
    });
  
    icon.innerHTML = lucide(embedIcon(embed), 20);
  
    const main = el('span', {
      class: 'yanta-chat-embed-main',
    });
  
    const title = el('strong', {
      class: 'yanta-chat-embed-title',
    }, embed.title || 'YANTA item');
  
    const meta = el('small', {
      class: 'yanta-chat-embed-meta',
    });
  
    meta.textContent = metaHtml(embed);
  
    main.append(title);
  
    if (meta.textContent) {
      main.append(meta);
    }
  
    const actions = el('span', {
      class: 'yanta-chat-embed-actions',
    });
  
    actions.innerHTML = actionsHtml(embed);
  
    card.append(icon, main, actions);
  
    actions.querySelector('[data-yanta-embed-action="save-note"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
  
      await saveEmbedNote(embed);
    });
  
    actions.querySelector('[data-yanta-embed-action="import-event"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
  
      await importEmbedEvent(embed);
    });
  
    actions.querySelector('[data-yanta-embed-action="open-source"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
  
      openUrl(embed.source?.url || '');
    });
  
    actions.querySelector('[data-yanta-embed-action="follow-source"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
  
      await followSource(embed);
    });
  
    actions.querySelector('[data-yanta-embed-action="open-public-share"]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
  
      openUrl(embed.publicShare?.url || '');
    });
  
    return card;
  }
  
  /**
   * Decorates rendered timeline DOM rows with YANTA embed cards.
   */
  export function decorateTimelineWithYantaEmbeds(eventsHost, events = [], options = {}) {
    if (!eventsHost) return;
  
    ensureEmbedCss();
  
    const byId = new Map();
  
    for (const event of events || []) {
      const id = event?.getId?.() || event?.event?.event_id || '';
      if (id) byId.set(id, event);
    }
  
    for (const row of eventsHost.querySelectorAll('[data-event-id]')) {
      const event = byId.get(row.dataset.eventId);
  
      if (!event) continue;
  
      const card = renderYantaEmbedCard(event, options);
  
      if (!card) continue;
  
      const bubble = row.querySelector('.yanta-chat-bubble') || row;
  
      bubble.replaceChildren(card);
      row.classList.add('has-yanta-embed');
    }
  }
  
  function ensureEmbedCss() {
    if (document.getElementById('yanta-chat-embeds-css')) return;
  
    const style = document.createElement('style');
  
    style.id = 'yanta-chat-embeds-css';
    style.textContent = `
  .yanta-chat-event.has-yanta-embed .yanta-chat-bubble {
    padding: 0;
    background: transparent;
    border: 0;
  }
  
  .yanta-chat-embed-card {
    max-width: min(560px, 84vw);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:         "icon main"        "actions actions";
    gap: 10px 12px;
    padding: 13px;
    border: 1px solid 
color-mix(in srgb, var(--embed-color) 36%, var(--border));
    border-radius: 18px;
    background: linear-gradient(135deg, 
color-mix(in srgb, var(--embed-color) 12%, var(--bg-elev)), var(--bg-elev));
    box-shadow: none !important;
  }
  
  .yanta-chat-embed-icon {
    grid-area: icon;
    width: 42px;
    height: 42px;
    display: inline-grid;
    place-items: center;
    border-radius: 14px;
    color: var(--embed-color);
    background: color-mix(in srgb, var(--embed-color) 13%, transparent);
  }
  
  .yanta-chat-embed-main {
    grid-area: main;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  
  .yanta-chat-embed-title {
    color: var(--text);
    font-size: 14px;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .yanta-chat-embed-meta {
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .yanta-chat-embed-actions {
    grid-area: actions;
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    justify-content: flex-end;
  }
  `;
  
    document.head.append(style);
  }
  
  function noteFolderPath(folderId) {
    if (!folderId) return '';
  
    const parts = [];
    const seen = new Set();
    let folder = state.folders.get(folderId);
  
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      parts.unshift(folder.name || 'Folder');
      folder = folder.parentId ? state.folders.get(folder.parentId) : null;
    }
  
    return parts.join(' / ');
  }
  
  function notesForPicker(query = '') {
    const q = String(query || '').trim().toLowerCase();
  
    return [...state.notes.values()]
      .filter((note) => !note.trashed)
      .filter((note) => {
        if (!q) return true;
  
        return [
          note.title || '',
          noteFolderPath(note.folderId),
          (note.tags || []).join(' '),
        ].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0))
      .slice(0, 80);
  }
  
  function eventsForPicker(query = '') {
    hydrateCalendarStateFromVault({
      silent: true,
    });
  
    const q = String(query || '').trim().toLowerCase();
  
    return [...state.calendarEvents.values()]
      .filter((ev) => ev.status !== 'cancelled')
      .filter((ev) => {
        if (!q) return true;
  
        return [
          ev.title || '',
          ev.location || '',
          ev.description || '',
        ].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 80);
  }
  
  function drawingsForPicker(query = '') {
    const q = String(query || '').trim().toLowerCase();
  
    return listAllDrawings()
      .filter((d) => {
        if (!q) return true;
  
        return [
          d.title || '',
          d.noteTitle || '',
          d.text || '',
        ].join(' ').toLowerCase().includes(q);
      })
      .slice(0, 80);
  }
  
  function renderPickerItems(items, type, activeId = '') {
    if (!items.length) {
      return `<div class="yanta-chat-embed-picker-empty">No items found.</div>`;
    }
  
    if (type === 'note') {
      return items.map((note) => `
        <button class="yanta-chat-embed-picker-item" data-id="${escapeHtml(note.id)}" type="button">
          <span>${lucide(note.icon || 'file-text', 16)}</span>
          <span>
            <strong>${escapeHtml(note.title || 'Untitled')}</strong>
            <small>${escapeHtml(noteFolderPath(note.folderId) || (note.tags || []).join(', ') || 'Note')}</small>
          </span>
        </button>
      `).join('');
    }
  
    if (type === 'event') {
      return items.map((ev) => `
        <button class="yanta-chat-embed-picker-item" data-id="${escapeHtml(ev.id)}" type="button">
          <span>${lucide(ev.icon || 'calendar-days', 16)}</span>
          <span>
            <strong>${escapeHtml(ev.title || 'Untitled event')}</strong>
            <small>${escapeHtml(eventDateText(ev))}</small>
          </span>
        </button>
      `).join('');
    }
  
    return items.map((d) => `
      <button class="yanta-chat-embed-picker-item" data-id="${escapeHtml(d.drawingId || d.id)}" data-note-id="${escapeHtml(d.noteId)}" type="button">
        <span>${lucide('line-squiggle', 16)}</span>
        <span>
          <strong>${escapeHtml(d.title || 'Drawing')}</strong>
          <small>${escapeHtml(d.noteTitle || 'Drawing')}</small>
        </span>
      </button>
    `).join('');
  }
  
  /**
   * Opens the YANTA Embed send picker for the Chat composer.
   */
  export function openYantaEmbedSendSheet({
    client,
    roomId,
  } = {}) {
    if (!client || !roomId) {
      toast('Chat is not connected.', 'error');
      console.warn('[YANTA Embeds] Missing client/roomId for send sheet');
      return;
    }
  
    ensureEmbedCss();
  
    if (!pickerOverlay) {
      pickerOverlay = el('div', {
        class: 'yanta-chat-embed-picker-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Send YANTA item',
      });
  
      pickerOverlay.addEventListener('click', (e) => {
        if (e.target === pickerOverlay || e.target.closest?.('[data-close]')) {
          pickerOverlay.remove();
          pickerOverlay = null;
        }
      });
    }
  
    let mode = 'note';
    let noteMode = 'snapshot';
    let query = '';
  
    const render = () => {
      const items =
        mode === 'note'
          ? notesForPicker(query)
          : mode === 'event'
            ? eventsForPicker(query)
            : drawingsForPicker(query);
  
      pickerOverlay.innerHTML = `
        <style>
          .yanta-chat-embed-picker-overlay {
            position: fixed;
            inset: 0;
            z-index: 1340;
            display: grid;
            place-items: center;
            padding: 18px;
            background: rgba(0,0,0,.48);
            backdrop-filter: blur(14px);
          }
  
          .yanta-chat-embed-picker-card {
            width: min(620px, 96vw);
            max-height: min(760px, 92vh);
            display: grid;
            grid-template-rows: auto auto auto 1fr;
            overflow: hidden;
            border: 1px solid var(--border);
            border-radius: 22px;
            background: var(--bg-elev);
            box-shadow: 0 28px 90px rgba(0,0,0,.46);
          }
  
          .yanta-chat-embed-picker-head,
          .yanta-chat-embed-picker-tabs,
          .yanta-chat-embed-picker-search {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 14px;
            border-bottom: 1px solid var(--border);
          }
  
          .yanta-chat-embed-picker-tabs button {
            flex: 1;
          }
  
          .yanta-chat-embed-picker-tabs button.active {
            color: var(--accent);
            border-color: color-mix(in srgb, var(--accent) 38%, var(--border));
            background: color-mix(in srgb, var(--accent) 10%, transparent);
          }
  
          .yanta-chat-embed-picker-search input {
            min-width: 0;
            flex: 1;
          }
  
          .yanta-chat-embed-picker-note-mode {
            display: flex;
            gap: 8px;
            padding: 10px 14px;
            border-bottom: 1px solid var(--border);
          }
  
          .yanta-chat-embed-picker-note-mode label {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--text-dim);
            font-size: 12px;
            font-weight: 750;
          }
  
          .yanta-chat-embed-picker-list {
            overflow: auto;
            padding: 10px;
          }
  
          .yanta-chat-embed-picker-item {
            width: 100%;
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            gap: 10px;
            align-items: center;
            padding: 11px 12px;
            border: 1px solid transparent;
            border-radius: 15px;
            background: transparent;
            color: var(--text);
            text-align: left;
            cursor: pointer;
          }
  
          .yanta-chat-embed-picker-item:hover {
            border-color: color-mix(in srgb, var(--accent) 36%, var(--border));
            background: color-mix(in srgb, var(--accent) 9%, transparent);
          }
  
          .yanta-chat-embed-picker-item strong {
            display: block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
  
          .yanta-chat-embed-picker-item small {
            color: var(--text-faint);
            font-size: 11px;
          }
  
          .yanta-chat-embed-picker-empty {
            min-height: 180px;
            display: grid;
            place-items: center;
            color: var(--text-faint);
          }
        </style>
  
        <section class="yanta-chat-embed-picker-card">
          <header class="yanta-chat-embed-picker-head">
            ${lucide('paperclip', 20)}
            <strong>YANTA item senden</strong>
            <span class="grow"></span>
            <button class="icon-btn" data-close title="Close" aria-label="Close">${lucide('x', 18)}</button>
          </header>
  
          <nav class="yanta-chat-embed-picker-tabs">
            <button class="btn ${mode === 'note' ? 'active' : ''}" data-mode="note">${lucide('file-text', 14)} Note</button>
            <button class="btn ${mode === 'event' ? 'active' : ''}" data-mode="event">${lucide('calendar-days', 14)} Event</button>
            <button class="btn ${mode === 'drawing' ? 'active' : ''}" data-mode="drawing">${lucide('line-squiggle', 14)} Drawing</button>
          </nav>
  
          ${
            mode === 'note'
              ? `
                <div class="yanta-chat-embed-picker-note-mode">
                  <label>
                    <input type="radio" name="noteMode" value="snapshot" ${noteMode === 'snapshot' ? 'checked' : ''}>
                    Snapshot senden
                  </label>
                  <label>
                    <input type="radio" name="noteMode" value="live" ${noteMode === 'live' ? 'checked' : ''}>
                    Live-Link senden
                  </label>
                </div>
              `
              : ''
          }
  
          <div class="yanta-chat-embed-picker-search">
            ${lucide('search', 15)}
            <input class="text-input" data-search value="${escapeHtml(query)}" placeholder="Search…" autocomplete="off" spellcheck="false">
          </div>
  
          <div class="yanta-chat-embed-picker-list">
            ${renderPickerItems(items, mode)}
          </div>
        </section>
      `;
  
      pickerOverlay.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          mode = btn.dataset.mode || 'note';
          query = '';
          render();
        });
      });
  
      pickerOverlay.querySelectorAll('input[name="noteMode"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          noteMode = radio.value === 'live' ? 'live' : 'snapshot';
        });
      });
  
      pickerOverlay.querySelector('[data-search]')?.addEventListener('input', (e) => {
        query = e.target.value || '';
        render();
      });
  
      pickerOverlay.querySelectorAll('[data-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const id = btn.dataset.id;
  
            if (mode === 'note') {
              if (noteMode === 'live') {
                await sendNotePublicShareEmbed(client, roomId, id);
              } else {
                await sendNoteSnapshotEmbed(client, roomId, id);
              }
            } else if (mode === 'event') {
              await sendCalendarEventEmbed(client, roomId, id);
            } else {
              await sendDrawingEmbed(client, roomId, {
                noteId: btn.dataset.noteId,
                drawingId: id,
              });
            }
  
            pickerOverlay.remove();
            pickerOverlay = null;
          } catch (err) {
            console.warn('[YANTA Embeds] Could not send selected item', err);
            toast('Could not send YANTA item.', 'error');
          }
        });
      });
  
      requestAnimationFrame(() => {
        pickerOverlay?.querySelector('[data-search]')?.focus();
      });
    };
  
    document.body.append(pickerOverlay);
    render();
  }
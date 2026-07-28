// ============================================================
// YANTA Chat — AP7 export/import
//
// Exports a decrypted local view of one Matrix chat into stable YANTA schema.
// Import opens a local read-only archive, never reinjects messages into Matrix.
// ============================================================

import {
    downloadBlob,
    el,
    escapeHtml,
    fmtBytes,
    lucide,
    safeFilename,
    toast,
  } from '../core.js';
  
  import {
    yantaConfirm,
  } from '../dialogs.js';

  import { openBoundOverlay } from '../overlay-history.js';
  
  import {
    makeZip,
    readZip,
  } from '../sync2/capsule.js';
  
  import {
    mxcToBlob,
  } from './chat-media.js';
  
  import {
    saveImportedChatArchive,
    openImportedChatArchive,
  } from './chat-archive.js';
  
  import {
    ensureMatrixLoaded,
  } from './matrix-session.js';
  
  const EXPORT_FORMAT = 'yanta-chat-export';
  const EXPORT_VERSION = 1;
  
  let EventTimeline = null;
  let TimelineWindow = null;
  
  const te = new TextEncoder();
  const td = new TextDecoder();
  
  function nowIso() {
    return new Date().toISOString();
  }
  
  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }
  
  function bytes(str) {
    return te.encode(String(str || ''));
  }
  
  function text(bytesValue) {
    return td.decode(bytesValue);
  }
  
  async function ensureMatrixSdkClasses() {
    if (TimelineWindow && EventTimeline) return;
  
    const { sdk } = await ensureMatrixLoaded();
  
    TimelineWindow = sdk.TimelineWindow;
    EventTimeline = sdk.EventTimeline;
  }
  
  function cleanFilenamePart(value) {
    return safeFilename(String(value || 'chat').replace(/^!/, '').slice(0, 90)) || 'chat';
  }
  
  function roomDisplayName(client, room) {
    try {
      return room?.name || room?.getDefaultRoomName?.(client?.getUserId?.()) || 'Chat';
    } catch {
      return 'Chat';
    }
  }
  
  function eventIdOf(event) {
    return event?.getId?.() || event?.event?.event_id || '';
  }
  
  function senderOf(event) {
    return event?.getSender?.() || event?.event?.sender || '';
  }
  
  function tsOf(event) {
    return Number(event?.getTs?.() || event?.event?.origin_server_ts || 0);
  }
  
  function typeOf(event) {
    return event?.getType?.() || event?.event?.type || '';
  }
  
  function clearContentOf(event) {
    try {
      return event?.getClearContent?.() || event?.getContent?.() || event?.event?.content || {};
    } catch (err) {
      console.warn('[YANTA Chat Export] Could not read event content', err);
      toast('Could not read chat message.', 'error');
      return {};
    }
  }
  
  function attachmentFromContent(content = {}) {
    const info = content.info || {};
    const encryptedFile = content.file || null;
    const mxcUrl = encryptedFile?.url || content.url || '';
  
    if (!mxcUrl) return null;
  
    return {
      kind: String(content.msgtype || '').replace(/^m\./, '') || 'file',
      name: String(content.body || 'Attachment'),
      mxcUrl,
      encryptedFile,
      mime: info.mimetype || encryptedFile?.mimetype || '',
      size: Number(info.size || 0),
      width: Number(info.w || 0),
      height: Number(info.h || 0),
    };
  }
  
  function exportMessageFromEvent(event, {
    ownUserId = '',
  } = {}) {
    const content = clearContentOf(event);
    const msgtype = String(content?.msgtype || '');
    const body = String(content?.body || '');
  
    if (typeOf(event) !== 'm.room.message' && typeOf(event) !== 'm.sticker') {
      return null;
    }
  
    if (!body && !content?.url && !content?.file) return null;
  
    const attachment = attachmentFromContent(content);
  
    return {
      id: eventIdOf(event),
      eventId: eventIdOf(event),
      type: typeOf(event),
      msgtype,
      ts: tsOf(event),
      iso: tsOf(event) ? new Date(tsOf(event)).toISOString() : '',
      sender: senderOf(event),
      own: ownUserId ? senderOf(event) === ownUserId : false,
      body,
      attachments: attachment ? [attachment] : [],
    };
  }
  
  async function loadRoomEvents(client, roomId, {
    maxEvents = 10000,
    onProgress = null,
  } = {}) {
    await ensureMatrixSdkClasses();
  
    const room = client.getRoom?.(roomId);
  
    if (!room) {
      throw new Error('Chat room not found.');
    }
  
    const win = new TimelineWindow(client, room, {
      windowLimit: Math.min(Math.max(maxEvents, 100), 10000),
    });
  
    await win.load(undefined, Math.min(80, maxEvents));
  
    while ((win.getEvents?.().length || 0) < maxEvents) {
      const canMore =
        typeof win.canPaginate === 'function'
          ? win.canPaginate(EventTimeline.BACKWARDS)
          : false;
  
      if (!canMore) break;
  
      const before = win.getEvents?.().length || 0;
  
      await win.paginate(EventTimeline.BACKWARDS, 80);
  
      const after = win.getEvents?.().length || 0;
  
      onProgress?.({
        loaded: after,
      });
  
      if (after <= before) break;
  
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  
    return win.getEvents?.() || [];
  }
  
  async function mediaEntriesForMessages(client, messages = []) {
    const entries = [];
    const manifestMedia = [];
  
    for (const msg of messages) {
      for (const attachment of msg.attachments || []) {
        if (!attachment.mxcUrl) continue;
  
        try {
          const blob = await mxcToBlob(client, attachment.mxcUrl, {
            thumbnail: false,
            encryptedFile: attachment.encryptedFile || null,
            mimeType: attachment.mime || '',
          });
  
          const ext = attachment.mime?.split('/')?.[1]
            ? `.${attachment.mime.split('/')[1].replace(/[^a-z0-9]+/gi, '')}`
            : '';
  
          const name = safeFilename(
            `${msg.eventId || msg.id}_${attachment.name || 'media'}`
          ) || `media_${entries.length + 1}${ext}`;
  
          const path = `media/${name}`;
  
          entries.push({
            path,
            data: new Uint8Array(await blob.arrayBuffer()),
          });
  
          manifestMedia.push({
            eventId: msg.eventId,
            path,
            name: attachment.name || name,
            mime: blob.type || attachment.mime || '',
            size: blob.size || attachment.size || 0,
          });
        } catch (err) {
          console.warn('[YANTA Chat Export] Could not export media attachment', err);
          toast('Could not export one media attachment.', 'error');
        }
      }
    }
  
    return {
      entries,
      manifestMedia,
    };
  }
  
  function markdownForArchive(archive) {
    const lines = [];
    let lastDay = '';
  
    lines.push(`# ${archive.meta.roomName || 'Chat export'}`);
    lines.push('');
    lines.push(`Exported: ${archive.exportedAt}`);
    lines.push(`Messages: ${archive.messages.length}`);
    lines.push('');
  
    for (const msg of archive.messages) {
      const ts = Number(msg.ts || 0);
      const day = ts ? new Date(ts).toISOString().slice(0, 10) : '';
  
      if (day && day !== lastDay) {
        lines.push('');
        lines.push(`## ${day}`);
        lines.push('');
        lastDay = day;
      }
  
      const time = ts
        ? new Date(ts).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
  
      lines.push(`**${msg.sender || 'Unknown'}** ${time}`);
      lines.push('');
      lines.push(msg.body || '');
  
      for (const att of msg.attachments || []) {
        lines.push('');
        lines.push(`📎 ${att.name || att.mxcUrl || 'Attachment'}`);
      }
  
      lines.push('');
    }
  
    return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
  }
  
  async function archiveForRoom(client, roomId, {
    maxEvents = 10000,
    onProgress = null,
  } = {}) {
    const room = client.getRoom?.(roomId);
  
    if (!room) {
      throw new Error('Chat room not found.');
    }
  
    const ownUserId = client.getUserId?.() || '';
    const events = await loadRoomEvents(client, roomId, {
      maxEvents,
      onProgress,
    });
  
    const messages = events
      .map((event) => exportMessageFromEvent(event, {
        ownUserId,
      }))
      .filter(Boolean)
      .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: nowIso(),
      app: {
        name: 'YANTA',
      },
      meta: {
        roomId,
        roomName: roomDisplayName(client, room),
        ownUserId,
      },
      messages,
    };
  }
  
  /**
   * Exports one Matrix chat as a YANTA chat ZIP archive.
   */
  export async function exportChatAsYantaZip(client, roomId, {
    includeMedia = false,
    maxEvents = 10000,
  } = {}) {
    try {
      if (!client || !roomId) {
        throw new Error('Chat is not connected.');
      }
  
      if (includeMedia) {
        const ok = await yantaConfirm({
          title: 'Media export can be large',
          message: 'Including images/files can create a large ZIP and may take a while. Continue?',
          confirmLabel: 'Export with media',
          cancelLabel: 'Cancel',
          danger: false,
          icon: 'download',
        });
  
        if (!ok) return null;
      }
  
      toast('Preparing chat export…', 'success');
  
      const archive = await archiveForRoom(client, roomId, {
        maxEvents,
      });
  
      const entries = [
        {
          path: 'chat.json',
          data: bytes(JSON.stringify(archive, null, 2)),
        },
      ];
  
      if (includeMedia) {
        const media = await mediaEntriesForMessages(client, archive.messages);
  
        archive.media = media.manifestMedia;
        entries[0] = {
          path: 'chat.json',
          data: bytes(JSON.stringify(archive, null, 2)),
        };
  
        entries.push(...media.entries);
      }
  
      const blob = makeZip(entries);
      const filename = `${cleanFilenamePart(archive.meta.roomName)}-${dateStamp()}.yanta-chat.zip`;
  
      downloadBlob(blob, filename);
  
      toast('Chat export created', 'success');
  
      return {
        archive,
        blob,
        filename,
      };
    } catch (err) {
      console.warn('[YANTA Chat Export] ZIP export failed', err);
      toast('Could not export chat.', 'error');
      throw err;
    }
  }
  
  /**
   * Exports one Matrix chat as Markdown.
   */
  export async function exportChatAsMarkdown(client, roomId, {
    maxEvents = 10000,
  } = {}) {
    try {
      if (!client || !roomId) {
        throw new Error('Chat is not connected.');
      }
  
      const archive = await archiveForRoom(client, roomId, {
        maxEvents,
      });
  
      const md = markdownForArchive(archive);
      const blob = new Blob([md], {
        type: 'text/markdown;charset=utf-8',
      });
  
      const filename = `${cleanFilenamePart(archive.meta.roomName)}-${dateStamp()}.md`;
  
      downloadBlob(blob, filename);
  
      toast('Markdown export created', 'success');
  
      return {
        archive,
        markdown: md,
        blob,
        filename,
      };
    } catch (err) {
      console.warn('[YANTA Chat Export] Markdown export failed', err);
      toast('Could not export Markdown.', 'error');
      throw err;
    }
  }
  
  async function createNoteFromMarkdown({
    title,
    markdown,
  } = {}) {
    try {
      const mod = await import('../ai/app-actions.js');
      const fn = mod.createNoteAction;
  
      if (typeof fn !== 'function') {
        throw new Error('createNoteAction is not available.');
      }
  
      /*
        createNoteAction is an app-level action and may evolve. Keep this adapter
        tolerant so Chat export does not duplicate note-creation logic.
      */
      try {
        return await fn({
          title,
          body: markdown,
          markdown,
          type: 'markdown',
          source: 'chat-export',
        });
      } catch (firstErr) {
        console.warn('[YANTA Chat Export] createNoteAction object call failed, trying legacy signature', firstErr);
  
        return await fn(title, markdown);
      }
    } catch (err) {
      console.warn('[YANTA Chat Export] Could not create YANTA note from chat', err);
      toast('Could not save chat as YANTA note.', 'error');
      throw err;
    }
  }
  
  /**
   * Saves one Matrix chat export as a YANTA note.
   */
  export async function saveChatAsYantaNote(client, roomId, {
    maxEvents = 10000,
  } = {}) {
    try {
      if (!client || !roomId) {
        throw new Error('Chat is not connected.');
      }
  
      const archive = await archiveForRoom(client, roomId, {
        maxEvents,
      });
  
      const markdown = markdownForArchive(archive);
      const title = `Chat · ${archive.meta.roomName || roomId} · ${dateStamp()}`;
  
      const note = await createNoteFromMarkdown({
        title,
        markdown,
      });
  
      toast('Chat saved as YANTA note', 'success');
  
      return note;
    } catch (err) {
      console.warn('[YANTA Chat Export] Save as note failed', err);
      toast('Could not save chat as note.', 'error');
      throw err;
    }
  }
  
  /**
   * Imports a yanta-chat-export ZIP into the local read-only archive viewer.
   */
  export async function importYantaChatExportFile(file) {
    try {
      if (!file) {
        throw new Error('No file selected.');
      }
  
      const entries = await readZip(file);
      const byPath = new Map(entries.filter((e) => !e.isDir).map((e) => [e.path, e]));
      const chatEntry = byPath.get('chat.json');
  
      if (!chatEntry) {
        throw new Error('chat.json missing.');
      }
  
      const archive = JSON.parse(text(chatEntry.data));
  
      if (archive?.format !== EXPORT_FORMAT || archive?.version !== EXPORT_VERSION) {
        throw new Error('Unsupported YANTA chat export.');
      }
  
      const row = await saveImportedChatArchive(archive);
  
      await openImportedChatArchive(row.id);
  
      return row;
    } catch (err) {
      console.warn('[YANTA Chat Export] Import failed', err);
      toast('Could not import chat archive.', 'error');
      throw err;
    }
  }
  
  /**
   * Opens a file picker and imports a YANTA chat export ZIP.
   */
  export async function pickAndImportYantaChatExport() {
    const input = el('input', {
      type: 'file',
      accept: '.zip,.yanta-chat.zip,application/zip,application/octet-stream',
      hidden: true,
    });
  
    document.body.append(input);
  
    return new Promise((resolve, reject) => {
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
  
        input.remove();
  
        if (!file) {
          resolve(null);
          return;
        }
  
        try {
          resolve(await importYantaChatExportFile(file));
        } catch (err) {
          reject(err);
        }
      }, {
        once: true,
      });
  
      input.click();
    });
  }
  
  /**
   * Opens a compact export sheet for one chat.
   */
  export function openChatExportSheet(client, roomId, {
    roomName = 'Chat',
  } = {}) {
    const overlay = el('div', {
      class: 'yanta-chat-export-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Export chat',
    });
  
    overlay.innerHTML = `
      <style>
        .yanta-chat-export-sheet {
          position: fixed;
          inset: 0;
          z-index: 1330;
          display: grid;
          place-items: center;
          padding: 18px;
          background: rgba(0,0,0,.48);
          backdrop-filter: blur(14px);
        }
  
        .yanta-chat-export-card {
          width: min(520px, 94vw);
          border: 1px solid var(--border);
          border-radius: 22px;
          background: var(--bg-elev);
          box-shadow: 0 28px 90px rgba(0,0,0,.46);
          overflow: hidden;
        }
  
        .yanta-chat-export-card header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
        }
  
        .yanta-chat-export-body {
          display: grid;
          gap: 10px;
          padding: 14px;
        }
  
        .yanta-chat-export-option {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 13px;
          border: 1px solid var(--border);
          border-radius: 16px;
          background: var(--bg-elev-2);
          color: var(--text);
          text-align: left;
          cursor: pointer;
        }
  
        .yanta-chat-export-option:hover {
          border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
          background: color-mix(in srgb, var(--accent) 9%, var(--bg-elev-2));
        }
  
        .yanta-chat-export-option span {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
  
        .yanta-chat-export-option small {
          color: var(--text-faint);
        }
  
        .yanta-chat-export-media {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 4px 8px;
          color: var(--text-dim);
          font-size: 12px;
        }
      </style>
  
      <section class="yanta-chat-export-card">
        <header>
          <span style="display:inline-flex;color:var(--accent)">${lucide('download', 22)}</span>
          <strong>${escapeHtml(roomName)}</strong>
          <span class="grow"></span>
          <button class="icon-btn" data-close title="Close" aria-label="Close">${lucide('x', 18)}</button>
        </header>
  
        <div class="yanta-chat-export-body">
          <label class="yanta-chat-export-media">
            <input type="checkbox" data-include-media>
            <span>Include media folder. Large exports may take longer.</span>
          </label>
  
          <button class="yanta-chat-export-option" data-export-zip>
            ${lucide('archive', 20)}
            <span>
              <strong>YANTA chat ZIP</strong>
              <small>chat.json plus optional media/</small>
            </span>
          </button>
  
          <button class="yanta-chat-export-option" data-export-md>
            ${lucide('file-text', 20)}
            <span>
              <strong>Markdown</strong>
              <small>Readable flowing transcript with date separators</small>
            </span>
          </button>
  
          <button class="yanta-chat-export-option" data-save-note>
            ${lucide('notebook-pen', 20)}
            <span>
              <strong>Save as YANTA note</strong>
              <small>Uses createNoteAction from src/ai/app-actions.js</small>
            </span>
          </button>
  
          <button class="yanta-chat-export-option" data-import>
            ${lucide('upload', 20)}
            <span>
              <strong>Import YANTA chat ZIP</strong>
              <small>Creates local read-only archive section</small>
            </span>
          </button>
        </div>
      </section>
    `;
  
    const close = () => {
      overlay.remove();
      release?.();
    };

    const release = openBoundOverlay('chat-export', {
      close,
      isOpen: () => overlay.isConnected,
    });
  
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest?.('[data-close]')) {
        close();
      }
    });
  
    overlay.querySelector('[data-export-zip]')?.addEventListener('click', async () => {
      const includeMedia = !!overlay.querySelector('[data-include-media]')?.checked;
  
      await exportChatAsYantaZip(client, roomId, {
        includeMedia,
      });
  
      close();
    });
  
    overlay.querySelector('[data-export-md]')?.addEventListener('click', async () => {
      await exportChatAsMarkdown(client, roomId);
      close();
    });
  
    overlay.querySelector('[data-save-note]')?.addEventListener('click', async () => {
      await saveChatAsYantaNote(client, roomId);
      close();
    });
  
    overlay.querySelector('[data-import]')?.addEventListener('click', async () => {
      await pickAndImportYantaChatExport();
      close();
    });
  
    document.body.append(overlay);
  }
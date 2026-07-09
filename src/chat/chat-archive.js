// ============================================================
// YANTA Chat — AP7 imported read-only archive viewer
//
// Imported chat exports are local read-only archives.
// Re-injection into real Matrix rooms is intentionally not provided: it would
// forge chronology/senders and can create privacy and moderation issues.
// ============================================================

import {
    el,
    escapeHtml,
    lucide,
    toast,
  } from '../core.js';
  
  import {
    chatStore,
  } from './chat-store.js';
  
  let overlay = null;
  
  function ensureCss() {
    if (document.getElementById('yanta-chat-archive-css')) return;
  
    const style = document.createElement('style');
  
    style.id = 'yanta-chat-archive-css';
    style.textContent = `
  .yanta-chat-archive-overlay {
    position: fixed;
    inset: 0;
    z-index: 1310;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(0,0,0,.48);
    backdrop-filter: blur(14px);
  }
  
  .yanta-chat-archive-overlay[hidden] {
    display: none !important;
  }
  
  .yanta-chat-archive-card {
    width: min(860px, 96vw);
    height: min(760px, 92vh);
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 22px;
    background: var(--bg-elev);
    box-shadow: 0 28px 90px rgba(0,0,0,.46);
  }
  
  .yanta-chat-archive-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 15px;
    border-bottom: 1px solid var(--border);
  }
  
  .yanta-chat-archive-title {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .yanta-chat-archive-title strong {
    color: var(--text);
  }
  
  .yanta-chat-archive-title small {
    color: var(--text-faint);
    font-size: 12px;
  }
  
  .yanta-chat-archive-body {
    overflow: auto;
    padding: 18px;
    background: var(--bg);
  }
  
  .yanta-chat-archive-day {
    position: sticky;
    top: 0;
    z-index: 1;
    width: max-content;
    margin: 18px auto 12px;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elev);
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 800;
  }
  
  .yanta-chat-archive-msg {
    max-width: 76%;
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg-elev);
  }
  
  .yanta-chat-archive-msg.own {
    margin-left: auto;
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-elev));
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }
  
  .yanta-chat-archive-msg-head {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    margin-bottom: 5px;
    color: var(--text-faint);
    font-size: 11px;
  }
  
  .yanta-chat-archive-msg-body {
    white-space: pre-wrap;
    color: var(--text);
    line-height: 1.42;
  }
  
  .yanta-chat-archive-attachment {
    margin-top: 8px;
    color: var(--text-dim);
    font-size: 12px;
  }
  `;
  
    document.head.append(style);
  }
  
  function ensureOverlay() {
    if (overlay) return overlay;
  
    ensureCss();
  
    overlay = el('div', {
      class: 'yanta-chat-archive-overlay',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Imported chat archive',
    });
  
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest?.('[data-archive-close]')) {
        closeImportedChatArchive();
      }
    });
  
    document.body.append(overlay);
  
    return overlay;
  }
  
  function archiveTitle(archive) {
    return archive?.meta?.roomName || archive?.room?.name || archive?.title || 'Imported Chat';
  }
  
  function dayKey(ts) {
    if (!ts) return '';
    return new Date(ts).toISOString().slice(0, 10);
  }
  
  function dayLabel(ts) {
    try {
      return new Date(ts).toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dayKey(ts);
    }
  }
  
  /**
   * Persists one imported YANTA chat archive locally.
   */
  export async function saveImportedChatArchive(archive) {
    try {
      const id =
        archive?.id ||
        `archive_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  
      const row = {
        id,
        kind: 'yanta-chat-archive',
        title: archiveTitle(archive),
        importedAt: Date.now(),
        updatedAt: Date.now(),
        archive,
      };
  
      await chatStore.archives.put(row);
  
      window.dispatchEvent(new CustomEvent('yanta-chat-archives-changed'));
  
      toast('Chat archive imported', 'success');
  
      return row;
    } catch (err) {
      console.warn('[YANTA Chat Archive] Could not save archive', err);
      toast('Could not save chat archive.', 'error');
      throw err;
    }
  }
  
  /**
   * Lists imported read-only chat archives.
   */
  export async function listImportedChatArchives() {
    try {
      const rows = await chatStore.archives.all();
  
      return rows
        .filter((row) => row?.kind === 'yanta-chat-archive')
        .sort((a, b) => Number(b.importedAt || 0) - Number(a.importedAt || 0));
    } catch (err) {
      console.warn('[YANTA Chat Archive] Could not list archives', err);
      toast('Could not list chat archives.', 'error');
      return [];
    }
  }
  
  /**
   * Opens an imported chat archive in a local read-only viewer.
   */
  export async function openImportedChatArchive(idOrArchive) {
    try {
      const row = typeof idOrArchive === 'string'
        ? await chatStore.archives.get(idOrArchive, null)
        : {
            archive: idOrArchive,
            title: archiveTitle(idOrArchive),
          };
  
      const archive = row?.archive || idOrArchive;
  
      if (!archive) {
        toast('Chat archive not found.', 'error');
        console.warn('[YANTA Chat Archive] Missing archive', idOrArchive);
        return;
      }
  
      const node = ensureOverlay();
      const messages = Array.isArray(archive.messages) ? archive.messages : [];
  
      let lastDay = '';
  
      node.innerHTML = `
        <section class="yanta-chat-archive-card">
          <header class="yanta-chat-archive-head">
            <span style="display:inline-flex;color:var(--accent)">${lucide('archive', 22)}</span>
            <span class="yanta-chat-archive-title">
              <strong>${escapeHtml(archiveTitle(archive))}</strong>
              <small>Read-only imported archive · ${messages.length} messages</small>
            </span>
            <span class="grow"></span>
            <button class="icon-btn" data-archive-close title="Close" aria-label="Close">${lucide('x', 18)}</button>
          </header>
  
          <div class="yanta-chat-archive-body">
            ${
              messages.map((msg) => {
                const ts = Number(msg.ts || 0);
                const day = dayKey(ts);
                const dayHtml = day && day !== lastDay
                  ? `<div class="yanta-chat-archive-day">${escapeHtml(dayLabel(ts))}</div>`
                  : '';
  
                if (day) lastDay = day;
  
                const attachments = Array.isArray(msg.attachments)
                  ? msg.attachments
                  : [];
  
                return `
                  ${dayHtml}
                  <article class="yanta-chat-archive-msg ${msg.own ? 'own' : ''}">
                    <div class="yanta-chat-archive-msg-head">
                      <strong>${escapeHtml(msg.sender || 'Unknown')}</strong>
                      <span>${escapeHtml(ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}</span>
                    </div>
                    <div class="yanta-chat-archive-msg-body">${escapeHtml(msg.body || '')}</div>
                    ${
                      attachments.length
                        ? `<div class="yanta-chat-archive-attachment">
                            ${attachments.map((a) => `${lucide('paperclip', 13)} ${escapeHtml(a.name || a.mxcUrl || 'Attachment')}`).join('<br>')}
                          </div>`
                        : ''
                    }
                  </article>
                `;
              }).join('')
            }
          </div>
        </section>
      `;
  
      node.hidden = false;
    } catch (err) {
      console.warn('[YANTA Chat Archive] Could not open archive', err);
      toast('Could not open chat archive.', 'error');
    }
  }
  
  /**
   * Closes the imported archive viewer.
   */
  export function closeImportedChatArchive() {
    if (overlay) overlay.hidden = true;
  }
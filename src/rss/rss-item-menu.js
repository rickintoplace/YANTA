// ============================================================
// YANTA RSS — item context menu
//
// The interconnect hub for a source item: right-click (desktop) or
// long-press (Android fires contextmenu natively) offers everything
// the rest of YANTA can do with an article — notes, chat, star,
// read state, archive.
// ============================================================

import { toast, safeUrl } from '../core.js';
import { openNote } from '../notes.js';
import { t } from '../i18n/index.js';

import {
  saveRssItemAsNote,
  appendRssItemToCurrentNote,
  toggleRssItemStar,
  markRssItemRead,
  archiveRssItem,
  sendRssItemAsChatEmbedAction,
} from './rss-actions.js';

async function menuAt(x, y, items) {
  // Warum dynamisch: tree.js ist ein großes Modul mit vielen eigenen
  // Importen — statisch würde das RSS-Modul es immer mitladen.
  const { showMenu } = await import('../tree.js');
  showMenu(x, y, items);
}

function guarded(fn, failMessage) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(err);
      toast(err?.message || failMessage, 'error');
    }
  };
}

/**
 * Second-level menu: pick a chat and send the item as a source embed.
 */
export async function pickChatRoomAndSendRssItem(item, x, y) {
  let client = null;

  try {
    const { resolveMatrixClient } = await import('../chat/chat-actions.js');
    client = await resolveMatrixClient();
  } catch {}

  if (!client) {
    toast(t('rss.menu.chatNotConnected'), 'error');
    return;
  }

  const rooms = (client.getVisibleRooms?.() || client.getRooms?.() || [])
    .filter((room) => room.getMyMembership?.() === 'join')
    .sort((a, b) =>
      (b.getLastActiveTimestamp?.() || 0) - (a.getLastActiveTimestamp?.() || 0)
    )
    .slice(0, 14);

  if (!rooms.length) {
    toast(t('rss.menu.noChats'), 'error');
    return;
  }

  await menuAt(x, y, [
    {
      label: t('rss.menu.sendTo', { title: (item.title || t('note.untitled')).slice(0, 40) }),
      disabled: true,
      meta: true,
    },
    'hr',
    ...rooms.map((room) => ({
      label: room.name || t('rss.menu.chatFallback'),
      icon: 'message-circle',
      action: guarded(
        () => sendRssItemAsChatEmbedAction({
          itemId: item.id,
          roomId: room.roomId,
        }),
        t('rss.menu.sendFailed')
      ),
    })),
  ]);
}

export async function openRssItemContextMenu({
  x,
  y,
  item,
  onOpen = null,
  onChanged = null,
} = {}) {
  if (!item) return;

  const changed = async () => {
    try {
      await onChanged?.();
    } catch {}
  };

  const entries = [];

  if (onOpen) {
    entries.push({
      label: t('rss.menu.open'),
      icon: 'book-open',
      action: guarded(() => onOpen(item), t('rss.menu.openFailed')),
    });
  }

  // Items cached before feed URLs were restricted to http(s) may still
  // carry another scheme.
  const originalUrl = safeUrl(item.url);

  if (originalUrl && /^https?:/i.test(originalUrl)) {
    entries.push({
      label: t('rss.menu.openOriginal'),
      icon: 'external-link',
      action: () => window.open(originalUrl, '_blank', 'noopener'),
    });
  }

  entries.push(
    'hr',
    {
      label: t('rss.menu.saveAsNote'),
      icon: 'file-plus',
      action: guarded(async () => {
        const note = await saveRssItemAsNote(item.id);
        if (note?.id) await openNote(note.id);
      }, t('rss.menu.saveFailed')),
    },
    {
      label: t('rss.menu.appendToNote'),
      icon: 'list-plus',
      action: guarded(() => appendRssItemToCurrentNote(item.id), t('rss.menu.appendFailed')),
    },
    {
      label: t('rss.menu.sendToChat'),
      icon: 'send',
      action: () => pickChatRoomAndSendRssItem(item, x, y),
    },
    'hr',
    {
      label: item.starred ? t('rss.menu.unstar') : t('rss.menu.star'),
      icon: 'star',
      action: guarded(async () => {
        await toggleRssItemStar(item.id);
        await changed();
      }, t('rss.menu.updateFailed')),
    },
    {
      label: item.read ? t('rss.menu.markUnread') : t('rss.menu.markRead'),
      icon: item.read ? 'mail' : 'mail-open',
      action: guarded(async () => {
        await markRssItemRead(item.id, !item.read);
        await changed();
      }, t('rss.menu.updateFailed')),
    },
    {
      label: item.archived ? t('rss.menu.restore') : t('rss.menu.archive'),
      icon: item.archived ? 'archive-restore' : 'archive',
      action: guarded(async () => {
        await archiveRssItem(item.id, !item.archived);
        await changed();
      }, t('rss.menu.archiveFailed')),
    }
  );

  if (item.url) {
    entries.push('hr', {
      label: t('rss.menu.copyLink'),
      icon: 'link',
      action: guarded(async () => {
        await navigator.clipboard.writeText(item.url);
        toast(t('rss.menu.linkCopied'), 'success');
      }, t('rss.menu.copyFailed')),
    });
  }

  await menuAt(x, y, entries);
}

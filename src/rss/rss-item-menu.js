// ============================================================
// YANTA RSS — item context menu
//
// The interconnect hub for a source item: right-click (desktop) or
// long-press (Android fires contextmenu natively) offers everything
// the rest of YANTA can do with an article — notes, chat, star,
// read state, archive.
// ============================================================

import { toast } from '../core.js';
import { openNote } from '../notes.js';

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
    toast('Chat is not connected — enable Chat first', 'error');
    return;
  }

  const rooms = (client.getVisibleRooms?.() || client.getRooms?.() || [])
    .filter((room) => room.getMyMembership?.() === 'join')
    .sort((a, b) =>
      (b.getLastActiveTimestamp?.() || 0) - (a.getLastActiveTimestamp?.() || 0)
    )
    .slice(0, 14);

  if (!rooms.length) {
    toast('No chats yet — start a chat first', 'error');
    return;
  }

  await menuAt(x, y, [
    {
      label: `Send "${(item.title || 'Untitled').slice(0, 40)}" to…`,
      disabled: true,
      meta: true,
    },
    'hr',
    ...rooms.map((room) => ({
      label: room.name || 'Chat',
      icon: 'message-circle',
      action: guarded(
        () => sendRssItemAsChatEmbedAction({
          itemId: item.id,
          roomId: room.roomId,
        }),
        'Could not send to chat'
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
      label: 'Open',
      icon: 'book-open',
      action: guarded(() => onOpen(item), 'Could not open item'),
    });
  }

  if (item.url) {
    entries.push({
      label: 'Open original',
      icon: 'external-link',
      action: () => window.open(item.url, '_blank', 'noopener'),
    });
  }

  entries.push(
    'hr',
    {
      label: 'Save as note',
      icon: 'file-plus',
      action: guarded(async () => {
        const note = await saveRssItemAsNote(item.id);
        if (note?.id) await openNote(note.id);
      }, 'Could not save item'),
    },
    {
      label: 'Append to current note',
      icon: 'list-plus',
      action: guarded(() => appendRssItemToCurrentNote(item.id), 'Could not append item'),
    },
    {
      label: 'Send to chat…',
      icon: 'send',
      action: () => pickChatRoomAndSendRssItem(item, x, y),
    },
    'hr',
    {
      label: item.starred ? 'Unstar' : 'Star',
      icon: 'star',
      action: guarded(async () => {
        await toggleRssItemStar(item.id);
        await changed();
      }, 'Could not update item'),
    },
    {
      label: item.read ? 'Mark as unread' : 'Mark as read',
      icon: item.read ? 'mail' : 'mail-open',
      action: guarded(async () => {
        await markRssItemRead(item.id, !item.read);
        await changed();
      }, 'Could not update item'),
    },
    {
      label: item.archived ? 'Restore' : 'Archive',
      icon: item.archived ? 'archive-restore' : 'archive',
      action: guarded(async () => {
        await archiveRssItem(item.id, !item.archived);
        await changed();
      }, 'Could not archive item'),
    }
  );

  if (item.url) {
    entries.push('hr', {
      label: 'Copy link',
      icon: 'link',
      action: guarded(async () => {
        await navigator.clipboard.writeText(item.url);
        toast('Link copied', 'success');
      }, 'Copy failed'),
    });
  }

  await menuAt(x, y, entries);
}

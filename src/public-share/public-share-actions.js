// ============================================================
// YANTA Public Share — UI-independent actions
//
// Thin app-action facade around public-share-publisher.js.
//
// Warum:
// Chat embeds, AI tools and future integrations need a stable headless API
// for "external thing → public share link", without importing UI modules or
// guessing internal publisher function names.
// ============================================================

import {
    state,
    toast,
  } from '../core.js';
  
  import {
    createOrGetPublicShare,
    publishPublicShareNow,
    publicShareStateForNote,
    isPublicShareActive,
  } from './public-share-publisher.js';
  
  import {
    makePublicShareUrl,
  } from './public-share-crypto.js';
  
  function noteTitle(noteId) {
    return state.notes.get(noteId)?.title || 'Untitled';
  }
  
  function publicShareUrlFromState(share = {}) {
    if (!share) return '';
  
    if (share.url) return String(share.url);
    if (share.shareUrl) return String(share.shareUrl);
    if (share.publicUrl) return String(share.publicUrl);
  
    if (share.shareId && share.shareKey) {
      return makePublicShareUrl(share.shareId, share.shareKey);
    }
  
    return '';
  }
  
  function normalizeNoteId(input = {}) {
    return String(input.noteId || input.id || input.sourceId || '').trim();
  }
  
  /**
   * Creates or republishes a public read-only note share and returns its URL.
   */
  export async function createPublicShareForNoteAction({
    noteId,
    expiresAt = null,
    force = false,
    publish = true,
    source = 'unknown',
  } = {}) {
    const id = normalizeNoteId({
      noteId,
    });
  
    if (!id || !state.notes.has(id)) {
      toast('Note not found.', 'error');
      throw new Error('Note not found.');
    }
  
    try {
      let share = publicShareStateForNote(id);
  
      /*
        If a usable local private share key already exists, we can construct the
        zero-knowledge URL immediately. Still publish by default so Chat live-links
        point at the latest note state.
      */
      const existingUrl = publicShareUrlFromState(share);
  
      if (!publish && existingUrl && isPublicShareActive(share)) {
        return {
          ok: true,
          noteId: id,
          title: noteTitle(id),
          url: existingUrl,
          shareId: share.shareId || share.id || '',
          status: share.status || 'active',
          reused: true,
          source,
        };
      }
  
      if (!share?.shareId || !share?.shareKey || !isPublicShareActive(share)) {
        share = await createOrGetPublicShare(id, {
          expiresAt,
        });
      }
  
      if (publish) {
        const published = await publishPublicShareNow(id, {
          force,
          expiresAt,
        });
  
        share = published?.share || publicShareStateForNote(id);
      } else {
        share = publicShareStateForNote(id);
      }
  
      const url = publicShareUrlFromState(share);
  
      if (!url) {
        throw new Error(
          'Public share exists, but the private share key is not available on this device.'
        );
      }
  
      return {
        ok: true,
        noteId: id,
        title: noteTitle(id),
        url,
        shareId: share.shareId || share.id || '',
        status: share.status || 'active',
        reused: !!existingUrl,
        source,
      };
    } catch (err) {
      console.warn('[YANTA Public Share Actions] Could not create public share', err);
      toast(err?.message || 'Could not create public share link.', 'error');
      throw err;
    }
  }
  
  /**
   * Returns the current public share state for a note.
   */
  export function getPublicShareForNoteAction({
    noteId,
  } = {}) {
    const id = normalizeNoteId({
      noteId,
    });
  
    if (!id || !state.notes.has(id)) {
      return {
        ok: false,
        noteId: id,
        active: false,
        url: '',
      };
    }
  
    const share = publicShareStateForNote(id);
    const url = publicShareUrlFromState(share);
  
    return {
      ok: true,
      noteId: id,
      title: noteTitle(id),
      active: isPublicShareActive(share),
      url,
      shareId: share.shareId || share.id || '',
      status: share.status || '',
      cloudOnly: !!share.cloudOnly,
    };
  }
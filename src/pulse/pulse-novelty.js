// ============================================================
// YANTA Pulse — "did we already tell you this?"
//
// The run already skips a card whose text is identical to the last one
// (contentDigest). Feeds and calendars mostly produce near-repeats
// instead: the same three headlines in a new order, the same meeting
// summarised with other words. Two checks, cheapest first:
//
//   1. Text similarity (character trigrams) against the routine's recent
//      cards. Very similar → a repeat, no model asked.
//   2. In the grey zone, a decision model is asked whether the new card
//      tells the user something the earlier one did not.
//
// Fails open: on any doubt or error the card is delivered.
// ============================================================

import { diceSimilarity, trigramCounts, stripForDisplay } from 'veriquote';

import { decisionsAvailable, openRouterDecide } from '../ai/openrouter-client.js';
import { listInboxItems } from './pulse-store.js';

const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const LOOKBACK_CARDS = 8;
const SAME = 0.82;
const ASK_FROM = 0.4;
const NEW_ENOUGH = 0.25;

/** Plain, comparable text: no markdown, citations or quote appendix. */
export function comparableText(title, body) {
  return `${title}\n${stripForDisplay(String(body || ''))}`
    .replace(/\[\d+\]/g, ' ')
    .replace(/[#*_>`~|\[\]()-]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns null when the card is new, else { reason, similarity, of }
 * describing the earlier card it repeats.
 */
export async function findNearDuplicate(routineName, { title, body }, { now = Date.now(), signal = null } = {}) {
  let recent;

  try {
    recent = (await listInboxItems({ includeArchived: true }))
      .filter((item) => item.routineName === routineName && now - Number(item.createdAt || 0) < LOOKBACK_MS)
      .slice(0, LOOKBACK_CARDS);
  } catch {
    return null;
  }

  if (!recent.length) return null;

  const text = trigramCounts(comparableText(title, body));
  let best = null;

  for (const item of recent) {
    const similarity = diceSimilarity(text, trigramCounts(comparableText(item.title, item.body)));
    if (!best || similarity > best.similarity) best = { item, similarity };
  }

  if (best.similarity >= SAME) {
    return { reason: 'similar', similarity: best.similarity, of: best.item.id };
  }

  if (best.similarity < ASK_FROM || !decisionsAvailable()) return null;

  try {
    const { answers } = await openRouterDecide({
      signal,
      state: {
        earlierCard: { title: best.item.title, body: stripForDisplay(String(best.item.body || '')).slice(0, 3000) },
        newCard: { title, body: stripForDisplay(String(body || '')).slice(0, 3000) },
      },
      questions: {
        novel: {
          type: 'noul',
          instructions: 'Does the new card tell the user something important that the earlier card did not already tell them?',
        },
      },
    });

    const p = Number(answers?.novel?.noul);

    if (Number.isFinite(p) && p < NEW_ENOUGH) {
      return { reason: 'nothing-new', similarity: best.similarity, probability: p, of: best.item.id };
    }
  } catch (err) {
    console.warn('[YANTA Pulse] novelty check failed, delivering', err);
  }

  return null;
}

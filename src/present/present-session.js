// ============================================================
// YANTA Present — a joined device (screen or remote)
//
// Pairing (QR ticket, typed code, or a screen waiting to be picked) ends
// with a welcome that carries the session key, sealed for this device
// alone. From then on the device:
//
// - says hello now and every 10 s (the presenter lists it, and answers with
//   the current position — the whole resync after any network gap);
// - follows the presenter's state, newest first (an epoch per presenter
//   page, so a reloaded presenter starting at revision 1 still counts);
// - fetches the deck whenever its version changes;
// - resends a remote press until the presenter's state confirms it.
//
// UI-free: present-stage.js and present-remote.js draw what it reports.
// ============================================================

import { createRelayChannel, openSecureTopic } from './present-channel.js';
import {
  createEcdhPair,
  deriveSharedKeyString,
  importKeyString,
  keyFromCode,
  openJson,
  pairingCheck,
  randomId,
  randomKeyString,
  randomCode,
  topicFor,
} from './present-crypto.js';
import { mergeDeck } from './present-deck.js';
import { deviceName, tabDeviceId } from './present-device.js';
import { HELLO_EVERY_MS, PEER_TIMEOUT_MS, createCommandQueue } from './present-protocol.js';

const STORE_KEY = 'yanta.present.joined.v1';
const GRANT_AAD = 'yanta-present-grant';
const KNOCK_EVERY_MS = 1500;

export function readJoinedSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    return saved?.sessionKey && saved?.pairKey ? saved : null;
  } catch {
    return null;
  }
}

function saveJoined(value) {
  try {
    if (value) sessionStorage.setItem(STORE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {}
}

export function forgetJoinedSession() {
  saveJoined(null);
}

async function openGrant(pairKey, grant) {
  return openJson(await importKeyString(pairKey), grant, GRANT_AAD);
}

/**
 * Knocks on a presenter's door (QR ticket or typed code) until it answers.
 * `onWaiting(check)` fires when the presenter has to approve first.
 * Resolves with the saved session, rejects when denied or abandoned.
 */
export function knockOnPresenter({ ticketKey = '', code = '', role, onWaiting = null, signal = null }) {
  return new Promise((resolve, reject) => {
    const deviceId = tabDeviceId();
    const channel = createRelayChannel();
    let rendezvous = null;
    let timer = 0;
    let done = false;

    const finish = (err, value) => {
      if (done) return;
      done = true;

      clearInterval(timer);
      setTimeout(() => {
        rendezvous?.close();
        channel.close();
      }, 1500);

      if (err) reject(err);
      else resolve(value);
    };

    signal?.addEventListener?.('abort', () => finish(Object.assign(new Error('Cancelled'), { code: 'cancelled' })));

    (async () => {
      const pair = await createEcdhPair();
      const key = ticketKey ? await importKeyString(ticketKey) : await keyFromCode(code);
      const topic = ticketKey ? await topicFor('ticket', ticketKey) : await topicFor('code', code);
      let waitingShown = false;

      rendezvous = openSecureTopic(channel, {
        topic,
        key,
        deviceId,
        onMessage: async (kind, body) => {
          if (done) return;

          if (kind === 'waiting' && body.pub && !waitingShown) {
            waitingShown = true;
            onWaiting?.(await pairingCheck(pair.publicKey, body.pub));
            return;
          }

          if (kind === 'denied') {
            finish(Object.assign(new Error('Denied'), { code: 'denied' }));
            return;
          }

          if (kind !== 'welcome' || !body.pub || !body.grant) return;

          try {
            const pairKey = await deriveSharedKeyString(pair.privateKey, body.pub);
            const grant = await openGrant(pairKey, body.grant);
            const joined = { sessionKey: grant.sessionKey, pairKey, role: grant.role || role, title: grant.title || '', host: grant.host || '' };

            saveJoined(joined);
            finish(null, joined);
          } catch (err) {
            finish(err);
          }
        },
      });

      const knock = () => rendezvous.post('knock', { pub: pair.publicKey, name: deviceName(), role });

      knock();
      timer = setInterval(() => {
        // Waiting for approval: knocking on keeps the request alive, but
        // there is no need to hammer the relay.
        if (!waitingShown || Math.random() < 0.3) knock();
      }, KNOCK_EVERY_MS);
    })().catch((err) => finish(err));
  });
}

/**
 * A screen waiting on yanta.page/present to be picked by a presenter: it
 * shows a QR (its key) and a short code, and takes the first invitation.
 */
export function waitForPresenter({ onReady, onInvited = null }) {
  const deviceId = tabDeviceId();
  const channel = createRelayChannel();
  const screenKey = randomKeyString();
  const code = randomCode();
  const rendezvous = [];
  let pair = null;
  let done = false;
  let stopped = false;

  const result = new Promise((resolve, reject) => {
    const finish = (err, value) => {
      if (done) return;
      done = true;

      setTimeout(() => {
        rendezvous.forEach((r) => r.close());
        channel.close();
      }, 1500);

      if (err) reject(err);
      else resolve(value);
    };

    const handle = (getRendezvous) => async (kind, body, envelope) => {
      if (done || stopped) return;

      if (kind === 'invite' && body.pub) {
        onInvited?.({ name: body.name, title: body.title });
        getRendezvous().post('here', { pub: pair.publicKey, name: deviceName() }, { to: envelope.from });
        return;
      }

      if (kind !== 'welcome' || !body.pub || !body.grant) return;

      try {
        const pairKey = await deriveSharedKeyString(pair.privateKey, body.pub);
        const grant = await openGrant(pairKey, body.grant);
        const joined = { sessionKey: grant.sessionKey, pairKey, role: 'screen', title: grant.title || '', host: grant.host || '' };

        saveJoined(joined);
        finish(null, joined);
      } catch (err) {
        finish(err);
      }
    };

    (async () => {
      pair = await createEcdhPair();

      const byKey = openSecureTopic(channel, {
        topic: await topicFor('screen', screenKey),
        key: await importKeyString(screenKey),
        deviceId,
        onMessage: handle(() => byKey),
      });

      const byCode = openSecureTopic(channel, {
        topic: await topicFor('screen-code', code),
        key: await keyFromCode(code),
        deviceId,
        onMessage: handle(() => byCode),
      });

      rendezvous.push(byKey, byCode);
      onReady?.({ screenKey, code });
    })().catch((err) => finish(err));
  });

  return {
    result,
    channel,
    stop() {
      stopped = true;
      rendezvous.forEach((r) => r.close());
      channel.close();
    },
  };
}

/**
 * Runs a joined session. Callbacks:
 *   onState(state)       newest presenter state
 *   onDeck(deck)         a (new) deck arrived
 *   onLaser(point)       a laser position from any device
 *   onStatus(status)     'online' | 'reconnecting' | 'presenter-away'
 *   onEnd(reason)        'ended' | 'removed'
 */
export function runJoinedSession(joined, { onState, onDeck, onLaser, onStatus, onEnd }) {
  const deviceId = tabDeviceId();
  const channel = createRelayChannel();
  const commands = createCommandQueue();

  let sessionKey = joined.sessionKey;
  let session = null;
  let deck = null;
  let state = null;
  let lastStateAt = 0;
  let hostId = '';
  let deckAskedAt = 0;
  let ended = false;
  let firstHello = true;
  const pendingNotes = new Map(); // slideId -> text not yet confirmed

  const report = (status) => onStatus?.(status);

  async function openSession() {
    session?.close();
    session = openSecureTopic(channel, {
      topic: await topicFor('session', sessionKey),
      key: await importKeyString(sessionKey),
      deviceId,
      onMessage,
    });

    hello();
  }

  function hello() {
    if (!session || ended) return;

    session.post('hello', { name: deviceName(), role: joined.role, first: firstHello });
    firstHello = false;
  }

  function askForDeck(version) {
    if (!hostId || !version || deck?.version === version) return;
    if (Date.now() - deckAskedAt < 4000) return;

    deckAskedAt = Date.now();
    session?.post('need-deck', { have: deck?.version || '', files: Object.keys(deck?.files || {}) }, { to: hostId });
  }

  function flushCommands() {
    for (const cmd of commands.due()) {
      if (Date.now() - (cmd.sentAt || 0) < 1200) continue;

      cmd.sentAt = Date.now();
      session?.post('cmd', { id: cmd.id, op: cmd.op, index: cmd.index });
    }
  }

  async function onMessage(kind, body, envelope) {
    if (ended) return;

    if (kind === 'state') {
      // A presenter page that reloaded starts its revisions over: a new
      // epoch always wins.
      const newer = !state || body.epoch !== state.epoch || Number(body.rev) > Number(state.rev);

      hostId = envelope.from;
      lastStateAt = Date.now();
      report('online');

      if (!newer) return;

      state = { ...body, hostId: envelope.from };
      commands.acknowledge(body.acks?.[deviceId]);
      onState?.(state);
      askForDeck(body.deckVersion);
      flushCommands();
      return;
    }

    if (kind === 'deck') {
      deck = mergeDeck(deck, body);
      deckAskedAt = 0;
      onDeck?.(deck);
      return;
    }

    if (kind === 'laser') {
      onLaser?.(body);
      return;
    }

    if (kind === 'notes') {
      const notes = body.notes && typeof body.notes === 'object' ? body.notes : {};

      // An edit counts as saved once the presenter sends it back.
      for (const [slideId, text] of pendingNotes) {
        if ((notes[slideId] || '') === text) pendingNotes.delete(slideId);
      }

      if (deck) {
        deck = { ...deck, notes };
        onDeck?.(deck);
      }
      return;
    }

    if (kind === 'rekey') {
      const grant = body.grants?.[deviceId];
      if (!grant) return;

      try {
        const next = await openGrant(joined.pairKey, grant);
        sessionKey = next.sessionKey;
        saveJoined({ ...joined, sessionKey });
        await openSession();
      } catch {}
      return;
    }

    if (kind === 'removed' || kind === 'end') {
      stop();
      onEnd?.(kind === 'removed' ? 'removed' : 'ended');
    }
  }

  const helloTimer = setInterval(() => {
    hello();
    flushCommands();

    if (lastStateAt && Date.now() - lastStateAt > PEER_TIMEOUT_MS * 0.8) report('presenter-away');
  }, HELLO_EVERY_MS);

  const commandTimer = setInterval(flushCommands, 600);

  // Unconfirmed note edits go out again until the presenter has them.
  const notesTimer = setInterval(() => {
    for (const [slideId, text] of pendingNotes) session?.post('notes-edit', { slideId, text });
  }, 2500);

  const stopStatus = channel.onStatus((status) => {
    if (status === 'online') {
      hello();
      return;
    }

    report('reconnecting');
  });

  openSession().catch((err) => console.warn('[YANTA Present] could not join', err));

  function stop() {
    if (ended) return;

    ended = true;
    clearInterval(helloTimer);
    clearInterval(commandTimer);
    clearInterval(notesTimer);
    stopStatus();
    forgetJoinedSession();

    try {
      session?.post('bye', {});
    } catch {}

    setTimeout(() => {
      session?.close();
      channel.close();
    }, 200);
  }

  return {
    get deck() {
      return deck;
    },

    get state() {
      return state;
    },

    /** next | prev | goto | blank | start */
    send(op, extra = {}) {
      const cmd = { id: randomId(8), op, index: extra.index, sentAt: Date.now() };
      commands.push(cmd);
      session?.post('cmd', { id: cmd.id, op, index: cmd.index });
    },

    laser(point) {
      session?.post('laser', point);
    },

    /** Saves a presenter note into the presenter's drawing. */
    editNotes(slideId, text) {
      pendingNotes.set(slideId, String(text ?? ''));
      session?.post('notes-edit', { slideId, text: String(text ?? '') });
    },

    /** Whether an edit of this slide's notes is still on its way. */
    notesPending(slideId) {
      return pendingNotes.has(slideId);
    },

    leave() {
      stop();
    },
  };
}

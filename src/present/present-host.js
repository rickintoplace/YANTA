// ============================================================
// YANTA Present — the presenting device
//
// The device that has the drawing runs the session: it owns the slide
// position, admits devices, sends them the deck and applies what remotes
// ask for. The slideshow in slides-ui.js reports every move here and
// receives remote commands from here; the connect panel
// (present-connect-ui.js) shows what is going on.
//
// A session survives a reload of the presenting tab (sessionStorage): the
// screens and remotes keep their keys and simply carry on once the page is
// back. Removing a device rotates the session key for everyone else, so a
// removed device cannot keep listening.
// ============================================================

import { getDrawing, getNoteDoc } from '../yjs.js';
import { currentExcalidrawTheme } from '../draw-runtime.js';
import { slideBuildCount } from '../slides/slides-animation.js';
import { presentationSlidesFor } from '../slides/slides-model.js';
import { createRelayChannel, openSecureTopic } from './present-channel.js';
import {
  createEcdhPair,
  deriveSharedKeyString,
  importKeyString,
  keyFromCode,
  normalizeCode,
  pairingCheck,
  randomCode,
  randomKeyString,
  sealJson,
  topicFor,
} from './present-crypto.js';
import { buildDeck, deckVersionOf, notesOf } from './present-deck.js';
import { setSlideNotes } from '../slides/slides-store.js';
import { BOARD_SLIDE_ID } from '../slides/slides-model.js';
import { deviceName, tabDeviceId } from './present-device.js';
import { HELLO_EVERY_MS, clampPosition, createCommandLog, createPeerTable } from './present-protocol.js';

const STORE_KEY = 'yanta.present.host.v1';
const STORE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const GRANT_AAD = 'yanta-present-grant';

let current = null;

export function currentPresentHost() {
  return current;
}

/** The session for this drawing, created on first use. */
export function presentHostFor(noteId, drawingId) {
  if (current && current.noteId === noteId && current.drawingId === drawingId) return current;

  current?.end();
  current = createPresentHost({ noteId, drawingId, saved: readSaved(drawingId) });

  return current;
}

/**
 * After a reload of the presenting tab: pick the session up again, so the
 * devices that were connected find their presenter without anyone touching
 * them.
 */
export async function resumePresentHost() {
  const saved = readSaved();
  if (!saved?.drawingId || !saved.peers?.length) return null;

  await getNoteDoc(saved.noteId).ready;
  if (!getDrawing(saved.noteId, saved.drawingId)) return null;

  return presentHostFor(saved.noteId, saved.drawingId);
}

function readSaved(drawingId = null) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (!saved || Date.now() - Number(saved.at || 0) > STORE_MAX_AGE_MS) return null;
    if (drawingId && saved.drawingId !== drawingId) return null;

    return saved;
  } catch {
    return null;
  }
}

/** Where a QR code sends a phone: the standalone join page. */
export function joinUrlForTicket(ticketKey) {
  return `${location.origin}/present#join=${ticketKey}`;
}

/**
 * What a person can paste or scan to reach a waiting screen: its QR URL
 * (…/?app#present-screen=<key>), the bare key, or the six-character code.
 */
export function parseScreenInput(input) {
  const text = String(input || '').trim();
  const match = /[#&](?:present-)?screen=([A-Za-z0-9_-]{40,})/.exec(text) || /^([A-Za-z0-9_-]{43})$/.exec(text);

  if (match) return { key: match[1] };

  const code = normalizeCode(text);
  return code ? { code } : null;
}

function createPresentHost({ noteId, drawingId, saved }) {
  const deviceId = tabDeviceId();
  const channel = createRelayChannel();
  const peers = createPeerTable();
  const commands = createCommandLog();
  const listeners = new Set();
  const pending = new Map(); // deviceId -> approval request
  const pairKeys = new Map((saved?.peers || []).map((p) => [p.id, p.pairKey]));
  const welcomes = new Map(); // deviceId -> welcome body, resent on a repeated knock
  const acks = {};

  for (const p of saved?.peers || []) {
    if (p.pairKey) peers.seen(p.id, { name: p.name, role: p.role, offline: true });
  }

  let sessionKeyString = saved?.sessionKey || randomKeyString();
  let session = null;
  let ticket = null;
  let code = null;
  let ended = false;

  // Every page load of the presenter is a new epoch: devices accept its
  // revision 1 even after having seen revision 500 of the previous one.
  const epoch = randomKeyString().slice(0, 10);
  let rev = 0;
  let position = { presenting: false, index: 0, step: 0, blank: false, startedAt: 0 };
  let slides = presentationSlidesFor(getDrawing(noteId, drawingId));
  let deckVersion = deckVersionOf(getDrawing(noteId, drawingId));

  let onCommand = null;
  let onLaser = null;
  let onNotesEdited = null;
  let notesJson = JSON.stringify(notesOf(getDrawing(noteId, drawingId)));

  const emit = () => {
    listeners.forEach((fn) => {
      try {
        fn(api);
      } catch {}
    });
  };

  const save = () => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({
        at: Date.now(),
        noteId,
        drawingId,
        sessionKey: sessionKeyString,
        audienceKey: audience?.keyString || '',
        peers: peers.list()
          .filter((p) => pairKeys.has(p.id))
          .map((p) => ({ id: p.id, name: p.name, role: p.role, pairKey: pairKeys.get(p.id) })),
      }));
    } catch {}
  };

  const title = () => getDrawing(noteId, drawingId)?.title || '';

  // ---- Session topic

  async function openSession() {
    const key = await importKeyString(sessionKeyString);
    const topic = await topicFor('session', sessionKeyString);

    session?.close();
    session = openSecureTopic(channel, { topic, key, deviceId, onMessage: onSessionMessage });
  }

  let stateTimer = 0;

  /** Coalesces bursts (a command and the move it caused) into one state message. */
  function publishStateSoon() {
    if (stateTimer) return;

    stateTimer = setTimeout(() => {
      stateTimer = 0;
      publishState();
    }, 16);
  }

  function publishState() {
    if (!session || ended) return;

    const counts = slides.map(slideBuildCount);

    session.post('state', {
      epoch,
      rev: ++rev,
      host: deviceName(),
      title: title(),
      presenting: position.presenting,
      index: position.index,
      step: position.step,
      blank: position.blank,
      editing: !!position.editing,
      startedAt: position.startedAt,
      counts,
      slideIds: slides.map((s) => s.id),
      deckVersion,
      acks,
      peers: peers.list().map(({ id, name, role }) => ({ id, name, role })),
    });

    publishAudienceState(counts);
  }

  // ---- Audience: a link to watch, nothing more

  /*
    Anyone with the link sees the slides as they are presented — remote
    participants of a call, say. It is a topic and key of its own: viewers
    never learn the session key, so they cannot press "next", and they never
    get the presenter notes. Many viewers are expected, so the deck goes out
    as one broadcast (at most every few seconds per version), not per viewer.
  */
  let audience = null;
  const viewers = createPeerTable();

  async function openAudience(keyString = randomKeyString()) {
    audience?.topic.close();

    const topic = openSecureTopic(channel, {
      topic: await topicFor('watch', keyString),
      key: await importKeyString(keyString),
      deviceId,
      onMessage: (kind, body, envelope) => {
        if (kind === 'hello') {
          if (viewers.seen(envelope.from, { role: 'audience' })) emit();
          publishStateSoon();
          return;
        }

        if (kind === 'bye') {
          viewers.remove(envelope.from);
          emit();
          return;
        }

        if (kind === 'need-deck') sendAudienceDeck();
      },
    });

    audience = { keyString, topic, deckSentAt: 0, deckSentVersion: '' };
    save();
    emit();
    publishStateSoon();
  }

  function sendAudienceDeck() {
    if (!audience) return;

    const drawing = getDrawing(noteId, drawingId);
    if (!drawing) return;

    if (audience.deckSentVersion === deckVersion && Date.now() - audience.deckSentAt < 3000) return;

    audience.deckSentAt = Date.now();
    audience.deckSentVersion = deckVersion;

    const deck = buildDeck(drawing, { theme: currentExcalidrawTheme() });
    audience.topic.post('deck', { ...deck, notes: {} });
  }

  function publishAudienceState(counts) {
    if (!audience) return;

    audience.topic.post('state', {
      epoch,
      rev,
      title: title(),
      presenting: position.presenting,
      index: position.index,
      step: position.step,
      blank: position.blank,
      counts,
      slideIds: slides.map((s) => s.id),
      deckVersion,
    });
  }

  async function closeAudience() {
    if (!audience) return;

    try {
      await audience.topic.post('end', {});
    } catch {}

    const { topic } = audience;
    audience = null;
    setTimeout(() => topic.close(), 300);

    for (const viewer of viewers.list()) viewers.remove(viewer.id);

    save();
    emit();
  }

  function onSessionMessage(kind, body, envelope) {
    const from = envelope.from;

    if (kind === 'hello') {
      const isNew = peers.seen(from, { name: String(body.name || '').slice(0, 60), role: body.role === 'screen' ? 'screen' : 'remote', offline: false });
      if (isNew || body.first) emit();
      publishStateSoon();
      return;
    }

    if (!peers.get(from)) return;
    peers.seen(from, { offline: false });

    if (kind === 'bye') {
      peers.remove(from);
      emit();
      return;
    }

    if (kind === 'need-deck') {
      const drawing = getDrawing(noteId, drawingId);
      if (!drawing) return;

      session.post('deck', buildDeck(drawing, {
        haveFiles: Array.isArray(body.files) ? body.files : [],
        theme: currentExcalidrawTheme(),
      }), { to: from });
      return;
    }

    if (kind === 'cmd') {
      if (!commands.accept(body.id)) {
        publishStateSoon(); // The ack got lost — say it again.
        return;
      }

      acks[from] = body.id;

      if (body.op === 'blank') {
        position = { ...position, blank: !position.blank };
        onCommand?.({ op: 'blank', blank: position.blank });
      } else {
        onCommand?.(body);
      }

      publishStateSoon();
      return;
    }

    if (kind === 'laser') {
      onLaser?.(body);
      audience?.topic.post('laser', body); // viewers see the remote's laser too
      return;
    }

    // A remote wrote a presenter note during the talk: into the drawing it
    // goes, like a note typed on this device.
    if (kind === 'notes-edit') {
      const slideId = String(body.slideId || '');
      if (!slideId || slideId === BOARD_SLIDE_ID) return;

      setSlideNotes(noteId, drawingId, slideId, String(body.text ?? '').slice(0, 20_000));
      onNotesEdited?.(slideId);
      publishNotes();
    }
  }

  /** Sends the notes when they changed (from any device, or edited here). */
  function publishNotes({ force = false } = {}) {
    const json = JSON.stringify(notesOf(getDrawing(noteId, drawingId)));
    if (!force && json === notesJson) return;

    notesJson = json;
    session?.post('notes', { notes: JSON.parse(json) });
  }

  // ---- Admitting devices

  async function grantFor(peerId, role) {
    const pairKey = pairKeys.get(peerId);
    const key = await importKeyString(pairKey);

    return sealJson(key, {
      sessionKey: sessionKeyString,
      title: title(),
      host: deviceName(),
      role,
    }, GRANT_AAD);
  }

  async function admit(rendezvous, joiner, pair) {
    pairKeys.set(joiner.id, await deriveSharedKeyString(pair.privateKey, joiner.pub));
    peers.seen(joiner.id, { name: joiner.name, role: joiner.role, offline: false });

    const welcome = { pub: pair.publicKey, grant: await grantFor(joiner.id, joiner.role) };
    welcomes.set(joiner.id, welcome);

    await rendezvous.post('welcome', welcome, { to: joiner.id });

    save();
    emit();
    publishStateSoon();
  }

  /**
   * Listens where joiners knock. A QR ticket admits its first device right
   * away (and is replaced, so a photo of the QR is worth nothing later); a
   * typed code needs the presenter's OK.
   */
  async function openRendezvous(topic, key, { auto }) {
    const rendezvous = openSecureTopic(channel, {
      topic,
      key,
      deviceId,
      onMessage: async (kind, body, envelope) => {
        if (kind !== 'knock' || ended) return;

        const joiner = {
          id: envelope.from,
          name: String(body.name || '').slice(0, 60) || 'Device',
          role: body.role === 'screen' ? 'screen' : 'remote',
          pub: String(body.pub || ''),
        };

        if (!joiner.id || !joiner.pub) return;

        // A repeated knock (the welcome got lost): same answer again.
        if (welcomes.has(joiner.id) && pairKeys.has(joiner.id)) {
          rendezvous.post('welcome', welcomes.get(joiner.id), { to: joiner.id });
          return;
        }

        if (auto) {
          if (rendezvous.used && rendezvous.used !== joiner.id) return;
          rendezvous.used = joiner.id;

          await admit(rendezvous, joiner, await createEcdhPair());

          // A fresh QR for the next device, after the joiner had time to retry.
          setTimeout(() => {
            if (!ended && ticket?.rendezvous === rendezvous) refreshTicket();
          }, 4000);
          return;
        }

        const waiting = pending.get(joiner.id);

        if (waiting) {
          rendezvous.post('waiting', { pub: waiting.pair.publicKey }, { to: joiner.id });
          return;
        }

        const pair = await createEcdhPair();
        const check = await pairingCheck(pair.publicKey, joiner.pub);

        pending.set(joiner.id, {
          ...joiner,
          pair,
          check,
          at: Date.now(),
          accept: async () => {
            pending.delete(joiner.id);
            emit();
            await admit(rendezvous, joiner, pair);
          },
          deny: async () => {
            pending.delete(joiner.id);
            emit();
            await rendezvous.post('denied', {}, { to: joiner.id });
          },
        });

        await rendezvous.post('waiting', { pub: pair.publicKey }, { to: joiner.id });
        emit();
      },
    });

    return rendezvous;
  }

  async function refreshTicket() {
    ticket?.rendezvous.close();

    const keyString = randomKeyString();
    const rendezvous = await openRendezvous(await topicFor('ticket', keyString), await importKeyString(keyString), { auto: true });

    ticket = { keyString, url: joinUrlForTicket(keyString), rendezvous };
    emit();
  }

  async function refreshCode() {
    code?.rendezvous.close();

    const value = randomCode();
    const rendezvous = await openRendezvous(await topicFor('code', value), await keyFromCode(value), { auto: false });

    code = { value, rendezvous };
    emit();
  }

  /**
   * Sends the presentation to a screen that waits on yanta.page/present —
   * scanned from its QR or typed from its code.
   */
  async function connectScreen(input) {
    const parsed = parseScreenInput(input);
    if (!parsed) throw Object.assign(new Error('Not a screen code'), { code: 'invalid' });

    const key = parsed.key ? await importKeyString(parsed.key) : await keyFromCode(parsed.code);
    const topic = parsed.key ? await topicFor('screen', parsed.key) : await topicFor('screen-code', parsed.code);
    const pair = await createEcdhPair();

    return new Promise((resolve, reject) => {
      let done = false;
      let timer = 0;
      let timeout = 0;

      const finish = (err, value) => {
        if (done) return;
        done = true;

        clearInterval(timer);
        clearTimeout(timeout);
        setTimeout(() => rendezvous.close(), 4000);

        if (err) reject(err);
        else resolve(value);
      };

      const rendezvous = openSecureTopic(channel, {
        topic,
        key,
        deviceId,
        onMessage: async (kind, body, envelope) => {
          if (kind !== 'here' || done || !body.pub) return;

          const screen = {
            id: envelope.from,
            name: String(body.name || '').slice(0, 60) || 'Screen',
            role: 'screen',
            pub: String(body.pub),
          };

          try {
            await admit(rendezvous, screen, pair);
            finish(null, screen);
          } catch (err) {
            finish(err);
          }
        },
      });

      const invite = () => rendezvous.post('invite', { pub: pair.publicKey, name: deviceName(), title: title() });

      invite();
      timer = setInterval(invite, 1500);
      timeout = setTimeout(() => finish(Object.assign(new Error('No screen answered'), { code: 'timeout' })), 20_000);
    });
  }

  /** Takes a device out; everyone else moves to a new session key it never sees. */
  async function removePeer(id) {
    const removedKey = pairKeys.get(id);

    peers.remove(id);
    pairKeys.delete(id);
    welcomes.delete(id);

    const nextKey = randomKeyString();
    const grants = {};

    for (const peer of peers.list()) {
      const pairKey = pairKeys.get(peer.id);
      if (!pairKey) continue;

      grants[peer.id] = await sealJson(await importKeyString(pairKey), { sessionKey: nextKey }, GRANT_AAD);
    }

    if (removedKey) await session?.post('removed', {}, { to: id });
    await session?.post('rekey', { grants });

    sessionKeyString = nextKey;
    await openSession();

    save();
    emit();
    publishState();
  }

  // ---- The drawing changes while presenting: devices fetch the new deck.

  const drawings = getNoteDoc(noteId).doc.getMap('drawings');
  let deckTimer = 0;

  const onDrawingChange = (event) => {
    if (!event.keysChanged.has(drawingId)) return;

    clearTimeout(deckTimer);
    deckTimer = setTimeout(() => {
      publishNotes();

      const drawing = getDrawing(noteId, drawingId);
      const version = deckVersionOf(drawing);
      if (version === deckVersion) return;

      deckVersion = version;
      if (!position.presenting) slides = presentationSlidesFor(drawing);

      publishState();
    }, 900);
  };

  drawings.observe(onDrawingChange);

  // ---- Presence

  const heartbeat = setInterval(() => {
    if (ended) return;

    const gone = peers.prune();
    const viewersGone = viewers.prune();

    // A device that went quiet stays listed (dimmed) while its key is valid:
    // it will be back when its screen wakes up.
    for (const peer of gone) {
      if (pairKeys.has(peer.id)) peers.seen(peer.id, { ...peer, offline: true });
    }

    for (const [id, request] of pending) {
      if (Date.now() - request.at > 120_000) pending.delete(id);
    }

    publishState();
    if (gone.length || viewersGone.length) emit();
  }, HELLO_EVERY_MS);

  const stopStatus = channel.onStatus(() => {
    emit();
    if (channel.status === 'online') publishStateSoon();
  });

  openSession().then(publishState).catch((err) => console.warn('[YANTA Present] session failed', err));

  if (saved?.audienceKey) openAudience(saved.audienceKey).catch(() => {});

  const api = {
    noteId,
    drawingId,
    deviceId,

    get status() {
      return channel.status;
    },

    get ticketUrl() {
      return ticket?.url || '';
    },

    get code() {
      return code?.value || '';
    },

    get peers() {
      return peers.list();
    },

    get audienceUrl() {
      return audience ? `${location.origin}/present#watch=${audience.keyString}` : '';
    },

    get viewerCount() {
      return viewers.list().length;
    },

    openAudience: () => openAudience(),
    closeAudience,

    get pending() {
      return [...pending.values()].map(({ id, name, role, check }) => ({ id, name, role, check }));
    },

    get position() {
      return { ...position };
    },

    get ended() {
      return ended;
    },

    /** Starts listening for joiners (QR ticket + typed code). */
    async openPairing() {
      if (!ticket) await refreshTicket();
      if (!code) await refreshCode();
    },

    closePairing() {
      ticket?.rendezvous.close();
      code?.rendezvous.close();
      ticket = null;
      code = null;
      emit();
    },

    approve(id) {
      return pending.get(id)?.accept();
    },

    deny(id) {
      return pending.get(id)?.deny();
    },

    connectScreen,
    removePeer,

    /** The slideshow reports where it is (or that it stopped). */
    setPosition(next = {}) {
      if (Array.isArray(next.slides)) slides = next.slides;

      const counts = slides.map(slideBuildCount);
      const presenting = next.presenting ?? position.presenting;
      const { index, step } = clampPosition(counts, { index: next.index ?? position.index, step: next.step ?? position.step });

      position = {
        presenting,
        index,
        step,
        blank: presenting ? (next.blank ?? position.blank) : false,
        editing: presenting ? (next.editing ?? position.editing ?? false) : false,
        startedAt: presenting ? (position.startedAt || Date.now()) : 0,
      };

      publishStateSoon();
    },

    setHandlers({ command = null, laser = null, notesEdited = null } = {}) {
      onCommand = command;
      onLaser = laser;
      onNotesEdited = notesEdited;
    },

    /** Notes changed on this device (presenter view, notes panel). */
    notesChanged() {
      publishNotes();
    },

    /** Generates a new typed code; the old one stops working. */
    rotateCode() {
      return refreshCode();
    },

    /** The presenter's own laser, mirrored on every screen. */
    laser(body) {
      session?.post('laser', body);
      audience?.topic.post('laser', body);
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Ends the session for every device. */
    async end() {
      if (ended) return;

      ended = true;

      try {
        await session?.post('end', {});
      } catch {}

      clearInterval(heartbeat);
      clearTimeout(deckTimer);
      clearTimeout(stateTimer);
      stopStatus();

      try {
        drawings.unobserve(onDrawingChange);
      } catch {}

      ticket?.rendezvous.close();
      code?.rendezvous.close();
      await closeAudience();
      session?.close();

      setTimeout(() => channel.close(), 300);

      try {
        sessionStorage.removeItem(STORE_KEY);
      } catch {}

      if (current === api) current = null;
      emit();
    },
  };

  save();

  return api;
}

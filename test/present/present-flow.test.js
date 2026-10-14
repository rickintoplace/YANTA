import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installFakeRelay } from './fake-relay.js';

const relay = installFakeRelay();

const { channelTimings } = await import('../../src/present/present-channel.js');
const { presentHostFor } = await import('../../src/present/present-host.js');
const { knockOnPresenter, waitForPresenter, runJoinedSession } = await import('../../src/present/present-session.js');
const { nextPosition, previousPosition } = await import('../../src/present/present-protocol.js');
const { setDrawing, getDrawing } = await import('../../src/yjs.js');

channelTimings.pingEveryMs = 150;
channelTimings.silenceLimitMs = 600;
channelTimings.maxBackoffMs = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, { timeout = 8000, step = 20 } = {}) {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(step);
  }

  throw new Error('condition not met in time');
}

/** Each simulated device is a separate browser tab with its own id. */
function asNewDevice() {
  sessionStorage.removeItem('yanta.present.device');
}

function el(id, x, y) {
  return {
    id, type: 'rectangle', x, y, width: 100, height: 60, angle: 0,
    strokeColor: '#000', backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: 1, version: 1,
    versionNonce: 1, isDeleted: false, boundElements: null, updated: 1,
    link: null, locked: false,
  };
}

const noteId = 'note-present';
const drawingId = 'drawing-present';
// Large enough to need several relay messages (the relay caps one at 512 KB).
const bigImage = `data:image/png;base64,${'A'.repeat(700_000)}`;

function joinSession(joined) {
  const seen = { states: [], decks: [], lasers: [], ends: [], statuses: [] };

  const session = runJoinedSession(joined, {
    onState: (s) => seen.states.push(s),
    onDeck: (d) => seen.decks.push(d),
    onLaser: (p) => seen.lasers.push(p),
    onStatus: (s) => seen.statuses.push(s),
    onEnd: (r) => seen.ends.push(r),
  });

  return { session, seen, last: () => seen.states.at(-1) };
}

describe('presenting to connected devices', () => {
  let host;
  let pos = { index: 0, step: 0 };
  const applied = [];
  let counts;

  beforeAll(async () => {
    setDrawing(noteId, drawingId, {
      title: 'Talk',
      elements: [el('a', 0, 0), el('b', 300, 0), el('c', 0, 400)],
      files: { img1: { id: 'img1', mimeType: 'image/png', dataURL: bigImage, created: 1 } },
      slides: [
        { id: 's1', title: 'One', bounds: { x: -20, y: -20, width: 480, height: 270 }, animation: { builds: [{ id: 'b1', elementIds: ['b'], effect: 'fade', trigger: 'click' }] }, notes: { markdown: 'Say hello' } },
        { id: 's2', title: 'Two', bounds: { x: -20, y: 380, width: 480, height: 270 } },
      ],
    }, 'test');

    counts = [1, 0];

    asNewDevice();
    host = presentHostFor(noteId, drawingId);

    host.setHandlers({
      command: (cmd) => {
        applied.push(cmd.id);
        if (cmd.op === 'next') pos = nextPosition(counts, pos) || pos;
        if (cmd.op === 'prev') pos = previousPosition(counts, pos) || pos;
        host.setPosition({ presenting: true, ...pos });
      },
    });

    host.setPosition({ presenting: true, index: 0, step: 0 });
    await host.openPairing();
    await until(() => host.ticketUrl && host.code);
  });

  afterAll(async () => {
    await host?.end();
  });

  let remote;
  let remoteJoined;

  it('a phone that scans the QR becomes a remote without a question', async () => {
    const ticketKey = host.ticketUrl.split('#join=')[1];
    const firstUrl = host.ticketUrl;

    asNewDevice();
    remoteJoined = await knockOnPresenter({ ticketKey, role: 'remote' });
    expect(remoteJoined.role).toBe('remote');
    expect(remoteJoined.title).toBe('Talk');

    // Same tab, same device id: the session continues what the knock began.
    remote = joinSession(remoteJoined);

    await until(() => remote.last()?.presenting && remote.seen.decks.length);

    const deck = remote.seen.decks.at(-1);
    expect(deck.slides.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(deck.notes.s1).toBe('Say hello');
    expect(deck.files.img1.dataURL.length).toBe(bigImage.length);
    expect(host.peers.map((p) => p.role)).toContain('remote');

    // The QR is single-use: a fresh one replaces it.
    await until(() => host.ticketUrl && host.ticketUrl !== firstUrl, { timeout: 8000 });
  });

  it('remote presses move the presentation, each exactly once', async () => {
    remote.session.send('next');
    await until(() => remote.last()?.step === 1);

    remote.session.send('next');
    await until(() => remote.last()?.index === 1);

    remote.session.send('prev');
    await until(() => remote.last()?.index === 0 && remote.last()?.step === 1);

    expect(applied.length).toBe(3);
    expect(new Set(applied).size).toBe(3);
  });

  let laptop;

  it('a typed code needs the presenter to approve, with matching check digits', async () => {
    let shownCheck = '';

    asNewDevice();
    const joining = knockOnPresenter({ code: host.code, role: 'screen', onWaiting: (check) => { shownCheck = check; } });

    await until(() => host.pending.length === 1 && shownCheck);
    expect(host.pending[0].check).toBe(shownCheck);
    expect(host.pending[0].role).toBe('screen');

    await host.approve(host.pending[0].id);

    const joined = await joining;
    expect(joined.role).toBe('screen');

    laptop = joinSession(joined);
    await until(() => laptop.last()?.index === 0 && laptop.seen.decks.length);
  });

  it('a denied device learns it was denied', async () => {
    asNewDevice();
    const joining = knockOnPresenter({ code: host.code, role: 'remote' });

    await until(() => host.pending.length === 1);
    await host.deny(host.pending[0].id);

    await expect(joining).rejects.toMatchObject({ code: 'denied' });
  });

  let tv;

  it('the presenter sends the slides to a screen waiting on yanta.page/present', async () => {
    asNewDevice();
    let ready = null;
    const waiting = waitForPresenter({ onReady: (r) => { ready = r; } });

    await until(() => ready);
    const screen = await host.connectScreen(ready.code.toLowerCase());
    expect(screen.role).toBe('screen');

    const joined = await waiting.result;
    expect(joined.role).toBe('screen');

    tv = joinSession(joined);
    await until(() => tv.last()?.presenting && tv.seen.decks.length);
  });

  it('a press made while the network is down still lands — once', async () => {
    const before = applied.length;
    const step = remote.last().step;

    relay.dropAll();
    remote.session.send('prev');

    await until(() => remote.last()?.step === step - 1 && remote.last()?.index === 0, { timeout: 10000 });
    await sleep(800);

    expect(applied.length).toBe(before + 1);
    await until(() => tv.last()?.step === step - 1);
  });

  it('a connection that dies silently is noticed and replaced', async () => {
    relay.deafenAll();

    await sleep(1200);
    remote.session.send('next');

    await until(() => remote.last()?.step === 1, { timeout: 10000 });
    await until(() => tv.last()?.step === 1 && laptop.last()?.step === 1, { timeout: 10000 });
  });

  it('an edit during the talk reaches every device without resending the pictures', async () => {
    const decksBefore = tv.seen.decks.length;
    const drawing = getDrawing(noteId, drawingId);

    setDrawing(noteId, drawingId, {
      ...drawing,
      elements: [...drawing.elements, el('d', 600, 600)],
    }, 'test-edit');

    await until(() => tv.seen.decks.length > decksBefore, { timeout: 10000 });

    const deck = tv.seen.decks.at(-1);
    expect(deck.elements.map((e) => e.id)).toContain('d');
    expect(deck.files.img1.dataURL.length).toBe(bigImage.length); // kept, not resent
  });

  it('a note written on the remote lands in the drawing and on every device', async () => {
    const decksBefore = tv.seen.decks.length;
    const versionBefore = tv.last().deckVersion;

    remote.session.editNotes('s2', 'Mention the Q3 dip');

    await until(() => getDrawing(noteId, drawingId).slides.find((s) => s.id === 's2')?.notes?.markdown === 'Mention the Q3 dip');
    await until(() => tv.seen.decks.at(-1)?.notes?.s2 === 'Mention the Q3 dip');
    await until(() => !remote.session.notesPending('s2'));

    // Notes travel alone: the board was not resent for them.
    expect(tv.seen.decks.at(-1).elements.length).toBe(tv.seen.decks[decksBefore - 1].elements.length);

    // …and the board version stays: screens do not swap their scene (that
    // swap is what made a screen flicker while the presenter typed notes).
    await sleep(1500);
    expect(tv.last().deckVersion).toBe(versionBefore);
    expect(tv.seen.decks.at(-1).version).toBe(versionBefore);
  });

  it('a removed device is cut off; the others carry on with a new key', async () => {
    const laptopId = host.peers.find((p) => p.role === 'screen' && p.name)?.id;
    const remoteId = host.peers.find((p) => p.role === 'remote')?.id;
    expect(remoteId).toBeTruthy();
    expect(laptopId).toBeTruthy();

    await host.removePeer(remoteId);
    await until(() => remote.seen.ends.includes('removed'));

    const tvRev = tv.last().rev;
    host.setPosition({ presenting: true, index: 1, step: 0 });

    await until(() => tv.last()?.index === 1 && tv.last().rev > tvRev, { timeout: 10000 });
    expect(host.peers.some((p) => p.id === remoteId)).toBe(false);
  });

  let viewer;

  it('a watch link shows the slides — no notes, no control', async () => {
    await host.openAudience();
    const key = host.audienceUrl.split('#watch=')[1];
    expect(key).toBeTruthy();

    asNewDevice();
    viewer = joinSession({ sessionKey: key, role: 'audience', title: '', host: '' });

    await until(() => viewer.last() && viewer.seen.decks.length);
    expect(viewer.seen.decks.at(-1).notes).toEqual({});
    expect(viewer.seen.decks.at(-1).elements.length).toBeGreaterThan(0);
    await until(() => host.viewerCount === 1);

    const before = applied.length;
    viewer.session.send('next');
    await sleep(1500);
    expect(applied.length).toBe(before);
  });

  it('ending the session tells every device', async () => {
    await host.end();
    await until(() => tv.seen.ends.includes('ended') && laptop.seen.ends.includes('ended') && viewer.seen.ends.includes('ended'));
    host = null;
  });
});

// ============================================================
// YANTA Chat — Voice message recorder
//
// Implements S1 state machine.
// ============================================================

import {
  el,
  lucide,
  toast,
} from '../core.js';

import {
  sendVoiceMessage,
} from './chat-media.js';

import { androidChatMediaStatus } from '../native/android-bridge.js';

const MIME_CANDIDATES = [
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/mp4',
];

const ARM_MS = 150;
const MIN_DURATION_MS = 600;
const MAX_DURATION_MS = 300_000;
const LOCK_DY = -64;
const CANCEL_DX = -88;
const AXIS_THRESHOLD = 12;

function supportedMimeType() {
  try {
    if (typeof MediaRecorder === 'undefined') return '';
    const found = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m));
    if (found) return found;
    /*
      Fallback: leerer mimeType lässt MediaRecorder seinen Plattform-Default
      wählen (Android WebView: meist audio/webm;codecs=opus).
    */
    return '';
  } catch {
    return '';
  }
}

function assertMicrophoneMayBeRequested() {
  const native = androidChatMediaStatus();
  /*
    Warum bridge-missing NICHT mehr blockt:
    Eine App-Version ohne getChatMediaStatus()-Bridge kann trotzdem
    getUserMedia im WebView unterstützen. Wir versuchen die Aufnahme und
    mappen echte Permission-Fehler über friendlyMicError().
    Nur ein explizites micGranted === false blockt vorab.
  */
  if (native.isAndroidApp && native.supported && native.micGranted === false) {
    throw new Error('Microphone permission is missing. Allow the microphone for YANTA in Android settings.');
  }
  if (!window.isSecureContext) {
    throw new Error('Voice recording requires HTTPS.');
  }
  const policy =
    document.permissionsPolicy ||
    document.featurePolicy ||
    null;
  try {
    if (
      policy?.allowsFeature &&
      policy.allowsFeature('microphone') === false
    ) {
      throw new Error('Microphone is blocked by this page permissions policy.');
    }
  } catch (err) {
    if (/permissions policy/i.test(err?.message || '')) {
      throw err;
    }
    console.warn('[YANTA Chat] Could not inspect microphone permissions policy', err);
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error('Voice recording is not supported in this browser.');
  }
}

/**
 * Maps getUserMedia/MediaRecorder failures to actionable user messages.
 */
function friendlyMicError(err) {
  const name = err?.name || '';
  const inAndroidApp = androidChatMediaStatus().isAndroidApp;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return inAndroidApp
      ? 'Microphone permission is missing. Allow the microphone for YANTA in Android settings.'
      : 'Microphone permission was denied.';
  }
  if (name === 'NotFoundError') return 'No microphone was found on this device.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return err?.message || 'Could not start voice recording.';
}

function fmtTimer(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rest = s % 60;

  return `${m}:${String(rest).padStart(2, '0')}`;
}

function downsampleWaveform(samples, bins = 100) {
  if (!samples.length) return [];

  const out = [];
  const step = samples.length / bins;

  for (let i = 0; i < bins; i++) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    const slice = samples.slice(start, end);
    const avg = slice.reduce((sum, n) => sum + n, 0) / slice.length;

    out.push(Math.max(0, Math.min(1024, Math.round(avg * 1024))));
  }

  return out;
}

function createRecordingUi(form) {
  const ui = el('div', {
    class: 'yanta-chat-recording-ui',
    hidden: true,
  });

  ui.innerHTML = `
    <div class="yanta-chat-rec-live" data-rec-live>
      <span class="yanta-chat-rec-dot"></span>
      <span data-rec-timer>0:00</span>
    </div>

    <div class="yanta-chat-rec-hint" data-rec-hint>
      ${lucide('chevron-left', 16)}
      <span>Slide to cancel</span>
    </div>

    <div class="yanta-chat-rec-lock" data-rec-lock>
      ${lucide('lock-open', 16)}
    </div>
  `;

  form.append(ui);

  return ui;
}

function createLockedUi(form) {
  const ui = el('div', {
    class: 'yanta-chat-locked-ui',
    hidden: true,
  });

  ui.innerHTML = `
    <button type="button" class="icon-btn danger" data-voice-trash title="Discard" aria-label="Discard">
      ${lucide('trash-2', 18)}
    </button>

    <div class="yanta-chat-rec-live">
      <span class="yanta-chat-rec-dot"></span>
      <span data-locked-timer>0:00</span>
    </div>

    <button type="button" class="yanta-chat-send yanta-chat-voice-send" data-voice-send title="Send voice message" aria-label="Send voice message">
      ${lucide('send-horizontal', 18)}
    </button>
  `;

  form.append(ui);

  return ui;
}

/**
 * Attach voice recording behavior to the composer mic/send button.
 */
export function setupVoiceRecorder({
  form,
  micButton,
  textArea,
  getClient,
  getRoomId,
  onSent = null,
} = {}) {
  if (!form || !micButton || !textArea) return null;

  const recordingUi = createRecordingUi(form);
  const lockedUi = createLockedUi(form);

  const recTimer = recordingUi.querySelector('[data-rec-timer]');
  const lockedTimer = lockedUi.querySelector('[data-locked-timer]');
  const hint = recordingUi.querySelector('[data-rec-hint]');
  const lockPill = recordingUi.querySelector('[data-rec-lock]');

  let state = 'IDLE';
  let pointerId = null;
  let pointerIsDown = false;
  let autoLockOnStart = false;
  let startSeq = 0;
  let startInFlight = false;

  let startX = 0;
  let startY = 0;
  let axis = '';
  let armTimer = 0;
  let hardLimitTimer = 0;
  let tickTimer = 0;
  let startedAt = 0;

  let stream = null;
  let recorder = null;
  let chunks = [];
  let mimeType = '';
  let audioContext = null;
  let analyser = null;
  let waveformSamples = [];
  let waveformTimer = 0;

  function setState(next) {
    state = next;
    form.dataset.voiceState = next.toLowerCase();

    form.classList.toggle('is-voice-recording', next === 'RECORDING');
    form.classList.toggle('is-voice-locked', next === 'LOCKED');

    recordingUi.hidden = next !== 'RECORDING';
    lockedUi.hidden = next !== 'LOCKED';
  }

  function durationMs() {
    return startedAt ? Date.now() - startedAt : 0;
  }

  function updateTimers() {
    const label = fmtTimer(durationMs());

    if (recTimer) recTimer.textContent = label;
    if (lockedTimer) lockedTimer.textContent = label;
  }

  function updateGestureUi(dx, dy) {
    const cancelRatio = Math.max(
      0,
      Math.min(1, Math.abs(Math.min(0, dx)) / Math.abs(CANCEL_DX))
    );

    if (hint) {
      hint.style.opacity = String(1 - cancelRatio);
    }

    micButton.style.transform =
      `translateX(${Math.max(CANCEL_DX, Math.min(0, dx))}px) scale(1.6)`;

    if (lockPill) {
      const locking = dy <= LOCK_DY;

      lockPill.classList.toggle('is-locking', locking);
      lockPill.innerHTML = lucide(locking ? 'lock' : 'lock-open', 16);
    }
  }

  async function startAudio() {
    assertMicrophoneMayBeRequested();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    mimeType = supportedMimeType();
    const recorderOptions = {
      audioBitsPerSecond: 24_000,
    };
    if (mimeType) {
      recorderOptions.mimeType = mimeType;
    }
    recorder = new MediaRecorder(stream, recorderOptions);
    if (!mimeType) {
      mimeType = recorder.mimeType || '';
    }

    chunks = [];

    recorder.addEventListener('dataavailable', (e) => {
      if (e.data?.size) {
        chunks.push(e.data);
      }
    });

    setupAnalyser(stream);

    await new Promise((resolve) => {
      recorder.addEventListener('start', resolve, {
        once: true,
      });

      recorder.start(250);
    });

    startedAt = Date.now();

    tickTimer = window.setInterval(updateTimers, 200);
    hardLimitTimer = window.setTimeout(() => {
      finishAndSend().catch((err) => {
        console.warn('[YANTA Chat] Could not auto-send hard-limited voice message', err);
        toast('Could not send voice message.', 'error');
      });
    }, MAX_DURATION_MS);

    updateTimers();
  }

  function setupAnalyser(mediaStream) {
    try {
      audioContext = new AudioContext();
      const src = audioContext.createMediaStreamSource(mediaStream);

      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;

      src.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);

      waveformSamples = [];

      waveformTimer = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);

        let sum = 0;

        for (const v of data) {
          const centered = (v - 128) / 128;
          sum += centered * centered;
        }

        waveformSamples.push(Math.sqrt(sum / data.length));
      }, 60);
    } catch (err) {
      console.warn('[YANTA Chat] Could not initialize audio analyser', err);
      toast('Could not create voice waveform.', 'error');
      waveformSamples = [];
    }
  }

  function cleanup() {
    window.clearTimeout(armTimer);
    window.clearTimeout(hardLimitTimer);
    window.clearInterval(tickTimer);
    window.clearInterval(waveformTimer);

    armTimer = 0;
    hardLimitTimer = 0;
    tickTimer = 0;
    waveformTimer = 0;
    startInFlight = false;
    autoLockOnStart = false;

    try {
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch {}

    try {
      for (const track of stream?.getTracks?.() || []) {
        track.stop();
      }
    } catch (err) {
      console.warn('[YANTA Chat] Could not stop voice media tracks', err);
    }

    try {
      audioContext?.close?.();
    } catch (err) {
      console.warn('[YANTA Chat] Could not close AudioContext', err);
    }

    stream = null;
    recorder = null;
    audioContext = null;
    analyser = null;
    pointerId = null;
    pointerIsDown = false;
    axis = '';
    startedAt = 0;

    micButton.style.transform = '';
    if (hint) hint.style.opacity = '';
  }

  function recorderStoppedBlob() {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(chunks, {
          type: mimeType || chunks[0]?.type || 'audio/webm',
        }));
        return;
      }

      recorder.addEventListener('stop', () => {
        resolve(new Blob(chunks, {
          type: mimeType || chunks[0]?.type || 'audio/webm',
        }));
      }, {
        once: true,
      });

      recorder.stop();
    });
  }

  async function cancelRecording({ toastShort = false } = {}) {
    setState('CANCELLED');

    if (toastShort) {
      toast('Hold to record', 'error');
    }

    cleanup();
    chunks = [];
    waveformSamples = [];
    setState('IDLE');
  }

  async function finishAndSend() {
    if (state !== 'RECORDING' && state !== 'LOCKED') return;

    const currentDuration = durationMs();

    if (currentDuration < MIN_DURATION_MS) {
      await cancelRecording({
        toastShort: true,
      });
      return;
    }

    setState('SENDING');

    const client = getClient?.();
    const roomId = getRoomId?.();

    if (!client || !roomId) {
      cleanup();
      setState('IDLE');
      toast('Chat is not connected.', 'error');
      throw new Error('Matrix client or room missing.');
    }

    try {
      const blob = await recorderStoppedBlob();
      const waveform = downsampleWaveform(waveformSamples, 100);
      const finalMimeType = blob.type || mimeType || 'audio/webm';

      cleanup();

      await sendVoiceMessage(client, roomId, {
        blob,
        durationMs: currentDuration,
        waveform,
        mimeType: finalMimeType,
      });

      onSent?.();
    } catch (err) {
      cleanup();
      console.warn('[YANTA Chat] Could not send voice message', err);
      toast('Could not send voice message.', 'error');
      throw err;
    } finally {
      setState('IDLE');
    }
  }

  async function beginRecording(seq) {
    startInFlight = true;

    try {
      await startAudio();

      if (seq !== startSeq) {
        cleanup();
        setState('IDLE');
        return;
      }

      startInFlight = false;

      /*
        Warum:
        Browser permission prompts can interrupt pointer tracking. If the user
        releases while the permission sheet is open, we must not create an
        unfinishable RECORDING state. WhatsApp-like behavior: lock it.
      */
      if (autoLockOnStart || !pointerIsDown) {
        navigator.vibrate?.(10);
        setState('LOCKED');
        micButton.style.transform = '';
      } else {
        setState('RECORDING');
      }
    } catch (err) {
      cleanup();
      setState('IDLE');
      console.warn('[YANTA Chat] Could not start voice recording', err);
      toast(friendlyMicError(err), 'error');
    }
  }

  function onPointerMove(e) {
    if (pointerId !== e.pointerId) return;
    if (state !== 'RECORDING') return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!axis) {
      if (Math.abs(dy) > Math.abs(dx) + AXIS_THRESHOLD) {
        axis = 'y';
      } else if (Math.abs(dx) > Math.abs(dy) + AXIS_THRESHOLD) {
        axis = 'x';
      }
    }

    e.preventDefault();

    if (axis === 'y' && dy <= LOCK_DY) {
      navigator.vibrate?.(10);
      setState('LOCKED');
      micButton.style.transform = '';
      return;
    }

    if (axis === 'x' && dx <= CANCEL_DX) {
      cancelRecording().catch((err) => {
        console.warn('[YANTA Chat] Could not cancel voice recording', err);
        toast('Could not cancel recording.', 'error');
      });
      return;
    }

    updateGestureUi(dx, dy);
  }

  function onPointerUp(e) {
    if (pointerId !== e.pointerId) return;

    pointerIsDown = false;

    if (state === 'ARMED') {
      if (startInFlight) {
        autoLockOnStart = true;
        return;
      }

      cleanup();
      setState('IDLE');
      return;
    }

    if (state === 'RECORDING') {
      finishAndSend().catch((err) => {
        console.warn('[YANTA Chat] Could not finish voice recording', err);
        toast('Could not send voice message.', 'error');
      });
    }
  }

  function onPointerCancel(e) {
    if (pointerId != null && e.pointerId !== pointerId) return;

    pointerIsDown = false;

    if (state === 'ARMED' && startInFlight) {
      autoLockOnStart = true;
      return;
    }

    if (state === 'RECORDING' || state === 'LOCKED') {
      cancelRecording().catch((err) => {
        console.warn('[YANTA Chat] Could not cancel voice recording', err);
        toast('Could not cancel recording.', 'error');
      });
      return;
    }

    cleanup();
    setState('IDLE');
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden' && state === 'RECORDING') {
      setState('LOCKED');
    }
  }

  micButton.addEventListener('pointerdown', (e) => {
    if (textArea.value.trim()) return;
    if (e.button != null && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    startSeq += 1;
    pointerId = e.pointerId;
    pointerIsDown = true;
    autoLockOnStart = false;
    startInFlight = false;
    startX = e.clientX;
    startY = e.clientY;
    axis = '';

    micButton.setPointerCapture?.(e.pointerId);
    setState('ARMED');

    const seq = startSeq;

    armTimer = window.setTimeout(() => {
      beginRecording(seq);
    }, ARM_MS);
  });

  micButton.addEventListener('pointermove', onPointerMove, {
    passive: false,
  });

  micButton.addEventListener('pointerup', onPointerUp);
  micButton.addEventListener('pointercancel', onPointerCancel);

  lockedUi.querySelector('[data-voice-send]')?.addEventListener('click', () => {
    finishAndSend().catch((err) => {
      console.warn('[YANTA Chat] Could not send locked voice message', err);
      toast('Could not send voice message.', 'error');
    });
  });

  lockedUi.querySelector('[data-voice-trash]')?.addEventListener('click', () => {
    cancelRecording().catch((err) => {
      console.warn('[YANTA Chat] Could not discard voice message', err);
      toast('Could not discard voice message.', 'error');
    });
  });

  document.addEventListener('visibilitychange', onVisibilityChange);

  setState('IDLE');

  return {
    /**
     * Stops recorder resources.
     */
    destroy() {
      startSeq += 1;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cleanup();
    },
  };
}
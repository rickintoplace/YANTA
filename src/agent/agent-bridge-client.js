// ============================================================
// YANTA External Agent — Browser Bridge Client
//
// YANTA browser app connects OUTBOUND to local bridge:
//   ws://127.0.0.1:18791
//
// This is safe for https://yanta.page because the app never exposes a public
// listener. External access only works when:
// - user enables it in YANTA
// - local bridge has matching token
// - YANTA page is open
// ============================================================

import {
  state,
} from '../core.js';

import {
  noteMarkdown,
  listDrawingsForNote,
} from '../yjs.js';

import {
  wikilinkIndex,
} from '../features-state.js';

import {
  TOOL_REGISTRY,
  executeToolCall,
} from '../ai/tool-registry.js';

import {
  getExternalAgentSettings,
  saveExternalAgentSettings,
  externalAgentPermissions,
} from './agent-settings.js';

let ws = null;
let reconnectTimer = 0;
let reconnectDelay = 800;
let manuallyClosed = false;
let connected = false;
let lastError = '';

const RESOURCES = [
  {
    uri: 'yanta://file-tree',
    name: 'YANTA file tree metadata',
    description: 'Folders and notes metadata, note statistics, linked notes and linked events.',
    mimeType: 'application/json',
  },
  {
    uri: 'yanta://current-note',
    name: 'YANTA current note',
    description: 'Currently open note metadata and markdown body, if read permission is enabled.',
    mimeType: 'application/json',
  },
  {
    uri: 'yanta://agent-readme',
    name: 'YANTA external agent setup instructions',
    description: 'Short setup text that the human can show to an AI agent.',
    mimeType: 'text/markdown',
  },
];

function dispatchStatus() {
  window.dispatchEvent(new CustomEvent('yanta-external-agent-status', {
    detail: getAgentBridgeStatus(),
  }));
}

function isLoopbackUrl(raw) {
  try {
    const url = new URL(raw);

    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return false;

    const host = url.hostname.toLowerCase();

    return (
      host === '127.0.0.1' ||
      host === 'localhost' ||
      host === '[::1]' ||
      host === '::1'
    );
  } catch {
    return false;
  }
}

function convertToolForBridge(tool) {
  return {
    name: `yanta.${tool.name}`,
    description: tool.description,
    inputSchema: tool.parameters || {
      type: 'object',
      properties: {},
    },
    permission: tool.permission || null,
    risk: tool.risk || 'read',
  };
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  ws.send(JSON.stringify(obj));
  return true;
}

function wordCount(md) {
  const text = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`~\[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text ? text.split(/\s+/).length : 0;
}

function imageCount(md) {
  const ids = new Set();

  let m;

  const yantaRe = /yanta-img:\/\/([a-z0-9]+)/gi;
  while ((m = yantaRe.exec(md)) !== null) {
    ids.add(`yanta:${m[1]}`);
  }

  const imgRe = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)(?:\{[^}\n]*\})?/g;
  while ((m = imgRe.exec(md)) !== null) {
    ids.add(`url:${m[1]}`);
  }

  return ids.size;
}

function linkedNotes(md) {
  const out = [];
  const seen = new Set();
  const re = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

  let m;

  while ((m = re.exec(md)) !== null) {
    const target = String(m[1] || '').trim();
    const alias = String(m[2] || '').trim();
    const key = target.toLowerCase();

    if (!target || seen.has(key)) continue;
    seen.add(key);

    out.push({
      target,
      alias: alias || null,
      noteId: wikilinkIndex.get(key) || null,
    });
  }

  return out;
}

function folderPath(folderId) {
  if (!folderId) return '';

  const parts = [];
  const seen = new Set();
  let f = state.folders.get(folderId);

  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    parts.unshift(f.name || 'Folder');
    f = f.parentId ? state.folders.get(f.parentId) : null;
  }

  return parts.join(' / ');
}

async function linkedEventForNote(noteId) {
  try {
    const calendar = await import('../calendar.js');
    const ev = calendar.calendarEventForNoteId?.(noteId);

    if (!ev) return null;

    return {
      id: ev.id,
      title: ev.title,
      start: ev.start,
      end: ev.end || null,
      allDay: !!ev.allDay,
      location: ev.location || '',
    };
  } catch {
    return null;
  }
}

async function noteMeta(note) {
  let md = '';

  try {
    md = noteMarkdown(note.id);
  } catch {}

  let drawings = [];

  try {
    drawings = listDrawingsForNote(note.id);
  } catch {}

  return {
    id: note.id,
    title: note.title || 'Untitled',
    type: note.type || 'markdown',
    folderId: note.folderId || null,
    folderPath: folderPath(note.folderId),
    tags: note.tags || [],
    pinned: !!note.pinned,
    icon: note.icon || null,
    color: note.color || null,
    created: note.created || null,
    updated: note.updated || null,

    stats: {
      words: wordCount(md),
      chars: md.length,
      drawings: drawings.length,
      images: imageCount(md),
    },

    linkedEvent: await linkedEventForNote(note.id),
    linkedNotes: linkedNotes(md),
  };
}

async function fileTreeResource() {
  const folders = [...state.folders.values()]
    .sort((a, b) => folderPath(a.id).localeCompare(folderPath(b.id)))
    .map((f) => ({
      id: f.id,
      name: f.name || 'Folder',
      parentId: f.parentId || null,
      path: folderPath(f.id) || f.name || 'Folder',
      icon: f.icon || null,
      color: f.color || null,
      created: f.created || null,
      updated: f.updated || null,
    }));

  const notes = [];

  for (const note of [...state.notes.values()].sort((a, b) =>
    folderPath(a.folderId).localeCompare(folderPath(b.folderId)) ||
    String(a.title || '').localeCompare(String(b.title || ''))
  )) {
    notes.push(await noteMeta(note));
  }

  return {
    now: new Date().toISOString(),
    folders,
    notes,
  };
}

async function currentNoteResource() {
  const settings = getExternalAgentSettings();

  if (!settings.permissions.allowReadNotes) {
    return {
      error: 'Reading notes is disabled by YANTA external agent settings.',
    };
  }

  const note = state.currentNoteId
    ? state.notes.get(state.currentNoteId)
    : null;

  if (!note) {
    return {
      currentNote: null,
    };
  }

  return {
    currentNote: await noteMeta(note),
    markdown: noteMarkdown(note.id),
  };
}

export function buildAgentReadmeText() {
  const settings = getExternalAgentSettings();

  return [
    '# YANTA External Agent Access',
    '',
    'Human instruction:',
    'Show this text to your AI agent. It contains a temporary local session token for this YANTA browser tab.',
    '',
    'Agent instruction:',
    'You can control YANTA through the YANTA MCP bridge. Start the bridge locally, then use the MCP tools named `yanta.*`.',
    '',
    'Bridge command:',
    '',
    '```bash',
    `npx yanta-agent-bridge@latest --port 18791 --token "${settings.token}"`,
    '```',
    '',
    'If the package is installed from source instead of npm:',
    '',
    '```bash',
    `node yanta-agent-bridge/server.mjs --port 18791 --token "${settings.token}"`,
    '```',
    '',
    'Then tell the human to open YANTA and enable External Agent Access.',
    '',
    'Connection details:',
    '',
    `- WebSocket URL: ${settings.bridgeUrl}`,
    `- Token: ${settings.token}`,
    '',
    'Security rules:',
    '- Only localhost is used.',
    '- YANTA must be open in the browser.',
    '- YANTA enforces its own permissions.',
    '- If a tool is blocked, ask the human to enable the matching permission in YANTA.',
    '',
    'Available resource hints:',
    '- `yanta://file-tree` contains all note/folder metadata and stats.',
    '- `yanta://current-note` contains the currently open note if reading is allowed.',
  ].join('\n');
}

async function readResource(uri) {
  if (uri === 'yanta://file-tree') {
    return {
      mimeType: 'application/json',
      text: JSON.stringify(await fileTreeResource(), null, 2),
    };
  }

  if (uri === 'yanta://current-note') {
    return {
      mimeType: 'application/json',
      text: JSON.stringify(await currentNoteResource(), null, 2),
    };
  }

  if (uri === 'yanta://agent-readme') {
    return {
      mimeType: 'text/markdown',
      text: buildAgentReadmeText(),
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
}

async function handleToolCall(msg) {
  const id = msg.id;
  const rawName = String(msg.name || '');
  const name = rawName.startsWith('yanta.')
    ? rawName.slice('yanta.'.length)
    : rawName;

  try {
    const fakeCall = {
      function: {
        name,
        arguments: JSON.stringify(msg.args || {}),
      },
    };

    const result = await executeToolCall(fakeCall, {
      permissions: externalAgentPermissions(),
      source: 'external-agent',
    });

    send({
      type: 'tool/result',
      id,
      ok: true,
      result: result.result,
    });
  } catch (err) {
    send({
      type: 'tool/result',
      id,
      ok: false,
      error: {
        message: err?.message || String(err),
        code: err?.code || null,
        permission: err?.permission || null,
      },
    });
  }
}

async function handleResourceRead(msg) {
  const id = msg.id;

  try {
    const resource = await readResource(msg.uri);

    send({
      type: 'resource/result',
      id,
      ok: true,
      resource,
    });
  } catch (err) {
    send({
      type: 'resource/result',
      id,
      ok: false,
      error: {
        message: err?.message || String(err),
      },
    });
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);

  const settings = getExternalAgentSettings();

  if (!settings.enabled || !settings.autoConnect || manuallyClosed) return;

  reconnectTimer = window.setTimeout(() => {
    connectAgentBridge().catch(() => {});
  }, reconnectDelay);

  reconnectDelay = Math.min(15000, Math.round(reconnectDelay * 1.6));
}

export async function connectAgentBridge() {
  const settings = getExternalAgentSettings();

  manuallyClosed = false;

  if (!settings.enabled) {
    throw new Error('External agent access is disabled in YANTA settings.');
  }

  if (!isLoopbackUrl(settings.bridgeUrl)) {
    throw new Error('For safety, YANTA only connects to localhost / 127.0.0.1 bridge URLs.');
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  disconnectAgentBridge({ manual: false });

  lastError = '';
  connected = false;
  dispatchStatus();

  ws = new WebSocket(settings.bridgeUrl);

  ws.addEventListener('open', () => {
    reconnectDelay = 800;
    connected = true;
    lastError = '';

    send({
      type: 'hello',
      app: 'YANTA',
      version: 1,
      token: settings.token,
      tools: TOOL_REGISTRY.map(convertToolForBridge),
      resources: RESOURCES,
      permissions: settings.permissions,
    });

    dispatchStatus();
  });

  ws.addEventListener('message', (event) => {
    let msg;

    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === 'tool/call') {
      handleToolCall(msg);
      return;
    }

    if (msg.type === 'resource/read') {
      handleResourceRead(msg);
      return;
    }

    if (msg.type === 'ping') {
      send({ type: 'pong' });
    }
  });

  ws.addEventListener('close', () => {
    connected = false;
    dispatchStatus();
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    connected = false;
    lastError = 'Could not connect to local YANTA Agent Bridge.';
    dispatchStatus();
  });
}

export function disconnectAgentBridge({ manual = true } = {}) {
  if (manual) manuallyClosed = true;

  clearTimeout(reconnectTimer);

  if (ws) {
    try {
      ws.close();
    } catch {}
  }

  ws = null;
  connected = false;
  dispatchStatus();
}

export function getAgentBridgeStatus() {
  return {
    enabled: getExternalAgentSettings().enabled,
    connected,
    lastError,
    bridgeUrl: getExternalAgentSettings().bridgeUrl,
  };
}

export function setupAgentBridge() {
  const settings = getExternalAgentSettings();

  window.addEventListener('yanta-external-agent-settings-changed', (e) => {
    const next = e.detail;

    if (next.enabled && next.autoConnect) {
      connectAgentBridge().catch((err) => {
        lastError = err?.message || String(err);
        dispatchStatus();
      });
    } else {
      disconnectAgentBridge({ manual: false });
    }
  });

  window.addEventListener('online', () => {
    const s = getExternalAgentSettings();

    if (s.enabled && s.autoConnect) {
      connectAgentBridge().catch(() => {});
    }
  });

  window.addEventListener('focus', () => {
    const s = getExternalAgentSettings();

    if (s.enabled && s.autoConnect && !connected) {
      connectAgentBridge().catch(() => {});
    }
  });

  if (settings.enabled && settings.autoConnect) {
    setTimeout(() => {
      connectAgentBridge().catch((err) => {
        lastError = err?.message || String(err);
        dispatchStatus();
      });
    }, 800);
  }

  window.yantaExternalAgent = {
    connect: connectAgentBridge,
    disconnect: disconnectAgentBridge,
    status: getAgentBridgeStatus,
    settings: getExternalAgentSettings,
    saveSettings: saveExternalAgentSettings,
    readme: buildAgentReadmeText,
  };
}
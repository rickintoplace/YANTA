#!/usr/bin/env node

// ============================================================
// YANTA Agent Bridge
//
// MCP stdio server for OpenClaw/other agents.
// Local WebSocket server for YANTA browser app.
//
// OpenClaw/Agent <-> MCP stdio <-> this process <-> WS localhost <-> YANTA
// ============================================================

import { WebSocketServer } from 'ws';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

function parseArgs(argv) {
  const out = {
    port: Number(process.env.YANTA_AGENT_BRIDGE_PORT || 18791),
    token: process.env.YANTA_AGENT_TOKEN || '',
    host: process.env.YANTA_AGENT_BRIDGE_HOST || '127.0.0.1',
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--port') out.port = Number(argv[++i] || out.port);
    else if (a === '--host') out.host = String(argv[++i] || out.host);
    else if (a === '--token') out.token = String(argv[++i] || '');
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.error(`
YANTA Agent Bridge

Usage:
  yanta-agent-bridge --port 18791 --token <token>

Environment:
  YANTA_AGENT_TOKEN
  YANTA_AGENT_BRIDGE_PORT
  YANTA_AGENT_BRIDGE_HOST

Security:
  Bind to 127.0.0.1 only unless you know exactly what you are doing.
`);
      process.exit(0);
    }
  }

  if (!out.token) {
    console.error('[YANTA Bridge] Missing --token or YANTA_AGENT_TOKEN.');
    console.error('[YANTA Bridge] Copy the token from YANTA → AI Assistant → External Agents.');
    process.exit(2);
  }

  if (!Number.isFinite(out.port) || out.port < 1 || out.port > 65535) {
    console.error('[YANTA Bridge] Invalid --port');
    process.exit(2);
  }

  return out;
}

const config = parseArgs(process.argv.slice(2));

let yantaSocket = null;
let yantaTools = [];
let yantaResources = [];
let yantaPermissions = {};
let callSeq = 0;
const pending = new Map();

function log(...args) {
  if (config.verbose) {
    console.error('[YANTA Bridge]', ...args);
  }
}

function connected() {
  return !!yantaSocket && yantaSocket.readyState === yantaSocket.OPEN;
}

function sendToYanta(obj) {
  if (!connected()) {
    throw new Error('YANTA is not connected. Open YANTA and enable External Agent Access.');
  }

  yantaSocket.send(JSON.stringify(obj));
}

function requestYanta(obj, timeoutMs = 120000) {
  if (!connected()) {
    return Promise.reject(
      new Error('YANTA is not connected. Open YANTA and enable External Agent Access.')
    );
  }

  const id = `bridge_${++callSeq}_${Date.now()}`;

  const payload = {
    ...obj,
    id,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`YANTA request timed out: ${obj.type}`));
    }, timeoutMs);

    pending.set(id, {
      resolve,
      reject,
      timer,
    });

    try {
      sendToYanta(payload);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err);
    }
  });
}

function makeToolList() {
  const statusTool = {
    name: 'yanta.status',
    description: 'Check whether the YANTA browser app is connected to this local bridge.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  const setupTool = {
    name: 'yanta.setup_instructions',
    description: 'Return short human-readable instructions for connecting YANTA to this bridge.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  return [
    statusTool,
    setupTool,
    ...yantaTools.map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {
        type: 'object',
        properties: {},
      },
    })),
  ];
}

function makeResourceList() {
  const defaults = [
    {
      uri: 'yanta://bridge-status',
      name: 'YANTA bridge status',
      description: 'Current local bridge and YANTA connection status.',
      mimeType: 'application/json',
    },
  ];

  return [
    ...defaults,
    ...yantaResources,
  ];
}

function contentText(text) {
  return {
    content: [
      {
        type: 'text',
        text: String(text ?? ''),
      },
    ],
  };
}

function contentJson(obj) {
  return contentText(JSON.stringify(obj, null, 2));
}

// ------------------------------------------------------------
// WebSocket server for YANTA browser app
// ------------------------------------------------------------

const wss = new WebSocketServer({
  host: config.host,
  port: config.port,
});

wss.on('connection', (socket, req) => {
  log('WS connection from', req.socket.remoteAddress);

  let authed = false;

  socket.on('message', (raw) => {
    let msg;

    try {
      msg = JSON.parse(String(raw));
    } catch {
      socket.close(1008, 'invalid json');
      return;
    }

    if (!authed) {
      if (msg.type !== 'hello') {
        socket.close(1008, 'hello required');
        return;
      }

      if (msg.token !== config.token) {
        socket.close(1008, 'bad token');
        return;
      }

      authed = true;

      if (yantaSocket && yantaSocket !== socket) {
        try {
          yantaSocket.close(1000, 'replaced');
        } catch {}
      }

      yantaSocket = socket;
      yantaTools = Array.isArray(msg.tools) ? msg.tools : [];
      yantaResources = Array.isArray(msg.resources) ? msg.resources : [];
      yantaPermissions = msg.permissions || {};

      log('YANTA connected', {
        tools: yantaTools.length,
        resources: yantaResources.length,
      });

      socket.send(JSON.stringify({
        type: 'hello/ok',
        bridge: 'yanta-agent-bridge',
        version: 1,
      }));

      return;
    }

    if (msg.type === 'tool/result' || msg.type === 'resource/result') {
      const p = pending.get(msg.id);

      if (!p) return;

      clearTimeout(p.timer);
      pending.delete(msg.id);

      if (msg.ok) {
        p.resolve(msg);
      } else {
        p.reject(new Error(msg.error?.message || 'YANTA request failed'));
      }

      return;
    }

    if (msg.type === 'pong') {
      return;
    }
  });

  socket.on('close', () => {
    if (yantaSocket === socket) {
      yantaSocket = null;
      yantaTools = [];
      yantaResources = [];
      yantaPermissions = {};
      log('YANTA disconnected');
    }
  });

  socket.on('error', () => {});
});

console.error(`[YANTA Bridge] WebSocket listening on ws://${config.host}:${config.port}`);
console.error('[YANTA Bridge] Waiting for YANTA browser app to connect...');

// ------------------------------------------------------------
// MCP server for OpenClaw / agents
// ------------------------------------------------------------

const server = new Server(
  {
    name: 'yanta-agent-bridge',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: makeToolList(),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};

  if (name === 'yanta.status') {
    return contentJson({
      connected: connected(),
      tools: yantaTools.length,
      resources: yantaResources.length,
      permissions: yantaPermissions,
      bridge: {
        host: config.host,
        port: config.port,
      },
    });
  }

  if (name === 'yanta.setup_instructions') {
    return contentText([
      'Ask the human to open YANTA in the browser, open AI Assistant settings, enable External Agent Access, and ensure the bridge URL is:',
      '',
      `ws://${config.host}:${config.port}`,
      '',
      'The bridge must be started with the exact token shown in YANTA.',
      '',
      'After YANTA connects, use yanta.status again.',
    ].join('\n'));
  }

  if (!name.startsWith('yanta.')) {
    return contentJson({
      error: `Unknown tool: ${name}`,
    });
  }

  const result = await requestYanta({
    type: 'tool/call',
    name,
    args,
  });

  return contentJson(result.result);
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: makeResourceList(),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  if (uri === 'yanta://bridge-status') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            connected: connected(),
            tools: yantaTools.length,
            resources: yantaResources.length,
            bridge: {
              host: config.host,
              port: config.port,
            },
          }, null, 2),
        },
      ],
    };
  }

  const result = await requestYanta({
    type: 'resource/read',
    uri,
  });

  return {
    contents: [
      {
        uri,
        mimeType: result.resource?.mimeType || 'text/plain',
        text: result.resource?.text || '',
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
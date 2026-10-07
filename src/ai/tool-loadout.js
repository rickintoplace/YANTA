// ============================================================
// YANTA AI — Tool loadout (progressive disclosure)
//
// The registry has grown past forty tools. Sending every schema on
// every turn costs thousands of tokens before the model has read the
// question, and a large flat toolset measurably makes tool *choice*
// worse, not coverage better — the model picks wrongly between options
// it did not need to see.
//
// So a run starts with a small always-on core plus a one-line index of
// what else exists, and pulls the rest in with `tools_load` when a task
// actually calls for it. The loadout object below is the mutable state
// for one conversation or one Pulse run: which extra tools have been
// pulled in so far, and what specs that implies for the next round.
//
// Both agent surfaces share this. The chat surface (assistant-ui.js)
// keeps its own streaming loop and the headless loop (agent-loop.js)
// serves unattended callers, but neither should have its own idea of
// what the model can currently see.
// ============================================================

import {
  getTool,
  allToolNames,
  openAiToolsForModel,
  isToolOffered,
} from './tool-registry.js';

export const TOOLS_LOAD_TOOL_NAME = 'tools_load';

/**
 * Loaded on every turn. These are the tools a request is likely to need
 * within its first round, where paying an extra round-trip to discover
 * them would cost more than their schemas do.
 *
 * Keep this list short. Every addition is paid on every single turn,
 * including every Pulse heartbeat.
 */
const CORE_TOOLS = Object.freeze([
  'search_notes',
  'semantic_search_notes',
  'read_note',
  'read_notes',
  'create_note',
  'append_to_note',
  'skills_list',
  'skill_view',
]);

/**
 * Everything else, grouped so the index reads as a menu rather than a
 * wall of names. `when` is the only thing the model has to go on before
 * loading, so it describes the situation, not the implementation.
 */
const TOOL_GROUPS = Object.freeze([
  {
    id: 'notes',
    label: 'Note editing',
    when: 'editing text inside an existing note, styling or deleting a note, or replacing the user\'s current selection',
    tools: [
      'replace_in_note',
      'update_note_appearance',
      'replace_current_selection',
      'delete_note',
    ],
  },
  {
    id: 'drawing',
    label: 'Drawings and slideshows',
    when: 'creating or editing an Excalidraw drawing, diagram or slideshow',
    tools: [
      'create_drawing_note',
      'update_drawing',
      'read_excalidraw_drawing_json',
      'create_excalidraw_slideshow',
      'update_excalidraw_slideshow',
      'validate_excalidraw_slideshow_json',
    ],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    when: 'anything about appointments, events, dates or scheduling',
    tools: [
      'search_events',
      'create_event',
      'update_event',
      'update_event_appearance',
      'link_event_to_note',
    ],
  },
  {
    id: 'web',
    label: 'Web and weather',
    when: 'the answer needs current information from outside the vault',
    tools: [
      'web_search',
      'web_read',
      'get_weather',
    ],
  },
  {
    id: 'rss',
    label: 'Feeds',
    when: 'reading, searching or subscribing to RSS sources',
    tools: [
      'rss_search_items',
      'rss_read_item',
      'rss_save_item_as_note',
      'rss_mark_item_read',
      'add_rss_source',
    ],
  },
  {
    id: 'chat',
    label: 'Chat',
    when: 'reading or sending messages, or looking up a contact',
    tools: [
      'chat_find_contact',
      'chat_list_rooms',
      'chat_read_recent_messages',
      'chat_search_messages',
      'chat_send_message',
    ],
  },
  {
    id: 'brain',
    label: 'AI Brain and skill authoring',
    when: 'recording a durable fact about the user, or writing/revising a reusable skill',
    tools: [
      'ai_brain_list',
      'ai_brain_read',
      'ai_brain_search',
      'ai_brain_write',
      'skill_manage',
    ],
  },
  {
    id: 'pulse',
    label: 'Pulse routines',
    when: 'creating, listing or changing a recurring background routine',
    tools: [
      'pulse_manage',
    ],
  },
]);

/**
 * Tools the registry has but no group claims.
 *
 * A tool that falls through must stay reachable, or adding one to the
 * registry would silently make it invisible to the model — a bug that
 * would present as "the model refuses to do X" long after the change.
 */
function ungroupedTools() {
  const claimed = new Set([
    ...CORE_TOOLS,
    ...TOOL_GROUPS.flatMap((group) => group.tools),
  ]);

  return allToolNames().filter((name) => !claimed.has(name));
}

function effectiveGroups() {
  const extra = ungroupedTools();

  if (!extra.length) return TOOL_GROUPS;

  return [
    ...TOOL_GROUPS,
    {
      id: 'other',
      label: 'Other',
      when: 'none of the groups above fit',
      tools: extra,
    },
  ];
}

const TOOLS_LOAD_DEFINITION = Object.freeze({
  type: 'function',
  function: {
    name: TOOLS_LOAD_TOOL_NAME,
    description: [
      'Load the full definitions of tools that are listed in the tool index but not yet available to you.',
      'Load a whole group by its id, or individual tools by name — usually the group is what you want.',
      'The tools become callable on your next step, so load them first and then use them in the same reply chain.',
      'Load only what the current task needs. Loading everything defeats the point and makes your tool choice worse.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: { type: 'string' },
          description: 'Group ids from the tool index, e.g. ["calendar"].',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Individual tool names, when a whole group would be too much.',
        },
      },
    },
  },
});

/**
 * One conversation's or one run's view of the toolset.
 *
 * `permissions` is applied to everything this returns, so a tool the
 * user has switched off is neither offered, nor indexed, nor loadable.
 * The index would otherwise advertise capabilities that fail on use.
 *
 * With `enabled: false` the loadout degrades to the old behaviour —
 * every permitted tool, no index, no `tools_load`. Worth keeping for
 * models that handle a big toolset well, and as an escape hatch if
 * progressive loading ever misbehaves against a specific provider.
 */
export function createToolLoadout({
  permissions = null,
  enabled = true,
  preload = [],
} = {}) {
  const loaded = new Set(preload.filter((name) => !!getTool(name)));

  const permits = (name) => {
    const tool = getTool(name);
    return !!tool && isToolOffered(tool, permissions);
  };

  const groups = effectiveGroups()
    .map((group) => ({
      ...group,
      tools: group.tools.filter(permits),
    }))
    .filter((group) => group.tools.length);

  const resolve = (args = {}) => {
    const wantedGroups = Array.isArray(args.groups) ? args.groups : [];
    const wantedNames = Array.isArray(args.names) ? args.names : [];

    const fromGroups = wantedGroups.flatMap((id) => {
      const group = groups.find((entry) => entry.id === String(id).trim());
      return group ? group.tools : [];
    });

    const unknownGroups = wantedGroups.filter((id) =>
      !groups.some((group) => group.id === String(id).trim())
    );

    return {
      requested: [...new Set([...fromGroups, ...wantedNames.map((n) => String(n).trim())])],
      unknownGroups,
    };
  };

  return {
    enabled,

    /** Tool specs for the next provider request. */
    specs() {
      if (!enabled) {
        return openAiToolsForModel({ permissions });
      }

      const names = [...new Set([...CORE_TOOLS, ...loaded])].filter(permits);
      const specByName = new Map(
        openAiToolsForModel({ permissions, names }).map((spec) => [spec.function?.name, spec])
      );

      /*
        Core first, then loaded tools in the order they were loaded. In
        registry order a load inserted tools mid-list, which changed the
        request prefix and threw away the provider's prompt cache.
      */
      return [
        ...names.map((name) => specByName.get(name)).filter(Boolean),
        TOOLS_LOAD_DEFINITION,
      ];
    },

    /**
     * The index that goes into the system message. Empty when disabled,
     * or when nothing is left to disclose after permission filtering.
     */
    indexMarkdown() {
      if (!enabled || !groups.length) return '';

      const lines = groups
        .filter((group) => !group.tools.every((name) => loaded.has(name)))
        .map((group) =>
          `- **${group.id}** — ${group.label}. Use when ${group.when}.\n  ${group.tools.join(', ')}`
        );

      if (!lines.length) return '';

      return [
        '# Tool index',
        '',
        'Your core tools are already loaded and callable right now.',
        'The groups below exist but their definitions are not loaded yet.',
        `Call ${TOOLS_LOAD_TOOL_NAME} with the group ids you need, then call the tools themselves.`,
        'Do not tell the user a capability is missing without checking this index first.',
        '',
        ...lines,
      ].join('\n');
    },

    isLoadTool(name) {
      return enabled && name === TOOLS_LOAD_TOOL_NAME;
    },

    /** Executes a `tools_load` call. Returns the tool result payload. */
    load(args = {}) {
      const { requested, unknownGroups } = resolve(args);

      if (!requested.length && !unknownGroups.length) {
        return {
          error: 'Specify at least one group id or tool name.',
          groups: groups.map((group) => group.id),
        };
      }

      const added = [];
      const already = [];
      const blocked = [];
      const unknown = [...unknownGroups.map((id) => `group:${id}`)];

      for (const name of requested) {
        if (!getTool(name)) {
          unknown.push(name);
          continue;
        }

        if (!permits(name)) {
          blocked.push(name);
          continue;
        }

        if (loaded.has(name) || CORE_TOOLS.includes(name)) {
          already.push(name);
          continue;
        }

        loaded.add(name);
        added.push(name);
      }

      return {
        ok: added.length > 0 || already.length > 0,
        loaded: added,
        already_available: already,
        // Named explicitly rather than omitted: the model should be able
        // to tell the user "that is switched off in settings" instead of
        // silently working around a missing capability.
        blocked_by_settings: blocked,
        unknown,
        note: added.length
          ? 'These tools are callable from your next step onward.'
          : undefined,
      };
    },

    /** Diagnostics for the run log — what the model actually needed. */
    loadedNames() {
      return [...loaded];
    },
  };
}

export const TOOL_LOADOUT_INTERNALS = Object.freeze({
  CORE_TOOLS,
  TOOL_GROUPS,
  ungroupedTools,
});

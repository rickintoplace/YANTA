// ============================================================
// YANTA — Settings: appearance (themes, colors, fonts), persistence.
// Settings live in two scopes:
//   - device-only: localStorage (not synced, not exported)
//   - synced:     IndexedDB settings store (included in sync + exports)
// Users can toggle "this device only" per settings group.
// ============================================================

import { $, el, state, store, toast, lucide, safeCssColor, cssColorToHex } from './core.js';
import {
  getDashboardCardDisplayPrefs,
  setDashboardCardDisplayPrefs,
} from './dashboard.js';

import {
  getCalendarPreferences,
  saveCalendarPreferences,
  resetCalendarPreferences,
  CALENDAR_DATE_FORMATS,
  CALENDAR_EDITOR_DATE_STYLES,
  CALENDAR_LOCALES,
  CALENDAR_TIME_FORMATS,
  CALENDAR_WEEK_STARTS,
} from './calendar-preferences.js';

import {
  FLOATING_CREATE_ACTION_CATALOG,
  FLOATING_CREATE_MIN_DISTANCE,
  FLOATING_CREATE_BOUNDS,
  getFloatingCreateSettings,
  saveFloatingCreateSettings,
  resetFloatingCreateSettings,
  constrainFloatingCreateLayout,
  suggestFloatingCreatePosition,
} from './floating-create-settings.js';

// ----------------------------------------------------------------
// Theme tokens — these map 1:1 to CSS custom properties.
// Each has a default for dark + light mode.
// ----------------------------------------------------------------

export const COLOR_TOKENS = [
  // Backgrounds
  { key: 'bg',           label: 'Background',           group: 'Backgrounds' },
  { key: 'bg-elev',      label: 'Surface',              group: 'Backgrounds' },
  { key: 'bg-elev-2',    label: 'Surface (hover)',      group: 'Backgrounds' },
  { key: 'bg-elev-3',    label: 'Surface (raised)',     group: 'Backgrounds' },

  // Borders
  { key: 'border',        label: 'Border',              group: 'Borders' },
  { key: 'border-strong', label: 'Border (strong)',     group: 'Borders' },

  // Text
  { key: 'text',       label: 'Text',          group: 'Text' },
  { key: 'text-dim',   label: 'Text (dim)',    group: 'Text' },
  { key: 'text-faint', label: 'Text (faint)',  group: 'Text' },

  // Accents
  { key: 'accent',   label: 'Accent (primary)',   group: 'Accents' },
  { key: 'accent-2', label: 'Accent (secondary)', group: 'Accents' },

  // Semantic
  { key: 'green',  label: 'Success', group: 'Semantic' },
  { key: 'yellow', label: 'Warning', group: 'Semantic' },
  { key: 'red',    label: 'Danger',  group: 'Semantic' },

  // Selection
  { key: 'selection',      label: 'Text selection background', group: 'Selection' },
  { key: 'selection-text', label: 'Selected text',             group: 'Selection' },
];

// Neutral, AI-slop-free defaults.
// Dark: warm-neutral grays (no blue tint), accent retained.
// Light: clean off-white with subtle warmth.
export const DEFAULT_THEMES = {
  dark: {
    'bg':            '#141414',
    'bg-elev':       '#1c1c1c',
    'bg-elev-2':     '#242424',
    'bg-elev-3':     '#2e2e2e',
    'border':        '#333333',
    'border-strong': '#454545',
    'text':          '#e8e6e3',
    'text-dim':      '#9a9794',
    'text-faint':    '#6b6864',
    'accent':        '#6ea8fe',
    'accent-2':      '#a78bfa',
    'green':         '#4ade80',
    'yellow':        '#fbbf24',
    'red':           '#f87171',
    'selection':     'rgba(148, 163, 184, 0.30)',
    'selection-text':'#f8fafc',
  },
  light: {
    'bg':            '#fdfcfa',
    'bg-elev':       '#f5f4f1',
    'bg-elev-2':     '#ecebe7',
    'bg-elev-3':     '#e2e0dc',
    'border':        '#d6d4ce',
    'border-strong': '#b5b2ab',
    'text':          '#1f1e1c',
    'text-dim':      '#5a5854',
    'text-faint':    '#8a8884',
    'accent':        '#2563eb',
    'accent-2':      '#7c3aed',
    'green':         '#16a34a',
    'yellow':        '#d97706',
    'red':           '#dc2626',
    'selection':     'rgba(31, 30, 28, 0.14)',
    'selection-text':'#111827',
  },
};

export const COLOR_PRESETS = {
  light: [
    {
      id: 'marshmallow-meadow',
      name: 'Marshmallow Meadow',
      description: 'Soft pastel meadow tones with warm honey accents.',
      colors: {
        'bg': '#fff8ef',
        'bg-elev': '#f7efd8',
        'bg-elev-2': '#efe3c7',
        'bg-elev-3': '#e5d6b6',
        'border': '#d8c7a5',
        'border-strong': '#bda982',
        'text': '#29251d',
        'text-dim': '#625a49',
        'text-faint': '#95886f',
        'accent': '#8FA31E',
        'accent-2': '#FF9D23',
        'green': '#306D29',
        'yellow': '#D98A19',
        'red': '#EA5252',
        'selection': 'rgba(143, 163, 30, 0.22)',
        'selection-text': '#1f2a18',
      },
    },
    {
      id: 'paper-boat-wash',
      name: 'Paper Boat Wash',
      description: 'Gentle paper neutrals with watercolor-blue edges.',
      colors: {
        'bg': '#F9F8F6',
        'bg-elev': '#EFE9E3',
        'bg-elev-2': '#E4DAD2',
        'bg-elev-3': '#D9CFC7',
        'border': '#C9B59C',
        'border-strong': '#A99178',
        'text': '#2E2924',
        'text-dim': '#665D54',
        'text-faint': '#94887B',
        'accent': '#3B7597',
        'accent-2': '#D86B65',
        'green': '#4F7D46',
        'yellow': '#C58B32',
        'red': '#B8504C',
        'selection': 'rgba(59, 117, 151, 0.20)',
        'selection-text': '#172331',
      },
    },
    {
      id: 'moss-mug-clay',
      name: 'Moss Mug & Clay',
      description: 'Earthy greens, fired clay and notebook warmth.',
      colors: {
        'bg': '#F4EBDD',
        'bg-elev': '#E8DDC8',
        'bg-elev-2': '#DCCDAE',
        'bg-elev-3': '#CFB990',
        'border': '#BFA57C',
        'border-strong': '#9C815F',
        'text': '#2D261C',
        'text-dim': '#655847',
        'text-faint': '#95836A',
        'accent': '#5B7E3C',
        'accent-2': '#B96B3C',
        'green': '#306D29',
        'yellow': '#B8862B',
        'red': '#A94D42',
        'selection': 'rgba(91, 126, 60, 0.22)',
        'selection-text': '#1f2718',
      },
    },
    {
      id: 'fernlight-butterglass',
      name: 'Fernlight Butterglass',
      description: 'Fresh green-gold light with a botanical note.',
      colors: {
        'bg': '#FBF5DD',
        'bg-elev': '#EFE8C9',
        'bg-elev-2': '#E7E1B1',
        'bg-elev-3': '#D7D68E',
        'border': '#C8C083',
        'border-strong': '#A2A15E',
        'text': '#1F2A18',
        'text-dim': '#4F5E3E',
        'text-faint': '#7E8A68',
        'accent': '#306D29',
        'accent-2': '#8FA31E',
        'green': '#0D530E',
        'yellow': '#D39A22',
        'red': '#B74D42',
        'selection': 'rgba(48, 109, 41, 0.22)',
        'selection-text': '#142010',
      },
    },
    {
      id: 'lagoon-postcard',
      name: 'Lagoon Postcard',
      description: 'Cool aquatic paper tones with clean blue-cyan accents.',
      colors: {
        'bg': '#F3FBFA',
        'bg-elev': '#E3F4F4',
        'bg-elev-2': '#D1EAEA',
        'bg-elev-3': '#BEE0E1',
        'border': '#A5CACD',
        'border-strong': '#7FAEB5',
        'text': '#102C3D',
        'text-dim': '#3F6575',
        'text-faint': '#7896A1',
        'accent': '#3B7597',
        'accent-2': '#0EA5A8',
        'green': '#2F8F72',
        'yellow': '#D39B2C',
        'red': '#D65A58',
        'selection': 'rgba(59, 117, 151, 0.22)',
        'selection-text': '#092638',
      },
    },
    {
      id: 'linen-sky-garden',
      name: 'Linen Sky Garden',
      description: 'Airy linen whites with soft sky-blue and garden-green accents.',
      colors: {
        'bg': '#FAF7EF',
        'bg-elev': '#EEE8DA',
        'bg-elev-2': '#E2D8C5',
        'bg-elev-3': '#D5C8B0',
        'border': '#C5B596',
        'border-strong': '#A8906D',
        'text': '#25231E',
        'text-dim': '#5F5A4D',
        'text-faint': '#928875',
        'accent': '#4A8FB8',
        'accent-2': '#6F9F4A',
        'green': '#3E7A3A',
        'yellow': '#C7922C',
        'red': '#C95A52',
        'selection': 'rgba(74, 143, 184, 0.20)',
        'selection-text': '#102838',
      },
    },
    {
      id: 'peach-soda-paper',
      name: 'Peach Soda Paper',
      description: 'Warm peach paper with fizzy coral and apricot highlights.',
      colors: {
        'bg': '#FFF3EA',
        'bg-elev': '#F5E3D6',
        'bg-elev-2': '#EBCFBE',
        'bg-elev-3': '#DEB8A3',
        'border': '#CFA18A',
        'border-strong': '#AF7D66',
        'text': '#30231E',
        'text-dim': '#6D5148',
        'text-faint': '#9D7769',
        'accent': '#E06F4F',
        'accent-2': '#F5A33B',
        'green': '#5E8A43',
        'yellow': '#C98922',
        'red': '#C94E4E',
        'selection': 'rgba(224, 111, 79, 0.22)',
        'selection-text': '#2A1711',
      },
    },
    {
      id: 'porcelain-lilac',
      name: 'Porcelain Lilac',
      description: 'Clean porcelain tones with muted lilac and blueberry accents.',
      colors: {
        'bg': '#F8F7FB',
        'bg-elev': '#ECE8F3',
        'bg-elev-2': '#DED7EA',
        'bg-elev-3': '#CEC4DF',
        'border': '#B9AACF',
        'border-strong': '#9784B6',
        'text': '#272331',
        'text-dim': '#5E566F',
        'text-faint': '#8E82A0',
        'accent': '#7B61B8',
        'accent-2': '#4F83C6',
        'green': '#4F8A5A',
        'yellow': '#C79534',
        'red': '#C85868',
        'selection': 'rgba(123, 97, 184, 0.22)',
        'selection-text': '#1D1730',
      },
    },
    {
      id: 'sakura-milk-glass',
      name: 'Sakura Milk Glass',
      description: 'Delicate milky whites with soft sakura pink and plum accents.',
      colors: {
        'bg': '#FFF7FA',
        'bg-elev': '#F6E8EE',
        'bg-elev-2': '#ECD6E0',
        'bg-elev-3': '#DFC0CF',
        'border': '#CFA4B8',
        'border-strong': '#AD7A94',
        'text': '#302129',
        'text-dim': '#6D5360',
        'text-faint': '#9B7587',
        'accent': '#D95C83',
        'accent-2': '#8A6FB5',
        'green': '#5D8F64',
        'yellow': '#C99236',
        'red': '#C94F66',
        'selection': 'rgba(217, 92, 131, 0.22)',
        'selection-text': '#2B1520',
      },
    },
    {
      id: 'cafe-crema-paper',
      name: 'Café Crema Paper',
      description: 'Creamy coffee-paper tones with roasted caramel accents.',
      colors: {
        'bg': '#FBF4EA',
        'bg-elev': '#EFE2D1',
        'bg-elev-2': '#E2CFB7',
        'bg-elev-3': '#D4B99A',
        'border': '#C19F7A',
        'border-strong': '#9A7654',
        'text': '#2D2118',
        'text-dim': '#665142',
        'text-faint': '#967762',
        'accent': '#9B5E2E',
        'accent-2': '#C8873A',
        'green': '#5F7F3A',
        'yellow': '#C58A2E',
        'red': '#B85A4A',
        'selection': 'rgba(155, 94, 46, 0.22)',
        'selection-text': '#24170F',
      },
    },
  ],

  dark: [
    {
      id: 'amoled-starwell',
      name: 'AMOLED Starwell',
      description: 'True-black AMOLED theme with luminous cyan accents.',
      colors: {
        'bg': '#000000',
        'bg-elev': '#050505',
        'bg-elev-2': '#0A0A0A',
        'bg-elev-3': '#111111',
        'border': '#1F1F1F',
        'border-strong': '#333333',
        'text': '#F2F2F2',
        'text-dim': '#A7A7A7',
        'text-faint': '#6F6F6F',
        'accent': '#5DF8D8',
        'accent-2': '#6FD1D7',
        'green': '#4ADE80',
        'yellow': '#FFD65A',
        'red': '#FF5A5A',
        'selection': 'rgba(93, 248, 216, 0.28)',
        'selection-text': '#000000',
      },
    },
    {
      id: 'ink-lagoon',
      name: 'Ink Lagoon',
      description: 'Deep blue-green ink with clear lagoon highlights.',
      colors: {
        'bg': '#06131B',
        'bg-elev': '#092235',
        'bg-elev-2': '#0D2F46',
        'bg-elev-3': '#123B55',
        'border': '#1E4B63',
        'border-strong': '#3B7597',
        'text': '#E7F7F8',
        'text-dim': '#9ABDC7',
        'text-faint': '#638894',
        'accent': '#6FD1D7',
        'accent-2': '#5DF8D8',
        'green': '#62D18E',
        'yellow': '#FFD65A',
        'red': '#EA7070',
        'selection': 'rgba(111, 209, 215, 0.26)',
        'selection-text': '#031016',
      },
    },
    {
      id: 'hearth-fox',
      name: 'Hearth Fox',
      description: 'Warm dark reds, embers and candlelit cream text.',
      colors: {
        'bg': '#120302',
        'bg-elev': '#160403',
        'bg-elev-2': '#230603',
        'bg-elev-3': '#46100A',
        'border': '#521510',
        'border-strong': '#720d06',
        'text': '#FFF0C4',
        'text-dim': '#D8B98A',
        'text-faint': '#9B765D',
        'accent': '#FF9D23',
        'accent-2': '#FFD65A',
        'green': '#9DBB62',
        'yellow': '#FFD65A',
        'red': '#EA5252',
        'selection': 'rgba(255, 157, 35, 0.28)',
        'selection-text': '#160403',
      },
    },
    {
      id: 'firefly-forest',
      name: 'Firefly Forest',
      description: 'Dark woodland greens with glowing firefly accents.',
      colors: {
        'bg': '#070B05',
        'bg-elev': '#10170B',
        'bg-elev-2': '#18210E',
        'bg-elev-3': '#202C13',
        'border': '#354520',
        'border-strong': '#556B2F',
        'text': '#EFF5D2',
        'text-dim': '#C6D870',
        'text-faint': '#87965A',
        'accent': '#C6D870',
        'accent-2': '#8FA31E',
        'green': '#7EBF52',
        'yellow': '#FFD65A',
        'red': '#EA6A5F',
        'selection': 'rgba(198, 216, 112, 0.25)',
        'selection-text': '#080C05',
      },
    },
    {
      id: 'midnight-herbarium',
      name: 'Midnight Herbarium',
      description: 'Quiet earthy dark mode for long writing sessions.',
      colors: {
        'bg': '#0D1009',
        'bg-elev': '#171B11',
        'bg-elev-2': '#202719',
        'bg-elev-3': '#2A3321',
        'border': '#3B4630',
        'border-strong': '#596647',
        'text': '#E8E1D3',
        'text-dim': '#AAA08D',
        'text-faint': '#746B5B',
        'accent': '#8FA31E',
        'accent-2': '#C58B45',
        'green': '#6FAE4F',
        'yellow': '#D9A441',
        'red': '#C45A4E',
        'selection': 'rgba(143, 163, 30, 0.25)',
        'selection-text': '#0D1009',
      },
    },
    {
      id: 'midnight-blood',
      name: 'Midnight Blood',
      description: 'Blackened crimson night tones with sharp blood-red accents.',
      colors: {
        'bg': '#080204',
        'bg-elev': '#130407',
        'bg-elev-2': '#21070B',
        'bg-elev-3': '#310B12',
        'border': '#4A121B',
        'border-strong': '#7A1C2A',
        'text': '#F7E7E4',
        'text-dim': '#C9A2A0',
        'text-faint': '#8B6668',
        'accent': '#D7263D',
        'accent-2': '#FFB45E',
        'green': '#6FCF8F',
        'yellow': '#FFD166',
        'red': '#FF4D5E',
        'selection': 'rgba(215, 38, 61, 0.28)',
        'selection-text': '#080204',
      },
    },
    {
      id: 'violet-afterglow',
      name: 'Violet Afterglow',
      description: 'Deep violet dusk with electric lavender and blue highlights.',
      colors: {
        'bg': '#090714',
        'bg-elev': '#121026',
        'bg-elev-2': '#1B1836',
        'bg-elev-3': '#262047',
        'border': '#3B315F',
        'border-strong': '#5D4A8F',
        'text': '#F0ECFF',
        'text-dim': '#B9AEDB',
        'text-faint': '#80749F',
        'accent': '#A78BFA',
        'accent-2': '#6FD1D7',
        'green': '#67D391',
        'yellow': '#FFD65A',
        'red': '#F06A7A',
        'selection': 'rgba(167, 139, 250, 0.28)',
        'selection-text': '#090714',
      },
    },
    {
      id: 'charcoal-amber',
      name: 'Charcoal Amber',
      description: 'Neutral charcoal surfaces with warm amber focus accents.',
      colors: {
        'bg': '#0B0B0A',
        'bg-elev': '#161411',
        'bg-elev-2': '#211E19',
        'bg-elev-3': '#2C271F',
        'border': '#42382B',
        'border-strong': '#6A563B',
        'text': '#F2EBDD',
        'text-dim': '#B8AA95',
        'text-faint': '#817363',
        'accent': '#F0A83A',
        'accent-2': '#D6C06A',
        'green': '#78C06A',
        'yellow': '#FFD166',
        'red': '#E86B5F',
        'selection': 'rgba(240, 168, 58, 0.26)',
        'selection-text': '#0B0B0A',
      },
    },
    {
      id: 'deep-sea-terminal',
      name: 'Deep Sea Terminal',
      description: 'A moody blue-black terminal palette with aquatic neon accents.',
      colors: {
        'bg': '#030A0F',
        'bg-elev': '#07141D',
        'bg-elev-2': '#0B1F2B',
        'bg-elev-3': '#102B39',
        'border': '#1B4354',
        'border-strong': '#2D6D83',
        'text': '#E5F8FF',
        'text-dim': '#9FC4D2',
        'text-faint': '#668895',
        'accent': '#28D7C4',
        'accent-2': '#4AA3FF',
        'green': '#5FE08B',
        'yellow': '#F4CF5D',
        'red': '#EF646E',
        'selection': 'rgba(40, 215, 196, 0.26)',
        'selection-text': '#030A0F',
      },
    },
    {
      id: 'mocha-chocolate',
      name: 'Mocha Chocolate',
      description: 'Dark mocha coffee tones with bittersweet chocolate depth and roasted warmth.',
      colors: {
        'bg': '#070302',
        'bg-elev': '#100706',
        'bg-elev-2': '#1A0D0A',
        'bg-elev-3': '#26140F',
        'border': '#3B2119',
        'border-strong': '#654032',
        'text': '#F3E7D8',
        'text-dim': '#C2A895',
        'text-faint': '#8B6E5E',
        'accent': '#B47A4A',
        'accent-2': '#D6A15F',
        'green': '#8A9B58',
        'yellow': '#D8A64A',
        'red': '#C76052',
        'selection': 'rgba(180, 122, 74, 0.28)',
        'selection-text': '#070302',
      },
    },
  ],
};

// Font stacks the user can pick from.
export const FONT_OPTIONS = [
  { id: 'system',     label: 'System sans',        stack: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  { id: 'inter',      label: 'Inter',              stack: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { id: 'serif',      label: 'Serif',              stack: 'Georgia, "Times New Roman", "Iowan Old Style", serif' },
  { id: 'merriweather', label: 'Merriweather-ish', stack: '"Charter", "Iowan Old Style", "Apple Garamond", Georgia, serif' },
  { id: 'humanist',   label: 'Humanist',           stack: 'Optima, Candara, "Trebuchet MS", sans-serif' },
  { id: 'rounded',    label: 'Rounded',            stack: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif' },
];

export const MONO_OPTIONS = [
  { id: 'system',   label: 'System mono',  stack: 'ui-monospace, SFMono-Regular, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace' },
  { id: 'jetbrains', label: 'JetBrains-ish', stack: '"JetBrains Mono", "Fira Code", ui-monospace, monospace' },
  { id: 'fira',     label: 'Fira-ish',     stack: '"Fira Code", "JetBrains Mono", ui-monospace, monospace' },
  { id: 'iaWriter', label: 'iA Writer-ish', stack: '"iA Writer Mono S", "iA Writer Duo S", "JetBrains Mono", ui-monospace, monospace' },
];

export const FONT_SIZES = [
  { id: 'sm', label: 'Small',   px: 13 },
  { id: 'md', label: 'Medium',  px: 15 },
  { id: 'lg', label: 'Large',   px: 16 },
  { id: 'xl', label: 'X-Large', px: 18 },
];

// ----------------------------------------------------------------
// Storage layer.
//
// Two scopes:
//   - synced: store.settings.set('appearance', { ... })
//   - device: localStorage.setItem('yanta.appearance.device', JSON)
//
// A `deviceOnly` flag in each settings group decides which scope is used.
// When `deviceOnly` flips, settings move between scopes.
// ----------------------------------------------------------------

const DEVICE_KEY_PREFIX = 'yanta.settings.device.';
const SYNCED_KEY = 'appearance';

const DEFAULT_APPEARANCE = {
  deviceOnly: false,
  mode: 'auto',                  // 'auto' | 'dark' | 'light' | 'system-colors'
  fontId: 'system',
  monoId: 'system',
  fontSizeId: 'md',
  lineHeight: 1.7,
  colors: {
    dark:  { ...DEFAULT_THEMES.dark },
    light: { ...DEFAULT_THEMES.light },
  },
};

const BOOT_APPEARANCE_KEY = 'yanta.appearance.boot.v1';

function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(target[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function readDeviceSettings() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY_PREFIX + 'appearance');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeDeviceSettings(data) {
  try {
    localStorage.setItem(DEVICE_KEY_PREFIX + 'appearance', JSON.stringify(data));
  } catch {}
}

function clearDeviceSettings() {
  try {
    localStorage.removeItem(DEVICE_KEY_PREFIX + 'appearance');
  } catch {}
}

function writeBootAppearanceCache(data) {
  try {
    localStorage.setItem(BOOT_APPEARANCE_KEY, JSON.stringify(data));
  } catch {}
}

async function readSyncedSettings() {
  try {
    return await store.settings.get(SYNCED_KEY, null);
  } catch {
    return null;
  }
}

async function writeSyncedSettings(data) {
  try {
    await store.settings.set(SYNCED_KEY, data);
  } catch {}
}

async function clearSyncedSettings() {
  try {
    await store.settings.set(SYNCED_KEY, null);
  } catch {}
}

// Current effective appearance settings, kept in memory.
let appearance = deepMerge(DEFAULT_APPEARANCE, {});

export function getAppearance() {
  return deepMerge(DEFAULT_APPEARANCE, appearance);
}

export async function loadAppearance() {
  const deviceData = readDeviceSettings();
  const syncedData = await readSyncedSettings();

  // Legacy migration aus dem alten core.js-theme-System.
  let legacyTheme = null;
  try {
    legacyTheme = await store.settings.get('theme', null);
  } catch {}

  if (deviceData && deviceData.deviceOnly) {
    appearance = deepMerge(DEFAULT_APPEARANCE, deviceData);
  } else if (syncedData) {
    appearance = deepMerge(DEFAULT_APPEARANCE, syncedData);
  } else if (deviceData) {
    appearance = deepMerge(DEFAULT_APPEARANCE, {
      ...deviceData,
      deviceOnly: true,
    });
  } else if (['auto', 'dark', 'light'].includes(legacyTheme)) {
    // Alte Theme-Einstellung übernehmen.
    appearance = deepMerge(DEFAULT_APPEARANCE, {
      mode: legacyTheme,
    });

    await writeSyncedSettings(appearance);
  } else {
    appearance = deepMerge(DEFAULT_APPEARANCE, {});
  }

  applyAppearance();
}

export async function saveAppearance(next, { reason = 'user' } = {}) {
  appearance = deepMerge(appearance, next);

  if (appearance.deviceOnly) {
    writeDeviceSettings(appearance);
    // Also clear synced copy so other devices don't override.
    await clearSyncedSettings();
  } else {
    await writeSyncedSettings(appearance);
    clearDeviceSettings();
  }

  applyAppearance();

  window.dispatchEvent(new CustomEvent('yanta-appearance-changed', {
    detail: { appearance: getAppearance(), reason },
  }));
}

// ----------------------------------------------------------------
// Apply settings to the document.
// ----------------------------------------------------------------

export function resolveEffectiveMode() {
  const mode = appearance.mode || 'auto';
  if (mode === 'dark' || mode === 'light') return mode;
  // 'auto' and 'system-colors' both follow the OS for light/dark.
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

function tryReadSystemAccent() {
  // No reliable cross-browser API; the closest is the user agent's
  // accent-color resolution. We sniff a hidden element styled with
  // accent-color: auto, then read its computed color. Browsers vary;
  // we just return something sensible or null.
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;accent-color:auto;color:AccentColor;';
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    if (c && c !== 'rgb(0, 0, 0)' && c !== 'rgba(0, 0, 0, 0)') return c;
  } catch {}
  return null;
}

export async function cycleAppearanceMode() {
  const order = ['auto', 'dark', 'light'];
  const a = getAppearance();

  const current = order.includes(a.mode) ? a.mode : 'auto';
  const next = order[(order.indexOf(current) + 1) % order.length];

  await saveAppearance({ mode: next });
  toast(`Theme: ${next}`, 'success');
}

export function applyAppearance() {
  const root = document.documentElement;
  const a = getAppearance();
  const mode = resolveEffectiveMode();

  root.dataset.theme = mode;
  root.dataset.appearanceMode = a.mode || 'auto';
  root.style.colorScheme = mode;

  state.theme = mode;

  const themeBtn = $('btn-theme');
  if (themeBtn) {
    themeBtn.title = `Theme: ${a.mode} → ${mode} (click to cycle)`;
  }

  const palette = (a.colors && a.colors[mode]) || DEFAULT_THEMES[mode];

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute(
      'content',
      palette.bg || DEFAULT_THEMES[mode].bg || (mode === 'dark' ? '#141414' : '#fdfcfa')
    );
  }

  for (const tok of COLOR_TOKENS) {
    const val = palette[tok.key] || DEFAULT_THEMES[mode][tok.key];
    const safe = tok.key === 'selection' ? val : (safeCssColor(val) || val);
    root.style.setProperty('--' + tok.key, safe);
  }

  if (a.mode === 'system-colors') {
    const sys = tryReadSystemAccent();
    if (sys) {
      root.style.setProperty('--accent', sys);
    }
  }

  const font = FONT_OPTIONS.find((f) => f.id === a.fontId) || FONT_OPTIONS[0];
  const mono = MONO_OPTIONS.find((f) => f.id === a.monoId) || MONO_OPTIONS[0];

  root.style.setProperty('--font', font.stack);
  root.style.setProperty('--font-mono', mono.stack);

  const size = FONT_SIZES.find((s) => s.id === a.fontSizeId) || FONT_SIZES[1];
  root.style.setProperty('--fs-base', size.px + 'px');

  const lh = Number(a.lineHeight) || 1.7;
  root.style.setProperty('--lh-base', String(lh));

  writeBootAppearanceCache({
    v: 1,
    appearanceMode: a.mode || 'auto',
    colors: a.colors || DEFAULT_APPEARANCE.colors,
    font: font.stack,
    mono: mono.stack,
    fontSize: size.px + 'px',
    lineHeight: String(lh),
    ts: Date.now(),
  });

  window.dispatchEvent(new CustomEvent('yanta-theme-change', {
    detail: {
      theme: mode,
      appearanceMode: a.mode,
      appearance: getAppearance(),
    },
  }));
}

// React to OS theme changes when in 'auto' or 'system-colors' mode.
export function watchSystemTheme() {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (appearance.mode === 'auto' || appearance.mode === 'system-colors') {
        applyAppearance();
      }
    };
    mq.addEventListener?.('change', handler);
  } catch {}
}

// ----------------------------------------------------------------
// Settings modal UI.
// ----------------------------------------------------------------

let modal = null;
let activeSection = 'appearance';

export function openSettings() {
  ensureModal();
  modal.hidden = false;
  renderSettingsBody();
}

export function closeSettings() {
  if (modal) modal.hidden = true;
}

function ensureModal() {
  if (modal) return;

  injectSettingsCss();

  modal = el('div', { class: 'modal yanta-settings-modal', hidden: true });

  const card = el('div', { class: 'modal-card yanta-settings-card' });

  const head = el('header', { class: 'modal-head' },
    el('h3', {}, 'Settings'),
    el('button', { class: 'icon-btn', onclick: closeSettings, title: 'Close' }, '✕'),
  );

  const body = el('div', { class: 'yanta-settings-body' });

  // Left rail: sections
  const rail = el('nav', { class: 'yanta-settings-rail' });
  const sections = [
    { id: 'appearance', label: 'Appearance', icon: 'palette' },
    { id: 'colors',     label: 'Colors',     icon: 'paintbrush' },
    { id: 'typography', label: 'Typography', icon: 'type' },
    { id: 'dashboard',  label: 'Dashboard',  icon: 'layout-dashboard' },
    { id: 'quick-create', label: 'Quick Create', icon: 'circle-plus' },
    { id: 'calendar',   label: 'Calendar',   icon: 'calendar-days' },
    { id: 'sync',       label: 'Sync & Backup', icon: 'refresh-cw' },
    { id: 'about',      label: 'About',      icon: 'info' },
  ];

  for (const s of sections) {
    const btn = el('button', {
      class: 'yanta-settings-rail-btn' + (activeSection === s.id ? ' active' : ''),
      dataset: { section: s.id },
      onclick: () => {
        activeSection = s.id;
        renderSettingsBody();
      },
    });
    btn.innerHTML = `${lucide(s.icon, 14)} <span>${s.label}</span>`;
    rail.append(btn);
  }

  const content = el('div', { class: 'yanta-settings-content' });

  body.append(rail, content);
  card.append(head, body);
  modal.append(card);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSettings();
  });

  document.body.append(modal);
}

function rerenderSettingsBody() {
  if (!modal) return;
  renderSettingsBody();
}

function renderSettingsBody() {
  if (!modal) return;

  // Update rail active state
  for (const btn of modal.querySelectorAll('.yanta-settings-rail-btn')) {
    btn.classList.toggle('active', btn.dataset.section === activeSection);
  }

  const content = modal.querySelector('.yanta-settings-content');
  content.replaceChildren();

  if (activeSection === 'appearance') renderAppearanceSection(content);
  else if (activeSection === 'colors') renderColorsSection(content);
  else if (activeSection === 'typography') renderTypographySection(content);
  else if (activeSection === 'dashboard') renderDashboardSection(content);
  else if (activeSection === 'quick-create') renderQuickCreateSection(content);
  else if (activeSection === 'calendar') renderCalendarSection(content);
  else if (activeSection === 'sync') renderSyncSection(content);
  else if (activeSection === 'about') renderAboutSection(content);
}

// ---- Appearance section ----
function renderAppearanceSection(host) {
  const a = getAppearance();

  host.append(sectionHeader('Appearance', 'Choose how YANTA looks.'));

  // Mode picker
  const modeGroup = el('div', { class: 'yanta-settings-group' });
  modeGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Theme'));

  const modes = [
    { id: 'auto', label: 'Follow system', hint: 'Match OS light/dark' },
    { id: 'dark', label: 'Dark', hint: 'Always dark' },
    { id: 'light', label: 'Light', hint: 'Always light' },
    { id: 'system-colors', label: 'System colors', hint: 'Follow OS theme + use system accent' },
  ];

  const modeRow = el('div', { class: 'yanta-settings-mode-row' });
  for (const m of modes) {
    const card = el('button', {
      class: 'yanta-settings-mode' + (a.mode === m.id ? ' active' : ''),
onclick: async () => {
  await saveAppearance({ mode: m.id });
  rerenderSettingsBody();
},
    });
    card.innerHTML = `
      <div class="yanta-settings-mode-label">${m.label}</div>
      <div class="yanta-settings-mode-hint">${m.hint}</div>
    `;
    modeRow.append(card);
  }
  modeGroup.append(modeRow);
  host.append(modeGroup);

  // Device-only toggle for appearance
  host.append(renderDeviceOnlyToggle(a));

  // Quick reset
  const reset = el('div', { class: 'yanta-settings-group' });
  reset.append(el('div', { class: 'yanta-settings-group-title' }, 'Reset'));
  reset.append(el('button', {
    class: 'btn',
    onclick: async () => {
      if (!confirm('Reset appearance, colors, and typography to defaults?')) return;
      appearance = deepMerge(DEFAULT_APPEARANCE, { deviceOnly: a.deviceOnly });
      await saveAppearance({}, { reason: 'reset' });
      renderSettingsBody();
      toast('Appearance reset', 'success');
    },
  }, 'Reset all appearance to defaults'));
  host.append(reset);
}

// ---- Colors section ----

function colorPresetPreviewSwatches(preset) {
  const keys = ['bg', 'bg-elev-2', 'accent', 'accent-2', 'text'];

  return el(
    'div',
    { class: 'yanta-settings-preset-swatches' },
    keys.map((key) =>
      el('span', {
        class: 'yanta-settings-preset-swatch',
        title: key,
        style: {
          background: preset.colors[key] || 'transparent',
        },
      })
    )
  );
}

function paletteMatchesPreset(palette = {}, presetColors = {}) {
  for (const [key, value] of Object.entries(presetColors || {})) {
    if ((palette?.[key] || '').toLowerCase() !== String(value || '').toLowerCase()) {
      return false;
    }
  }

  return true;
}

async function applyColorPreset(mode, preset) {
  const a = getAppearance();

  const colors = {
    ...a.colors,
    [mode]: {
      ...preset.colors,
    },
  };

  await saveAppearance({ colors }, {
    reason: `color-preset:${mode}:${preset.id}`,
  });

  toast(`Applied "${preset.name}" to ${mode} mode`, 'success');
  rerenderSettingsBody();
}

function renderColorPresetPicker(targetMode, appearanceSettings) {
  const presets = COLOR_PRESETS[targetMode] || [];

  const group = el('div', { class: 'yanta-settings-group yanta-settings-presets-group' });

  group.append(
    el('div', { class: 'yanta-settings-group-title' }, 'Presets'),
    el('p', { class: 'yanta-settings-hint' },
      `These presets only apply to ${targetMode} mode. Your other mode stays unchanged.`
    )
  );

  const grid = el('div', { class: 'yanta-settings-preset-grid' });

  for (const preset of presets) {
    const active = paletteMatchesPreset(
      appearanceSettings.colors?.[targetMode],
      preset.colors
    );

    const card = el('button', {
      class: 'yanta-settings-preset-card' + (active ? ' active' : ''),
      type: 'button',
      onclick: () => applyColorPreset(targetMode, preset),
    });

    card.append(
      colorPresetPreviewSwatches(preset),
      el('div', { class: 'yanta-settings-preset-name' }, preset.name),
      el('div', { class: 'yanta-settings-preset-description' }, preset.description)
    );

    grid.append(card);
  }

  group.append(grid);

  return group;
}

function renderColorsSection(host) {
  host.replaceChildren();

  const a = getAppearance();

  host.append(sectionHeader('Colors', 'Customize the color palette. Dark and light modes are configured separately.'));

  // Sub-tabs: dark / light
  const targetMode = host.dataset.colorMode || resolveEffectiveMode();
  host.dataset.colorMode = targetMode;

  const tabs = el('div', { class: 'yanta-settings-color-tabs' });

  for (const m of ['dark', 'light']) {
    tabs.append(el('button', {
      class: 'yanta-settings-color-tab' + (targetMode === m ? ' active' : ''),
      onclick: () => {
        host.dataset.colorMode = m;
        rerenderSettingsBody();
      },
    }, m === 'dark' ? '🌙 Dark mode' : '☀️ Light mode'));
  }

  host.append(tabs);

  // Mode-specific presets
  host.append(renderColorPresetPicker(targetMode, a));

  // Grouped color editors
  const grouped = {};

  for (const tok of COLOR_TOKENS) {
    if (!grouped[tok.group]) grouped[tok.group] = [];

    // Defensive de-duplication by key inside one group.
    if (!grouped[tok.group].some((x) => x.key === tok.key)) {
      grouped[tok.group].push(tok);
    }
  }

  for (const [groupName, tokens] of Object.entries(grouped)) {
    const groupEl = el('div', { class: 'yanta-settings-group' });
    groupEl.append(el('div', { class: 'yanta-settings-group-title' }, groupName));

    const grid = el('div', { class: 'yanta-settings-color-grid' });

    for (const tok of tokens) {
      const current = a.colors[targetMode]?.[tok.key] || DEFAULT_THEMES[targetMode][tok.key];

      const row = el('div', { class: 'yanta-settings-color-row' });

      const swatch = el('label', { class: 'yanta-settings-swatch' });

      const colorInput = el('input', {
        type: 'color',
        value: cssColorToHex(current) || '#000000',
      });

      colorInput.addEventListener('input', () => {
        updateColorToken(targetMode, tok.key, colorInput.value);
      });

      swatch.append(colorInput);
      swatch.style.background = current;

      const meta = el('div', { class: 'yanta-settings-color-meta' });
      meta.append(el('div', { class: 'yanta-settings-color-label' }, tok.label));

      const textInput = el('input', {
        type: 'text',
        class: 'text-input yanta-settings-color-text',
        value: current,
      });

      textInput.addEventListener('change', () => {
        const v = textInput.value.trim();
        if (v) updateColorToken(targetMode, tok.key, v);
      });

      meta.append(textInput);

      row.append(swatch, meta);
      grid.append(row);
    }

    groupEl.append(grid);
    host.append(groupEl);
  }

  // Reset colors for this mode
  const resetGroup = el('div', { class: 'yanta-settings-group' });

  resetGroup.append(
    el('button', {
      class: 'btn',
      onclick: async () => {
        const next = { colors: { ...a.colors } };
        next.colors[targetMode] = { ...DEFAULT_THEMES[targetMode] };

        await saveAppearance(next);

        renderSettingsBody();
        toast(`${targetMode} colors reset`, 'success');
      },
    }, `Reset ${targetMode} colors to defaults`)
  );

  host.append(resetGroup);
}

function updateColorToken(mode, key, value) {
  const a = getAppearance();
  const colors = { ...a.colors };
  colors[mode] = { ...colors[mode], [key]: value };
  saveAppearance({ colors });

  // Re-render to update the swatch backgrounds.
  // Use a microtask so the input event finishes first.
  requestAnimationFrame(() => {
    const host = modal?.querySelector('.yanta-settings-content');
    if (host && activeSection === 'colors') {
      // Only update visible swatches in place for smoothness; full rerender is fine too.
      for (const sw of host.querySelectorAll('.yanta-settings-swatch')) {
        const inp = sw.querySelector('input[type="color"]');
        if (inp) sw.style.background = inp.value;
      }
    }
  });
}

// ---- Typography section ----
function renderTypographySection(host) {
  const a = getAppearance();

  host.append(sectionHeader('Typography', 'Choose fonts and sizing.'));

  // Body font
  const fontGroup = el('div', { class: 'yanta-settings-group' });
  fontGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Body font'));
  const fontGrid = el('div', { class: 'yanta-settings-font-grid' });
  for (const f of FONT_OPTIONS) {
    const card = el('button', {
      class: 'yanta-settings-font-card' + (a.fontId === f.id ? ' active' : ''),
      style: { fontFamily: f.stack },
onclick: async () => {
  await saveAppearance({ fontId: f.id });
  rerenderSettingsBody();
},
    });
    card.innerHTML = `
      <div class="yanta-settings-font-name">${f.label}</div>
      <div class="yanta-settings-font-sample">The quick brown fox jumps</div>
    `;
    fontGrid.append(card);
  }
  fontGroup.append(fontGrid);
  host.append(fontGroup);

  // Mono font
  const monoGroup = el('div', { class: 'yanta-settings-group' });
  monoGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Monospace font (code)'));
  const monoGrid = el('div', { class: 'yanta-settings-font-grid' });
  for (const f of MONO_OPTIONS) {
    const card = el('button', {
      class: 'yanta-settings-font-card' + (a.monoId === f.id ? ' active' : ''),
      style: { fontFamily: f.stack },
onclick: async () => {
  await saveAppearance({ monoId: f.id });
  rerenderSettingsBody();
},
    });
    card.innerHTML = `
      <div class="yanta-settings-font-name">${f.label}</div>
      <div class="yanta-settings-font-sample">const x = 42;</div>
    `;
    monoGrid.append(card);
  }
  monoGroup.append(monoGrid);
  host.append(monoGroup);

  // Font size
  const sizeGroup = el('div', { class: 'yanta-settings-group' });
  sizeGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Font size'));
  const sizeRow = el('div', { class: 'yanta-settings-size-row' });
  for (const s of FONT_SIZES) {
    sizeRow.append(el('button', {
      class: 'yanta-settings-size-btn' + (a.fontSizeId === s.id ? ' active' : ''),
onclick: async () => {
  await saveAppearance({ fontSizeId: s.id });
  rerenderSettingsBody();
},
    }, `${s.label} (${s.px}px)`));
  }
  sizeGroup.append(sizeRow);
  host.append(sizeGroup);

  // Line height
  const lhGroup = el('div', { class: 'yanta-settings-group' });
  lhGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Line height'));
  const lhRow = el('div', { class: 'yanta-settings-lh-row' });
  const lhSlider = el('input', {
    type: 'range',
    min: '1.3',
    max: '2.1',
    step: '0.05',
    value: String(a.lineHeight),
  });
  const lhValue = el('span', { class: 'yanta-settings-lh-value' }, a.lineHeight.toFixed(2));
  lhSlider.addEventListener('input', () => {
    lhValue.textContent = Number(lhSlider.value).toFixed(2);
    saveAppearance({ lineHeight: Number(lhSlider.value) });
  });
  lhRow.append(lhSlider, lhValue);
  lhGroup.append(lhRow);
  host.append(lhGroup);
}

// ---- Quick Create section ----

function cloneQuickCreateSettings(settings) {
  try {
    return structuredClone(settings);
  } catch {
    return JSON.parse(JSON.stringify(settings ?? null));
  }
}

function quickCreateCatalogItem(actionId) {
  return FLOATING_CREATE_ACTION_CATALOG.find((a) => a.id === actionId) || null;
}

function quickCreateActionById(settings, actionId) {
  return settings.actions.find((a) => a.id === actionId) || null;
}

function enabledQuickCreateActions(settings) {
  return settings.actions
    .filter((a) => a.enabled !== false)
    .sort((a, b) => a.order - b.order);
}

function disabledQuickCreateCatalogItems(settings) {
  const enabled = new Set(
    settings.actions
      .filter((a) => a.enabled !== false)
      .map((a) => a.id)
  );

  return FLOATING_CREATE_ACTION_CATALOG.filter((a) => !enabled.has(a.id));
}

function persistQuickCreateSettings(settings, {
  rerender = true,
  toastMessage = '',
} = {}) {
  const saved = saveFloatingCreateSettings(settings);

  if (toastMessage) {
    toast(toastMessage, 'success');
  }

  if (rerender) {
    renderSettingsBody();
  }

  return saved;
}

function renderQuickCreateSection(host) {
  host.replaceChildren();

  host.append(sectionHeader(
    'Quick Create',
    'Customize the floating create menu: actions, labels, icons and free bubble positions.'
  ));

  const settings = getFloatingCreateSettings();

  const intro = el('div', { class: 'yanta-settings-info' });
  intro.innerHTML = `
    <p><strong>Free layout with guard rails.</strong> Drag bubbles in the preview. YANTA automatically keeps a minimum distance between bubbles, so the menu stays usable.</p>
    <p>Coordinates are saved as relative positions, but users never have to type numbers.</p>
  `;
  host.append(intro);

  host.append(renderQuickCreateActionsGroup(settings));
  host.append(renderQuickCreateLayoutEditor(settings));

  const resetGroup = el('div', { class: 'yanta-settings-group' });
  resetGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Reset'));

  resetGroup.append(
    el('button', {
      class: 'btn',
      onclick: () => {
        resetFloatingCreateSettings();
        toast('Quick Create reset to default', 'success');
        renderSettingsBody();
      },
    }, 'Reset Quick Create to default')
  );

  host.append(resetGroup);
}

function renderQuickCreateActionsGroup(settings) {
  const group = el('div', { class: 'yanta-settings-group yanta-qc-settings-actions' });

  group.append(el('div', { class: 'yanta-settings-group-title' }, 'Actions'));

  const enabled = enabledQuickCreateActions(settings);

  if (!enabled.length) {
    group.append(el('div', { class: 'tree-empty' }, 'No actions enabled. Add one below.'));
  }

  for (const action of enabled) {
    group.append(renderQuickCreateActionRow(settings, action));
  }

  const disabled = disabledQuickCreateCatalogItems(settings);

  if (disabled.length) {
    group.append(el('div', { class: 'yanta-qc-settings-add-title' }, 'Add action'));

    const addRow = el('div', { class: 'yanta-qc-settings-add-row' });

    for (const cat of disabled) {
      const btn = el('button', {
        type: 'button',
        class: 'btn',
        onclick: () => {
          const next = cloneQuickCreateSettings(settings);
          let action = quickCreateActionById(next, cat.id);

          if (!action) {
            action = {
              id: cat.id,
              enabled: false,
              label: cat.defaultLabel,
              icon: cat.defaultIcon,
              x: -76,
              y: 0,
              order: next.actions.length,
            };

            next.actions.push(action);
          }

          const pos = suggestFloatingCreatePosition(next.actions);

          action.enabled = true;
          action.label = action.label || cat.defaultLabel;
          action.icon = action.icon || cat.defaultIcon;
          action.x = pos.x;
          action.y = pos.y;
          action.order = Math.max(0, ...next.actions.map((a) => Number(a.order || 0))) + 1;

          next.actions = constrainFloatingCreateLayout(next.actions, {
            activeId: action.id,
            candidate: pos,
          });

          persistQuickCreateSettings(next, {
            toastMessage: 'Quick Create action added',
          });
        },
      });

      btn.innerHTML = `${lucide(cat.defaultIcon, 14)} ${cat.defaultLabel}`;
      addRow.append(btn);
    }

    group.append(addRow);
  }

  return group;
}

function renderQuickCreateActionRow(settings, action) {
  const cat = quickCreateCatalogItem(action.id);
  const label = action.label || cat?.defaultLabel || action.id;

  const row = el('div', {
    class: 'yanta-qc-settings-row',
    dataset: {
      actionId: action.id,
    },
  });

  const iconPreview = el('button', {
    type: 'button',
    class: 'yanta-qc-settings-icon-btn',
    title: 'Choose icon',
    onclick: async () => {
      const { openIconPicker } = await import('./icon-picker.js');

      openIconPicker({
        title: `Icon for ${label}`,
        initialIcon: action.icon || cat?.defaultIcon || 'circle',
        initialColor: '#6ea8fe',
        allowReset: false,
        applyLabel: 'Apply',
        onApply: ({ icon }) => {
          if (!icon) return;

          const next = cloneQuickCreateSettings(settings);
          const a = quickCreateActionById(next, action.id);
          if (!a) return;

          a.icon = icon;

          persistQuickCreateSettings(next, {
            toastMessage: 'Quick Create icon updated',
          });
        },
      });
    },
  });

  iconPreview.innerHTML = lucide(action.icon || cat?.defaultIcon || 'circle', 18);

  const labelInput = el('input', {
    class: 'text-input yanta-qc-settings-label',
    value: label,
    autocomplete: 'off',
    spellcheck: 'false',
    title: 'Action label',
  });

  labelInput.addEventListener('change', () => {
    const next = cloneQuickCreateSettings(settings);
    const a = quickCreateActionById(next, action.id);
    if (!a) return;

    a.label = labelInput.value.trim() || cat?.defaultLabel || action.id;

    persistQuickCreateSettings(next, {
      rerender: false,
      toastMessage: 'Quick Create label saved',
    });
  });

  const moveUp = el('button', {
    type: 'button',
    class: 'icon-btn',
    title: 'Move up',
    onclick: () => {
      moveQuickCreateAction(settings, action.id, -1);
    },
  });

  moveUp.innerHTML = lucide('chevron-up', 15);

  const moveDown = el('button', {
    type: 'button',
    class: 'icon-btn',
    title: 'Move down',
    onclick: () => {
      moveQuickCreateAction(settings, action.id, 1);
    },
  });

  moveDown.innerHTML = lucide('chevron-down', 15);

  const remove = el('button', {
    type: 'button',
    class: 'icon-btn danger',
    title: 'Remove from Quick Create',
    onclick: () => {
      const next = cloneQuickCreateSettings(settings);
      const a = quickCreateActionById(next, action.id);
      if (!a) return;

      a.enabled = false;

      persistQuickCreateSettings(next, {
        toastMessage: 'Quick Create action removed',
      });
    },
  });

  remove.innerHTML = lucide('minus', 15);

  row.append(iconPreview, labelInput, moveUp, moveDown, remove);

  return row;
}

function moveQuickCreateAction(settings, actionId, delta) {
  const next = cloneQuickCreateSettings(settings);
  const enabled = enabledQuickCreateActions(next);
  const index = enabled.findIndex((a) => a.id === actionId);

  if (index < 0) return;

  const target = index + delta;

  if (target < 0 || target >= enabled.length) return;

  const a = enabled[index];
  const b = enabled[target];

  const old = a.order;
  a.order = b.order;
  b.order = old;

  next.actions = next.actions
    .sort((x, y) => Number(x.order || 0) - Number(y.order || 0))
    .map((x, i) => ({
      ...x,
      order: i,
    }));

  persistQuickCreateSettings(next, {
    toastMessage: 'Quick Create order updated',
  });
}

function positionQuickCreatePreviewBubble(node, action) {
  node.style.left = `calc(100% - 72px + ${Math.round(action.x)}px - 23px)`;
  node.style.top = `calc(100% - 62px + ${Math.round(action.y)}px - 23px)`;
}

function updateQuickCreatePreviewPositions(stage, settings) {
  for (const action of enabledQuickCreateActions(settings)) {
    const node = stage.querySelector(`[data-qc-preview-action="${CSS.escape(action.id)}"]`);
    if (node) {
      positionQuickCreatePreviewBubble(node, action);
    }
  }
}

function renderQuickCreateLayoutEditor(settings) {
  let working = cloneQuickCreateSettings(settings);
  let activeId = enabledQuickCreateActions(working)[0]?.id || '';

  const group = el('div', { class: 'yanta-settings-group yanta-qc-layout-group' });

  group.append(el('div', { class: 'yanta-settings-group-title' }, 'Bubble layout'));

  const hint = el('p', { class: 'yanta-settings-hint' },
    `Drag bubbles freely. Minimum distance: ${FLOATING_CREATE_MIN_DISTANCE}px. Nearby bubbles move aside automatically.`
  );

  group.append(hint);

  const toolbar = el('div', { class: 'yanta-qc-layout-toolbar' });

  const activeLabel = el('span', { class: 'yanta-qc-layout-active-label' }, 'Drag a bubble');

  toolbar.append(activeLabel);
  group.append(toolbar);

  const stage = el('div', { class: 'yanta-qc-layout-stage' });

  function renderStage() {
    stage.replaceChildren();

    const origin = el('div', {
      class: 'yanta-qc-layout-origin',
      title: 'Quick Create button',
    });

    origin.innerHTML = lucide('plus', 20);
    stage.append(origin);

    const enabled = enabledQuickCreateActions(working);

    if (!enabled.length) {
      const empty = el('div', { class: 'yanta-qc-layout-empty' }, 'Enable or add an action first.');
      stage.append(empty);
      return;
    }

    for (const action of enabled) {
      const bubble = el('button', {
        type: 'button',
        class:
          'yanta-qc-layout-bubble' +
          (action.id === activeId ? ' active' : ''),
        title: action.label,
        dataset: {
          qcPreviewAction: action.id,
        },
      });

      bubble.innerHTML = lucide(action.icon, 19);

      positionQuickCreatePreviewBubble(bubble, action);

      bubble.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        activeId = action.id;
        stage.classList.add('is-dragging');

        for (const n of stage.querySelectorAll('.yanta-qc-layout-bubble')) {
          n.classList.toggle('active', n.dataset.qcPreviewAction === activeId);
        }

        const label = quickCreateActionById(working, activeId)?.label || 'Bubble';
        activeLabel.textContent = `Dragging: ${label}`;

        try {
          bubble.setPointerCapture?.(e.pointerId);
        } catch {}

        const onMove = (moveEvent) => {
          if (moveEvent.pointerId !== e.pointerId) return;

          moveEvent.preventDefault();
          moveEvent.stopPropagation();

          const rect = stage.getBoundingClientRect();

          const originX = rect.right - 72;
          const originY = rect.bottom - 62;

          const raw = {
            x: moveEvent.clientX - originX,
            y: moveEvent.clientY - originY,
          };

          working.actions = constrainFloatingCreateLayout(working.actions, {
            activeId,
            candidate: raw,
            minDistance: FLOATING_CREATE_MIN_DISTANCE,
            bounds: FLOATING_CREATE_BOUNDS,
          });

          updateQuickCreatePreviewPositions(stage, working);
        };

        const onUp = (upEvent) => {
          if (upEvent.pointerId !== e.pointerId) return;

          upEvent.preventDefault();
          upEvent.stopPropagation();

          stage.classList.remove('is-dragging');
          activeLabel.textContent = 'Layout saved';

          document.removeEventListener('pointermove', onMove, true);
          document.removeEventListener('pointerup', onUp, true);
          document.removeEventListener('pointercancel', onCancel, true);

          try {
            bubble.releasePointerCapture?.(e.pointerId);
          } catch {}

          working = saveFloatingCreateSettings(working);
        };

        const onCancel = (cancelEvent) => {
          if (cancelEvent.pointerId !== e.pointerId) return;

          stage.classList.remove('is-dragging');
          activeLabel.textContent = 'Drag a bubble';

          document.removeEventListener('pointermove', onMove, true);
          document.removeEventListener('pointerup', onUp, true);
          document.removeEventListener('pointercancel', onCancel, true);
        };

        document.addEventListener('pointermove', onMove, {
          capture: true,
          passive: false,
        });

        document.addEventListener('pointerup', onUp, {
          capture: true,
          passive: false,
        });

        document.addEventListener('pointercancel', onCancel, {
          capture: true,
          passive: false,
        });
      });

      stage.append(bubble);
    }
  }

  renderStage();

  group.append(stage);

  const actions = el('div', { class: 'compress-actions yanta-qc-layout-actions' });

  actions.append(
    el('button', {
      class: 'btn',
      onclick: () => {
        working = getFloatingCreateSettings();
        renderStage();
        activeLabel.textContent = 'Reloaded saved layout';
      },
    }, 'Reload saved layout'),

    el('button', {
      class: 'btn',
      onclick: () => {
        resetFloatingCreateSettings();
        toast('Quick Create layout reset', 'success');
        renderSettingsBody();
      },
    }, 'Reset layout')
  );

  group.append(actions);

  return group;
}

// ---- Dashboard section ----
function renderDashboardSection(host) {
  host.replaceChildren();

  host.append(sectionHeader(
    'Dashboard',
    'Choose how note and folder cards are displayed.'
  ));

  const prefs = getDashboardCardDisplayPrefs();

  const group = el('div', { class: 'yanta-settings-group' });

  group.append(
    el('div', { class: 'yanta-settings-group-title' }, 'Card labels')
  );

  group.append(
    renderDashboardToggle({
      checked: !!prefs.notesShowHeader,
      label: 'Show note title and icon',
      hint: 'Shows a compact header on note cards.',
      onChange: async (checked) => {
        await setDashboardCardDisplayPrefs({
          notesShowHeader: checked,
        });

        toast('Dashboard setting saved', 'success');
      },
    }),

    renderDashboardToggle({
      checked: !!prefs.foldersShowHeader,
      label: 'Show folder title and icon',
      hint: 'Shows a compact header on folder cards.',
      onChange: async (checked) => {
        await setDashboardCardDisplayPrefs({
          foldersShowHeader: checked,
        });

        toast('Dashboard setting saved', 'success');
      },
    }),
  );

  // Wichtig: Card labels zuerst anhängen.
  host.append(group);

  const eventGroup = el('div', { class: 'yanta-settings-group' });

  eventGroup.append(
    el('div', { class: 'yanta-settings-group-title' }, 'Linked event card')
  );

  eventGroup.append(
    renderDashboardToggle({
      checked: prefs.linkedEventShow !== false,
      label: 'Show linked event card on note cards',
      hint: 'Shows a compact calendar event header on dashboard note cards when a note is linked to an event.',
      onChange: async (checked) => {
        await setDashboardCardDisplayPrefs({
          linkedEventShow: checked,
        });

        toast('Dashboard setting saved', 'success');
        renderSettingsBody();
      },
    })
  );

  const fieldPrefs = prefs.linkedEventFields || {};

  const fields = [
    {
      key: 'icon',
      label: 'Show icon',
      hint: 'Shows a small calendar icon.',
    },
    {
      key: 'title',
      label: 'Show title',
      hint: 'Shows the event title.',
    },
    {
      key: 'time',
      label: 'Show time/date',
      hint: 'Shows the event date and time.',
    },
    {
      key: 'location',
      label: 'Show location',
      hint: 'Shows the event location if present.',
    },
    {
      key: 'description',
      label: 'Show description',
      hint: 'Shows the event description if present.',
    },
  ];

  for (const field of fields) {
    eventGroup.append(
      renderDashboardToggle({
        checked: fieldPrefs[field.key] !== false,
        label: field.label,
        hint: field.hint,
        onChange: async (checked) => {
          const current = getDashboardCardDisplayPrefs();

          await setDashboardCardDisplayPrefs({
            linkedEventFields: {
              ...(current.linkedEventFields || {}),
              [field.key]: checked,
            },
          });

          toast('Dashboard setting saved', 'success');
        },
      })
    );
  }

  // Danach Linked event card.
  host.append(eventGroup);

  const info = el('div', { class: 'yanta-settings-info' });

  info.innerHTML = `
    <p><strong>Rename UX:</strong> When headers are hidden, YANTA temporarily opens the card header only for renaming.</p>
    <p>This keeps the dashboard clean by default, while Rename, F2 and keyboard workflows remain reliable.</p>
  `;

  host.append(info);
}

function renderCalendarSection(host) {
  host.replaceChildren();

  const prefs = getCalendarPreferences();

  host.append(sectionHeader(
    'Calendar',
    'Configure date display, time format, week start and calendar weeks.'
  ));

  const group = el('div', { class: 'yanta-settings-group' });
  group.append(el('div', { class: 'yanta-settings-group-title' }, 'Regional format'));

  group.append(
    renderSettingsSelect({
      label: 'Calendar language / locale',
      hint: 'Controls month names, weekdays and FullCalendar labels.',
      value: prefs.locale,
      options: CALENDAR_LOCALES.map((x) => ({
        value: x.id,
        label: x.label,
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ locale: value });
        toast('Calendar setting saved', 'success');
        renderSettingsBody();
      },
    }),

    renderSettingsSelect({
      label: 'Compact date format',
      hint: 'Used for compact YANTA calendar date displays. Default is DD/MM/YYYY.',
      value: prefs.dateFormat,
      options: CALENDAR_DATE_FORMATS.map((x) => ({
        value: x.id,
        label: `${x.label} · ${x.example}`,
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ dateFormat: value });
        toast('Calendar setting saved', 'success');
        renderSettingsBody();
      },
    }),

    renderSettingsSelect({
      label: 'Event editor date preview',
      hint: 'Shown below the date/time inputs when adding or editing events.',
      value: prefs.editorDateStyle,
      options: CALENDAR_EDITOR_DATE_STYLES.map((x) => ({
        value: x.id,
        label: `${x.label} · ${x.exampleDe}`,
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ editorDateStyle: value });
        toast('Calendar setting saved', 'success');
        renderSettingsBody();
      },
    }),

    renderSettingsSelect({
      label: 'Time format',
      hint: 'Controls event times in calendar and editor previews.',
      value: prefs.timeFormat,
      options: CALENDAR_TIME_FORMATS.map((x) => ({
        value: x.id,
        label: `${x.label} · ${x.example}`,
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ timeFormat: value });
        toast('Calendar setting saved', 'success');
        renderSettingsBody();
      },
    })
  );

  host.append(group);

  const weekGroup = el('div', { class: 'yanta-settings-group' });
  weekGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Weeks'));

  weekGroup.append(
    renderSettingsSelect({
      label: 'Week starts on',
      hint: 'ISO 8601 uses Monday.',
      value: String(prefs.weekStart),
      options: CALENDAR_WEEK_STARTS.map((x) => ({
        value: String(x.id),
        label: x.label,
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ weekStart: Number(value) });
        toast('Calendar setting saved', 'success');
        renderSettingsBody();
      },
    }),

    renderCalendarToggle({
      checked: !!prefs.weekNumbers,
      label: 'Show calendar weeks',
      hint: 'Uses ISO week numbers.',
      onChange: async (checked) => {
        await saveCalendarPreferences({ weekNumbers: checked });
        toast('Calendar setting saved', 'success');
        renderSettingsBody();
      },
    })
  );

  host.append(weekGroup);

  const resetGroup = el('div', { class: 'yanta-settings-group' });
  resetGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Reset'));

  resetGroup.append(el('button', {
    class: 'btn',
    onclick: async () => {
      if (!confirm('Reset calendar settings to defaults?')) return;

      await resetCalendarPreferences();
      toast('Calendar settings reset', 'success');
      renderSettingsBody();
    },
  }, 'Reset calendar settings'));

  host.append(resetGroup);
}

function renderDashboardToggle({ checked, label, hint, onChange }) {
  const row = el('label', { class: 'yanta-settings-toggle' });

  const cb = el('input', { type: 'checkbox' });
  cb.checked = !!checked;

  cb.addEventListener('change', async () => {
    await onChange?.(cb.checked);
  });

  row.append(
    cb,
    el('div', { class: 'yanta-settings-toggle-meta' },
      el('div', { class: 'yanta-settings-toggle-label' }, label),
      el('div', { class: 'yanta-settings-toggle-hint' }, hint),
    )
  );

  return row;
}

function renderSettingsSelect({
  label,
  hint = '',
  value,
  options = [],
  onChange,
}) {
  const wrap = el('label', { class: 'yanta-settings-field' });

  const title = el('div', { class: 'yanta-settings-field-label' }, label);

  const select = el('select', {
    class: 'text-input',
  });

  for (const opt of options) {
    const option = el('option', {
      value: opt.value,
    }, opt.label);

    option.selected = String(opt.value) === String(value);
    select.append(option);
  }

  select.addEventListener('change', async () => {
    await onChange?.(select.value);
  });

  wrap.append(title, select);

  if (hint) {
    wrap.append(el('div', { class: 'yanta-settings-field-hint' }, hint));
  }

  return wrap;
}

function renderCalendarToggle({ checked, label, hint, onChange }) {
  const row = el('label', { class: 'yanta-settings-toggle' });

  const cb = el('input', { type: 'checkbox' });
  cb.checked = !!checked;

  cb.addEventListener('change', async () => {
    await onChange?.(cb.checked);
  });

  row.append(
    cb,
    el('div', { class: 'yanta-settings-toggle-meta' },
      el('div', { class: 'yanta-settings-toggle-label' }, label),
      el('div', { class: 'yanta-settings-toggle-hint' }, hint),
    )
  );

  return row;
}

// ---- Sync section ----
function renderSyncSection(host) {
  const a = getAppearance();

  host.append(sectionHeader('Sync & Backup', 'Control how your settings travel between devices.'));

  host.append(renderDeviceOnlyToggle(a));

  const info = el('div', { class: 'yanta-settings-info' });
  info.innerHTML = `
    <p><strong>Synced settings</strong> live in your YANTA database and travel with your notes — through the sync folder, exports, and bundle backups.</p>
    <p><strong>Device-only</strong> settings stay in this browser's localStorage. Useful if you prefer a different theme on your phone vs your desktop, for example.</p>
  `;
  host.append(info);

  // Sync Capsule
  const capsuleGroup = el('div', { class: 'yanta-settings-group' });
  capsuleGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Encrypted Sync Capsule'));
  capsuleGroup.append(el('p', { class: 'yanta-settings-hint' },
    'Create an encrypted .yanta file that contains your notes, folders, drawings, metadata, tombstones and image assets. Importing a capsule merges it into this vault instead of replacing everything.'));

  const capsuleActions = el('div', {
    class: 'compress-actions',
    style: {
      justifyContent: 'flex-start',
      flexWrap: 'wrap',
      marginTop: '10px',
    },
  });

  capsuleActions.append(
    el('button', {
      class: 'btn primary',
      onclick: async () => {
        const { exportSyncCapsule } = await import('./sync2/capsule.js');
        await exportSyncCapsule();
      },
    }, 'Back up now'),

    el('button', {
      class: 'btn',
      onclick: async () => {
        const { pickAndImportSyncCapsule } = await import('./sync2/capsule.js');
        await pickAndImportSyncCapsule();
      },
    }, 'Restore from backup'),

    el('button', {
      class: 'btn',
      onclick: async () => {
        const { copySyncCapsuleRecoveryKey } = await import('./sync2/capsule.js');
        await copySyncCapsuleRecoveryKey();
      },
    }, 'Copy sync key')
  );

  capsuleGroup.append(capsuleActions);

  const capsuleNote = el('div', { class: 'yanta-settings-info', style: { marginTop: '10px' } });
  capsuleNote.innerHTML = `
    <p><strong>Private by default.</strong> The capsule encrypts note contents, drawings, folders, tags and image files before they leave this device.</p>
    <p>The sync key is required to restore this capsule on another device. Keep it private.</p>
  `;
  capsuleGroup.append(capsuleNote);

  host.append(capsuleGroup);

  // Future Cloud Sync placeholder
  const cloudGroup = el('div', { class: 'yanta-settings-group' });
  cloudGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Cloud Sync'));
  cloudGroup.append(el('p', { class: 'yanta-settings-hint' },
    'Synchronize encrypted YANTA data through a cloud provider. Google Drive is available now; Dropbox, OneDrive and others can be added later through the same provider-neutral sync layer.'
  ));
  cloudGroup.append(el('button', {
    class: 'btn primary',
    onclick: async () => {
      closeSettings();

      const { openGoogleDriveSyncSetup } = await import('./sync2/sync-setup-ui.js');
      openGoogleDriveSyncSetup();
    },
  }, 'Set up Cloud Sync'));
  host.append(cloudGroup);

  // Sync folder shortcut
  const syncGroup = el('div', { class: 'yanta-settings-group' });
  syncGroup.append(el('div', { class: 'yanta-settings-group-title' }, 'Advanced: Sync Folder'));
  syncGroup.append(el('p', { class: 'yanta-settings-hint' },
    'Advanced option: mirror your notes to a folder on disk and sync that folder with Syncthing, Dropbox, iCloud, SMB or your own backup tool.'));
  syncGroup.append(el('button', {
    class: 'btn',
    onclick: async () => {
      closeSettings();
      const { openSyncSetup } = await import('./sync.js');
      openSyncSetup();
    },
  }, 'Set up sync folder…'));
  host.append(syncGroup);
}

// ---- About section ----
function renderAboutSection(host) {
  host.append(sectionHeader('About', null));
  const about = el('div', { class: 'yanta-settings-info' });
  about.innerHTML = `
    <p><strong>YANTA</strong> — Yet Another Note Taking App.</p>
    <p>Local-first Markdown notes with built-in live collaboration.</p>
    <p style="color:var(--text-faint);font-size:12px;margin-top:12px">All data stays in your browser. Sync happens through a folder you control. Live shares are end-to-end encrypted via WebRTC.</p>
  `;
  host.append(about);

  // Danger zone
  const danger = el('div', { class: 'yanta-settings-group' });
  danger.append(el('div', { class: 'yanta-settings-group-title' }, 'Reset all settings'));
  danger.append(el('p', { class: 'yanta-settings-hint' },
    'This clears all appearance preferences (both device-only and synced). Your notes are untouched.'));
  danger.append(el('button', {
    class: 'btn danger',
    onclick: async () => {
      if (!confirm('Reset all settings to defaults? Your notes are not affected.')) return;
      clearDeviceSettings();
      await clearSyncedSettings();
      appearance = deepMerge(DEFAULT_APPEARANCE, {});
      applyAppearance();
      renderSettingsBody();
      toast('All settings reset', 'success');
    },
  }, 'Reset all settings'));
  host.append(danger);
}

// ---- Shared helpers ----
function sectionHeader(title, subtitle) {
  const wrap = el('div', { class: 'yanta-settings-section-header' });
  wrap.append(el('h4', {}, title));
  if (subtitle) wrap.append(el('p', { class: 'yanta-settings-subtitle' }, subtitle));
  return wrap;
}

function renderDeviceOnlyToggle(a) {
  const group = el('div', { class: 'yanta-settings-group' });
  group.append(el('div', { class: 'yanta-settings-group-title' }, 'Scope'));

  const row = el('label', { class: 'yanta-settings-toggle' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = !!a.deviceOnly;
cb.addEventListener('change', async () => {
  await saveAppearance({ deviceOnly: cb.checked });
  toast(cb.checked ? 'Settings saved for this device only' : 'Settings now synced across devices', 'success');
  rerenderSettingsBody();
});
  row.append(cb);
  row.append(el('div', { class: 'yanta-settings-toggle-meta' },
    el('div', { class: 'yanta-settings-toggle-label' }, 'For this device only'),
    el('div', { class: 'yanta-settings-toggle-hint' },
      'When on, these settings stay on this device and are not synced or exported with your notes.'),
  ));
  group.append(row);
  return group;
}

// ----------------------------------------------------------------
// Settings CSS — injected at runtime so it's self-contained.
// ----------------------------------------------------------------

let cssInjected = false;
function injectSettingsCss() {
  if (cssInjected) return;
  cssInjected = true;

  const style = document.createElement('style');
  style.id = 'yanta-settings-css';
  style.textContent = `
.yanta-settings-modal .yanta-settings-card {
  width: min(880px, 96vw);
  height: min(720px, 92vh);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
}

.yanta-settings-body {
  display: grid;
  grid-template-columns: 200px 1fr;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.yanta-settings-rail {
  border-right: 1px solid var(--border);
  background: var(--bg-elev-2);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.yanta-settings-rail-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.yanta-settings-rail-btn:hover {
  background: var(--bg-elev-3);
  color: var(--text);
}

.yanta-settings-rail-btn.active {
  background: var(--bg-elev-3);
  color: var(--accent);
  font-weight: 600;
}

.yanta-settings-content {
  overflow-y: auto;
  padding: 20px 24px 30px;
}

.yanta-settings-section-header {
  margin-bottom: 18px;
}

.yanta-settings-section-header h4 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 4px;
}

.yanta-settings-subtitle {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0;
}

.yanta-settings-group {
  margin-bottom: 22px;
}

.yanta-settings-group-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  margin-bottom: 10px;
}

.yanta-settings-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin: 0 0 10px;
  line-height: 1.5;
}

.yanta-settings-info {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.6;
  padding: 14px 16px;
  background: var(--bg-elev-2);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.yanta-settings-info p {
  margin: 0 0 8px;
}

.yanta-settings-info p:last-child {
  margin-bottom: 0;
}

.yanta-settings-info strong {
  color: var(--text);
}

/* Mode picker */
.yanta-settings-mode-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.yanta-settings-mode {
  text-align: left;
  padding: 12px 14px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  color: var(--text);
  transition: border-color 0.1s, background 0.1s;
}

.yanta-settings-mode:hover {
  border-color: var(--border-strong);
}

.yanta-settings-mode.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.yanta-settings-mode-label {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 3px;
}

.yanta-settings-mode-hint {
  font-size: 11px;
  color: var(--text-dim);
}

/* Device-only toggle */
.yanta-settings-toggle {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}

.yanta-settings-toggle:hover {
  border-color: var(--border-strong);
}

.yanta-settings-toggle input[type="checkbox"] {
  margin-top: 2px;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  flex: 0 0 auto;
}

.yanta-settings-toggle-meta { flex: 1; }

.yanta-settings-toggle-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.yanta-settings-toggle-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
  line-height: 1.5;
}

/* Color presets */
.yanta-settings-presets-group {
  margin-bottom: 24px;
}

.yanta-settings-preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}

.yanta-settings-preset-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;

  width: 100%;
  min-height: 120px;

  padding: 12px;
  border-radius: 10px;

  background: var(--bg-elev-2);
  border: 1px solid var(--border);

  color: var(--text);
  text-align: left;
  cursor: pointer;

  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    transform 120ms ease,
    box-shadow 120ms ease;
}

.yanta-settings-preset-card:hover {
  border-color: var(--border-strong);
  background: var(--bg-elev-3);
  transform: translateY(-1px);
}

.yanta-settings-preset-card.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-elev-2));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent) inset;
}

.yanta-settings-preset-swatches {
  display: flex;
  align-items: center;
  gap: 5px;
}

.yanta-settings-preset-swatch {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 70%, transparent);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.05) inset;
}

.yanta-settings-preset-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.yanta-settings-preset-description {
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-dim);
}

/* Colors */
.yanta-settings-color-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--bg-elev-2);
  border-radius: 8px;
  margin-bottom: 18px;
}

.yanta-settings-color-tab {
  flex: 1;
  padding: 8px 12px;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 13px;
}

.yanta-settings-color-tab.active {
  background: var(--bg-elev-3);
  color: var(--text);
  font-weight: 600;
}

.yanta-settings-color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.yanta-settings-color-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.yanta-settings-swatch {
  position: relative;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--border);
  overflow: hidden;
}

.yanta-settings-swatch input[type="color"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  opacity: 0;
  cursor: pointer;
}

.yanta-settings-color-meta {
  flex: 1;
  min-width: 0;
}

.yanta-settings-color-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 3px;
}

.yanta-settings-color-text {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 4px 6px;
  width: 100%;
  background: var(--bg);
  margin: 0;
}

/* Typography */
.yanta-settings-font-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.yanta-settings-font-card {
  text-align: left;
  padding: 12px 14px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  color: var(--text);
}

.yanta-settings-font-card:hover {
  border-color: var(--border-strong);
}

.yanta-settings-font-card.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.yanta-settings-font-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-dim);
  margin-bottom: 6px;
  font-family: var(--font);
}

.yanta-settings-font-sample {
  font-size: 15px;
  color: var(--text);
}

.yanta-settings-size-row,
.yanta-settings-lh-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.yanta-settings-size-btn {
  padding: 7px 12px;
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  font-size: 12px;
}

.yanta-settings-size-btn:hover {
  border-color: var(--border-strong);
}

.yanta-settings-size-btn.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.yanta-settings-lh-row input[type="range"] {
  flex: 1;
  accent-color: var(--accent);
}

.yanta-settings-lh-value {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-dim);
  min-width: 50px;
  text-align: right;
}

/* Quick Create settings */
.yanta-qc-settings-actions {
  margin-top: 18px;
}

.yanta-qc-settings-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 30px 30px 30px;
  gap: 8px;
  align-items: center;

  padding: 8px;
  margin-bottom: 7px;

  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev-2);
}

.yanta-qc-settings-icon-btn {
  width: 36px;
  height: 36px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 1px solid var(--border);
  border-radius: 999px;

  background: var(--bg-elev);
  color: var(--accent);

  cursor: pointer;
}

.yanta-qc-settings-icon-btn:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev));
}

.yanta-qc-settings-label {
  margin: 0;
  min-width: 0;
}

.yanta-qc-settings-add-title {
  margin: 14px 0 7px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}

.yanta-qc-settings-add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.yanta-qc-layout-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  margin-bottom: 8px;
}

.yanta-qc-layout-active-label {
  color: var(--text-dim);
  font-size: 12px;
}

.yanta-qc-layout-stage {
  position: relative;

  height: 330px;
  min-height: 330px;

  border: 1px solid var(--border);
  border-radius: 16px;

  background:
    radial-gradient(circle at calc(100% - 72px) calc(100% - 62px),
      color-mix(in srgb, var(--accent) 16%, transparent),
      transparent 110px),
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--bg-elev-2) 94%, transparent),
      var(--bg-elev)
    );

  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.yanta-qc-layout-stage::before {
  content: "";
  position: absolute;
  inset: 14px;

  border: 1px dashed color-mix(in srgb, var(--border-strong) 70%, transparent);
  border-radius: 14px;

  pointer-events: none;
  opacity: 0.55;
}

.yanta-qc-layout-origin {
  position: absolute;
  right: 45px;
  bottom: 35px;

  width: 54px;
  height: 54px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;

  background: var(--accent);
  color: white;

  box-shadow: 0 10px 28px rgba(0,0,0,0.22);
  pointer-events: none;
}

.yanta-qc-layout-bubble {
  position: absolute;

  width: 46px;
  height: 46px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 0;
  border-radius: 999px;

  background: var(--accent);
  color: white;

  box-shadow: 0 8px 24px rgba(0,0,0,0.20);

  cursor: grab;
  touch-action: none;

  transition:
    transform 120ms cubic-bezier(.2,.8,.2,1),
    box-shadow 120ms ease,
    outline-color 120ms ease;
}

.yanta-qc-layout-bubble:hover {
  transform: scale(1.08);
}

.yanta-qc-layout-bubble:active,
.yanta-qc-layout-stage.is-dragging .yanta-qc-layout-bubble.active {
  cursor: grabbing;
  transform: scale(1.12);
  box-shadow: 0 12px 34px rgba(0,0,0,0.28);
}

.yanta-qc-layout-bubble.active {
  outline: 3px solid color-mix(in srgb, var(--accent-2) 70%, transparent);
  outline-offset: 4px;
}

.yanta-qc-layout-stage.is-dragging .yanta-qc-layout-bubble.active::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;

  width: 58px;
  height: 58px;

  border-radius: 999px;
  border: 1px dashed color-mix(in srgb, white 75%, transparent);

  transform: translate(-50%, -50%);

  pointer-events: none;
  opacity: 0.7;
}

.yanta-qc-layout-empty {
  position: absolute;
  inset: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--text-faint);
  font-size: 13px;
  font-style: italic;
}

.yanta-qc-layout-actions {
  margin-top: 10px;
  justify-content: flex-start;
}

@media (max-width: 720px) {
  .yanta-qc-settings-row {
    grid-template-columns: 42px minmax(0, 1fr) 30px 30px 30px;
  }

  .yanta-qc-layout-stage {
    height: 310px;
    min-height: 310px;
  }
}

/* Mobile */
@media (max-width: 720px) {
  .yanta-settings-body {
    grid-template-columns: 1fr;
  }

  .yanta-settings-rail {
    flex-direction: row;
    border-right: 0;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    padding: 8px;
    gap: 4px;
    justify-content: space-around;
  }

  .yanta-settings-rail-btn {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .yanta-settings-rail-btn span {
    display: none;
  }

  .yanta-settings-field {
    display: flex;
    flex-direction: column;
    gap: 5px;

    padding: 12px 14px;
    margin-bottom: 8px;

    background: var(--bg-elev-2);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .yanta-settings-field-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .yanta-settings-field-hint {
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.45;
  }

  .yanta-settings-field .text-input {
    margin: 0;
  }
    
}
  `;

  document.head.append(style);
}
// ============================================================
// YANTA — Settings: appearance (themes, colors, fonts), persistence.
// Settings live in two scopes:
//   - device-only: localStorage (not synced, not exported)
//   - synced:     IndexedDB settings store (included in sync + exports)
// Users can toggle "this device only" per settings group.
// ============================================================

import { $, el, state, store, toast, lucide, safeCssColor, cssColorToHex } from './core.js';
import { LOCALES, getLocale, hasExplicitLocale, setLocale, clearLocale, t } from './i18n/index.js';
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

import {
  FLOATING_CREATE_ICON_OPTIONS,
  floatingCreateIconPreview,
} from './floating-create-icons.js';

import {
  yantaConfirm,
} from './dialogs.js';

import {
  pushOverlayState,
  closeTopOverlay,
  registerOverlayRoute,
} from './overlay-history.js';

import { editorShortcutsSettingsElement } from './editor/shortcuts-settings.js';
import { installCardElement } from './install/install-ui.js';
import { notificationsSettingsElement } from './install/notifications-settings.js';
import { pulseSettingsElement } from './pulse/pulse-settings-panel.js';

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
    'bg': '#000000',
    'bg-elev': '#050505',
    'bg-elev-2': '#0A0A0A',
    'bg-elev-3': '#111111',
    'border': '#1F1F1F',
    'border-strong': '#333333',
    'text': '#F2F2F2',
    'text-dim': '#A7A7A7',
    'text-faint': '#6F6F6F',
    'accent': '#4ac5ac',
    'accent-2': '#5DF8D8',
    'green': '#4ADE80',
    'yellow': '#FFD65A',
    'red': '#FF5A5A',
    'selection': 'rgba(93, 248, 216, 0.28)',
    'selection-text': '#000000',
  },
  light: {
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
};

export const COLOR_PRESETS = {
  light: [

    {
      id: 'misty-quartz',
      name: 'Misty Quartz',
      description: 'Crisp professional slate with icy blue accents.',
      colors: {
        'bg': '#F7F9FB',
        'bg-elev': '#EDF1F5',
        'bg-elev-2': '#E2E8EE',
        'bg-elev-3': '#D5DDE5',
        'border': '#B8C5D1',
        'border-strong': '#94A5B5',
        'text': '#1A202B',
        'text-dim': '#4D5666',
        'text-faint': '#7E8A9C',
        'accent': '#3E7CB1',
        'accent-2': '#81A4CD',
        'green': '#3B8C5A',
        'yellow': '#D9A22B',
        'red': '#CD5C5C',
        'selection': 'rgba(62, 124, 177, 0.20)',
        'selection-text': '#0E1B2A',
      },
    },
    {
      id: 'golden-hour',
      name: 'Golden Hour',
      description: 'Warm radiant beige with rich amber and rust accents.',
      colors: {
        'bg': '#FFF8E7',
        'bg-elev': '#FBEFD3',
        'bg-elev-2': '#F2DFB0',
        'bg-elev-3': '#E9CD8C',
        'border': '#D6B566',
        'border-strong': '#B08D3E',
        'text': '#2B2415',
        'text-dim': '#6B5E40',
        'text-faint': '#9B8A64',
        'accent': '#E08A1E',
        'accent-2': '#C2452D',
        'green': '#5E8C3A',
        'yellow': '#E0AC10',
        'red': '#C8452D',
        'selection': 'rgba(224, 138, 30, 0.22)',
        'selection-text': '#2A1B0A',
      },
    },
    {
      id: 'antique-manuscript',
      name: 'Antique Manuscript',
      description: 'Classic sepia and parchment tones with deep ink accents.',
      colors: {
        'bg': '#F4ECE1',
        'bg-elev': '#E9DCC8',
        'bg-elev-2': '#DCC8AC',
        'bg-elev-3': '#CDB391',
        'border': '#B29665',
        'border-strong': '#8C6E40',
        'text': '#2A1F12',
        'text-dim': '#614D35',
        'text-faint': '#8F7553',
        'accent': '#8E4A2F',
        'accent-2': '#594A3A',
        'green': '#4A7340',
        'yellow': '#B8862B',
        'red': '#9E3B3B',
        'selection': 'rgba(142, 74, 47, 0.20)',
        'selection-text': '#1E120A',
      },
    },
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
      id: 'neo-tokyo-dusk',
      name: 'Neo Tokyo Dusk',
      description: 'Cyberpunk indigo nights with vibrant neon pink and cyan.',
      colors: {
        'bg': '#0A0A12',
        'bg-elev': '#111120',
        'bg-elev-2': '#1A1A2E',
        'bg-elev-3': '#24243A',
        'border': '#2E2E48',
        'border-strong': '#42426B',
        'text': '#E6E6F0',
        'text-dim': '#A0A0C0',
        'text-faint': '#686880',
        'accent': '#FF2A6D',
        'accent-2': '#05D9E8',
        'green': '#45D96A',
        'yellow': '#FFD65A',
        'red': '#FF4D5E',
        'selection': 'rgba(255, 42, 109, 0.28)',
        'selection-text': '#0A0A12',
      },
    },
    {
      id: 'carbon-plum',
      name: 'Carbon Plum',
      description: 'Muted dark plum charcoal with sophisticated fuchsia.',
      colors: {
        'bg': '#0C0810',
        'bg-elev': '#150F1A',
        'bg-elev-2': '#1F1726',
        'bg-elev-3': '#2A1F33',
        'border': '#3B2A47',
        'border-strong': '#5A3D6E',
        'text': '#F2EAF8',
        'text-dim': '#C0A8D1',
        'text-faint': '#8A7799',
        'accent': '#C026D3',
        'accent-2': '#9333EA',
        'green': '#4ADE80',
        'yellow': '#FACC15',
        'red': '#EF4444',
        'selection': 'rgba(192, 38, 211, 0.28)',
        'selection-text': '#0C0810',
      },
    },
    {
      id: 'solar-eclipse',
      name: 'Solar Eclipse',
      description: 'Abyssal black warmth pierced by blazing corona yellow.',
      colors: {
        'bg': '#080604',
        'bg-elev': '#120E07',
        'bg-elev-2': '#1C1509',
        'bg-elev-3': '#281D0C',
        'border': '#3D2C12',
        'border-strong': '#63451C',
        'text': '#FFF8E7',
        'text-dim': '#D9C49A',
        'text-faint': '#9C8358',
        'accent': '#FDB813',
        'accent-2': '#FF6B1A',
        'green': '#85C040',
        'yellow': '#FDB813',
        'red': '#E04C2D',
        'selection': 'rgba(253, 184, 19, 0.28)',
        'selection-text': '#080604',
      },
    },
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
        'accent': '#4ac5ac',
        'accent-2': '#5DF8D8',
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
let settingsOverlayRegistered = false;

// Section registry — drives the rail, the mobile drill-down list and search.
// `keywords` widens search matches beyond the visible label.
const SETTINGS_SECTIONS = [
  { id: 'appearance',   label: 'Appearance',      icon: 'palette',        keywords: 'theme dark light mode look' },
  { id: 'language',     label: 'Language',        icon: 'languages',      keywords: 'language locale english deutsch german español spanish français french 日本語 japanese translation' },
  { id: 'colors',       label: 'Colors',          icon: 'paintbrush',     keywords: 'palette accent color scheme' },
  { id: 'typography',   label: 'Typography',      icon: 'type',           keywords: 'font size text' },
  { id: 'shortcuts',    label: 'Shortcuts',       icon: 'keyboard',       keywords: 'keyboard hotkey key binding shortcut editor formatting bold heading' },
  { id: 'dashboard',    label: 'Dashboard',       icon: 'layout-dashboard', keywords: 'home widgets greeting' },
  { id: 'quick-create', label: 'Quick Actions',   icon: 'gamepad-directional',    keywords: 'floating create menu bubble action chat ai rss shortcut' },
  { id: 'calendar',     label: 'Calendar',        icon: 'calendar-days',  keywords: 'events reminders ics' },
  { id: 'sources',      label: 'Sources',         icon: 'rss',            keywords: 'rss feeds sources' },
  { id: 'ai',           label: 'AI',              icon: 'bot',            keywords: 'assistant model provider' },
  { id: 'semantic',     label: 'Semantic search', icon: 'brain-circuit',  keywords: 'embeddings vector search' },
  { id: 'pulse',        label: 'Pulse',           icon: 'activity',       keywords: 'routine automation background proactive agent heartbeat schedule digest' },
  { id: 'chat',         label: 'Chat',            icon: 'message-circle', keywords: 'messages conversation' },
  { id: 'sync',         label: 'Sync & Backup',   icon: 'refresh-cw',     keywords: 'cloud backup devices encrypted google drive' },
  { id: 'notifications', label: 'Notifications',  icon: 'bell',           keywords: 'alerts push reminders' },
  { id: 'install',      label: 'Install app',     icon: 'smartphone',     keywords: 'pwa install app native' },
  { id: 'billing',      label: 'Plan & Billing',  icon: 'credit-card',    keywords: 'subscription plus upgrade payment invoice plan paddle' },
  { id: 'about',        label: 'About',           icon: 'info',           keywords: 'version legal license' },
];

// Rail label for a section id, from the catalog (settings.nav.<camelId>).
// Section ids are kebab-case; catalog keys are camelCase ('quick-create' →
// 'quickCreate').
function navLabel(id) {
  return t('settings.nav.' + id.replace(/-(\w)/g, (_, c) => c.toUpperCase()));
}

// The Quick Actions rail entry mirrors the chosen trigger icon; the rest
// use their static lucide glyph.
function settingsRailIcon(section) {
  if (section.id === 'quick-create') {
    return floatingCreateIconPreview(getFloatingCreateSettings().iconStyle);
  }

  return lucide(section.icon, 16);
}

function refreshQuickCreateRailIcon() {
  const icon = modal?.querySelector(
    '.yanta-settings-rail-btn[data-section="quick-create"] .yanta-settings-rail-icon'
  );

  if (icon) {
    icon.innerHTML = floatingCreateIconPreview(getFloatingCreateSettings().iconStyle);
  }
}

function settingsIsOpen() {
  return !!modal && modal.hidden === false;
}

function registerSettingsOverlayRoute() {
  if (settingsOverlayRegistered) return;

  settingsOverlayRegistered = true;

  registerOverlayRoute('settings', {
    open: () => {
      openSettings({
        fromHistory: true,
      });
    },

    close: () => {
      closeSettings({
        fromHistory: true,
      });
    },

    isOpen: settingsIsOpen,
  });
}

export function openSettings({
  fromHistory = false,
  section = '',
} = {}) {
  ensureModal();
  registerSettingsOverlayRoute();

  const wasClosed = modal.hidden !== false;

  // Deep link from another surface, e.g. the Pulse overview's gear.
  if (section && SETTINGS_SECTIONS.some((s) => s.id === section)) {
    activeSection = section;
  }

  modal.hidden = false;
  renderSettingsBody();

  // On mobile, land on the section list — unless a deep link named the
  // section, where skipping straight to it is the whole point.
  if (wasClosed) setMobileDetail(!!section);

  if (!fromHistory && wasClosed) {
    pushOverlayState('settings');
  }
}

export function closeSettings({
  fromHistory = false,
} = {}) {
  if (!modal) return;

  if (!fromHistory && modal.hidden === false) {
    closeTopOverlay(() => {
      closeSettings({
        fromHistory: true,
      });
    });

    return;
  }

  modal.hidden = true;
}

function ensureModal() {
  if (modal) return;

  injectSettingsCss();

  modal = el('div', { class: 'modal yanta-settings-modal', hidden: true });

  const card = el('div', { class: 'modal-card yanta-settings-card' });

  // lucide() returns an SVG string, so the icon must go in via innerHTML —
  // passing it as an el() child would render as literal text.
  const backBtn = el('button', {
    class: 'icon-btn yanta-settings-back',
    onclick: () => setMobileDetail(false),
    title: t('common.back'),
    'aria-label': t('settings.backAria'),
  });
  backBtn.innerHTML = lucide('chevron-left', 18);

  const head = el('header', { class: 'modal-head' },
    backBtn,
    el('h3', {}, t('settings.title')),
    el('button', { class: 'icon-btn', onclick: closeSettings, title: t('common.close') }, '✕'),
  );

  const body = el('div', { class: 'yanta-settings-body' });

  // Left rail: search + section list. On mobile the rail is the master list of
  // a drill-down; selecting a section reveals the detail pane (see setMobileDetail).
  const rail = el('nav', { class: 'yanta-settings-rail' });

  const search = el('input', {
    class: 'yanta-settings-search',
    type: 'search',
    placeholder: t('settings.searchPlaceholder'),
    'aria-label': t('settings.searchAria'),
  });
  search.addEventListener('input', () => filterSettingsRail(search.value));

  const railList = el('div', { class: 'yanta-settings-rail-list' });
  const railEmpty = el('div', { class: 'yanta-settings-rail-empty', hidden: true }, t('settings.noMatches'));

  for (const s of SETTINGS_SECTIONS) {
    const label = navLabel(s.id);
    const btn = el('button', {
      class: 'yanta-settings-rail-btn' + (activeSection === s.id ? ' active' : ''),
      // Search still matches the (English) keyword aliases so power users find
      // sections by concept regardless of UI language.
      dataset: { section: s.id, search: `${label} ${s.keywords || ''}`.toLowerCase() },
      onclick: () => goToSection(s.id),
    });
    btn.innerHTML =
      `<span class="yanta-settings-rail-icon">${settingsRailIcon(s)}</span>` +
      `<span class="yanta-settings-rail-label">${label}</span>` +
      `<span class="yanta-settings-rail-chevron">${lucide('chevron-right', 15)}</span>`;
    railList.append(btn);
  }

  rail.append(search, railList, railEmpty);

  const content = el('div', { class: 'yanta-settings-content' });

  body.append(rail, content);
  card.append(head, body);
  modal.append(card);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSettings();
  });

  document.body.append(modal);

  registerSettingsOverlayRoute();
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
  else if (activeSection === 'language') renderLanguageSection(content);
  else if (activeSection === 'colors') renderColorsSection(content);
  else if (activeSection === 'typography') renderTypographySection(content);
  else if (activeSection === 'shortcuts') renderShortcutsSection(content);
  else if (activeSection === 'dashboard') renderDashboardSection(content);
  else if (activeSection === 'quick-create') renderQuickCreateSection(content);
  else if (activeSection === 'calendar') renderCalendarSection(content);
  else if (activeSection === 'sources') renderSourcesSection(content);
  else if (activeSection === 'ai') renderAiSection(content);
  else if (activeSection === 'semantic') renderSemanticSection(content);
  else if (activeSection === 'pulse') renderPulseSection(content);
  else if (activeSection === 'chat') renderChatSection(content);
  else if (activeSection === 'sync') renderSyncSection(content);
  else if (activeSection === 'notifications') renderNotificationsSection(content);
  else if (activeSection === 'install') renderInstallSection(content);
  else if (activeSection === 'billing') renderBillingSection(content);
  else if (activeSection === 'about') renderAboutSection(content);
}

// Navigate to a section. On mobile this also enters the detail pane of the
// drill-down; on desktop the extra state is inert (both panes stay visible).
function goToSection(id) {
  activeSection = id;
  renderSettingsBody();
  setMobileDetail(true);
}

// Toggle the mobile drill-down between the section list and the detail pane.
function setMobileDetail(on) {
  modal?.querySelector('.yanta-settings-card')?.classList.toggle('is-detail', on);
}

// Filter the rail as the user types. Matches label + keywords.
function filterSettingsRail(query) {
  if (!modal) return;
  const q = query.trim().toLowerCase();
  let visible = 0;

  for (const btn of modal.querySelectorAll('.yanta-settings-rail-btn')) {
    const match = !q || (btn.dataset.search || '').includes(q);
    btn.hidden = !match;
    if (match) visible += 1;
  }

  const empty = modal.querySelector('.yanta-settings-rail-empty');
  if (empty) empty.hidden = visible > 0;
}

// ---- Notifications section ----
function renderNotificationsSection(host) {
  host.append(sectionHeader(
    t('settings.sections.notifications.title'),
    t('settings.sections.notifications.subtitle'),
  ));

  host.append(notificationsSettingsElement());
}

// ---- Pulse section ----
function renderPulseSection(host) {
  host.append(sectionHeader(
    t('pulse.settings.title'),
    t('pulse.settings.subtitle'),
  ));

  host.append(pulseSettingsElement());
}

// ---- Install app section ----
function renderInstallSection(host) {
  host.append(sectionHeader(
    t('settings.sections.install.title'),
    t('settings.sections.install.subtitle'),
  ));

  host.append(installCardElement());
}

// ---- Language section ----
function renderLanguageSection(host) {
  host.append(sectionHeader(t('settings.language.title'), t('settings.language.subtitle')));

  // 'system' follows browser detection; an explicit code pins the choice.
  const current = hasExplicitLocale() ? getLocale() : 'system';

  host.append(renderSettingsSelect({
    label: t('settings.language.label'),
    hint: t('settings.language.hint'),
    value: current,
    options: [
      { value: 'system', label: t('settings.language.matchSystem') },
      ...LOCALES.map((l) => ({ value: l.code, label: l.native })),
    ],
    onChange: (val) => {
      const changed = val === 'system' ? (clearLocale(), true) : setLocale(val);
      if (!changed && val !== 'system') return;

      // No reactive framework re-renders the already-built views, so we reload
      // — the choice is persisted and initI18n() applies it on next boot. This
      // is the same soft-reload UX Apple/Google apps use for a language change.
      toast(t('settings.language.changed'), 'success');
      setTimeout(() => location.reload(), 400);
    },
  }));
}

// ---- Appearance section ----
function renderAppearanceSection(host) {
  const a = getAppearance();

  host.append(sectionHeader(t('settings.sections.appearance.title'), t('settings.sections.appearance.subtitle')));

  // Mode picker
  const modeGroup = el('div', { class: 'yanta-settings-group' });
  modeGroup.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.appearance.theme')));

  const modes = [
    { id: 'auto', key: 'auto' },
    { id: 'dark', key: 'dark' },
    { id: 'light', key: 'light' },
    { id: 'system-colors', key: 'systemColors' },
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
      <div class="yanta-settings-mode-label">${t(`settings.appearance.modes.${m.key}.label`)}</div>
      <div class="yanta-settings-mode-hint">${t(`settings.appearance.modes.${m.key}.hint`)}</div>
    `;
    modeRow.append(card);
  }
  modeGroup.append(modeRow);
  host.append(modeGroup);

  // Device-only toggle for appearance
  host.append(renderDeviceOnlyToggle(a));

  // Quick reset
  const reset = el('div', { class: 'yanta-settings-group' });
  reset.append(el('div', { class: 'yanta-settings-group-title' }, t('common.reset')));
  reset.append(el('button', {
    class: 'btn',
    onclick: async () => {
      const ok = await yantaConfirm({
        title: t('settings.appearance.resetConfirmTitle'),
        message: t('settings.appearance.resetConfirmMessage'),
        confirmLabel: t('settings.appearance.resetConfirmAction'),
        danger: true,
      });

      if (!ok) return;
      appearance = deepMerge(DEFAULT_APPEARANCE, { deviceOnly: a.deviceOnly });
      await saveAppearance({}, { reason: 'reset' });
      renderSettingsBody();
      toast(t('settings.appearance.resetToast'), 'success');
    },
  }, t('settings.appearance.resetButton')));
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

  toast(t('settings.colors.presetApplied', { name: preset.name, mode: t(`settings.colors.modeNoun.${mode}`) }), 'success');
  rerenderSettingsBody();
}

function renderColorPresetPicker(targetMode, appearanceSettings) {
  const presets = COLOR_PRESETS[targetMode] || [];

  const group = el('div', { class: 'yanta-settings-group yanta-settings-presets-group' });

  group.append(
    el('div', { class: 'yanta-settings-group-title' }, t('settings.colors.presets')),
    el('p', { class: 'yanta-settings-hint' },
      t('settings.colors.presetsHint', { mode: t(`settings.colors.modeNoun.${targetMode}`) })
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

  host.append(sectionHeader(t('settings.sections.colors.title'), t('settings.sections.colors.subtitle')));

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
    }, m === 'dark' ? t('settings.colors.tabDark') : t('settings.colors.tabLight')));
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
    groupEl.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.data.colorGroups.' + groupName)));

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
      meta.append(el('div', { class: 'yanta-settings-color-label' }, t('settings.data.colorLabels.' + tok.key)));

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
        toast(t('settings.colors.resetToast', { mode: t(`settings.colors.modeNoun.${targetMode}`) }), 'success');
      },
    }, t('settings.colors.resetButton', { mode: t(`settings.colors.modeNoun.${targetMode}`) }))
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

  host.append(sectionHeader(t('settings.sections.typography.title'), t('settings.sections.typography.subtitle')));

  // Body font
  const fontGroup = el('div', { class: 'yanta-settings-group' });
  fontGroup.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.typography.bodyFont')));
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
      <div class="yanta-settings-font-sample">${t('settings.typography.bodySample')}</div>
    `;
    fontGrid.append(card);
  }
  fontGroup.append(fontGrid);
  host.append(fontGroup);

  // Mono font
  const monoGroup = el('div', { class: 'yanta-settings-group' });
  monoGroup.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.typography.monoFont')));
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
  sizeGroup.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.typography.fontSize')));
  const sizeRow = el('div', { class: 'yanta-settings-size-row' });
  for (const s of FONT_SIZES) {
    sizeRow.append(el('button', {
      class: 'yanta-settings-size-btn' + (a.fontSizeId === s.id ? ' active' : ''),
onclick: async () => {
  await saveAppearance({ fontSizeId: s.id });
  rerenderSettingsBody();
},
    }, `${t('settings.data.fontSizes.' + s.id)} (${s.px}px)`));
  }
  sizeGroup.append(sizeRow);
  host.append(sizeGroup);

  // Line height
  const lhGroup = el('div', { class: 'yanta-settings-group' });
  lhGroup.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.typography.lineHeight')));
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

// ---- Shortcuts section ----
function renderShortcutsSection(host) {
  host.append(sectionHeader(
    t('settings.sections.shortcuts.title'),
    t('settings.sections.shortcuts.subtitle'),
  ));

  host.append(editorShortcutsSettingsElement());
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
    t('settings.sections.quickCreate.title'),
    t('settings.sections.quickCreate.subtitle'),
  ));

  const settings = getFloatingCreateSettings();

  host.append(renderQuickCreateIconGroup(settings));
  host.append(renderQuickCreateActionsGroup(settings));
  host.append(renderQuickCreateLayoutEditor(settings));

  const resetGroup = el('div', { class: 'yanta-settings-group' });
  resetGroup.append(el('div', { class: 'yanta-settings-group-title' }, t('common.reset')));

  resetGroup.append(
    el('button', {
      class: 'btn',
      onclick: () => {
        resetFloatingCreateSettings();
        toast(t('settings.quickCreate.resetToast'), 'success');
        renderSettingsBody();
      },
    }, t('settings.quickCreate.resetButton'))
  );

  host.append(resetGroup);
}

function renderQuickCreateIconGroup(settings) {
  const group = el('div', { class: 'yanta-settings-group' });

  group.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.quickCreate.triggerIcon')));
  group.append(el('p', { class: 'yanta-settings-hint' },
    t('settings.quickCreate.triggerIconHint')
  ));

  const choices = el('div', { class: 'yanta-qc-icon-choices' });

  for (const { id, label } of FLOATING_CREATE_ICON_OPTIONS) {
    const selected = settings.iconStyle === id;

    const choice = el('button', {
      type: 'button',
      class: 'yanta-qc-icon-choice' + (selected ? ' active' : ''),
      title: label,
      'aria-pressed': selected ? 'true' : 'false',
      onclick: () => {
        if (settings.iconStyle === id) return;

        persistQuickCreateSettings(
          { ...cloneQuickCreateSettings(settings), iconStyle: id },
          { toastMessage: t('settings.quickCreate.triggerIconUpdated') }
        );

        refreshQuickCreateRailIcon();
      },
    });

    const preview = el('span', { class: 'yanta-qc-icon-preview' });
    preview.innerHTML = floatingCreateIconPreview(id);

    choice.append(preview, el('span', { class: 'yanta-qc-icon-choice-label' }, label));
    choices.append(choice);
  }

  group.append(choices);

  return group;
}

function renderQuickCreateActionsGroup(settings) {
  const group = el('div', { class: 'yanta-settings-group yanta-qc-settings-actions' });

  group.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.quickCreate.actions')));

  const enabled = enabledQuickCreateActions(settings);

  if (!enabled.length) {
    group.append(el('div', { class: 'tree-empty' }, t('settings.quickCreate.noActions')));
  }

  for (const action of enabled) {
    group.append(renderQuickCreateActionRow(settings, action));
  }

  const disabled = disabledQuickCreateCatalogItems(settings);

  if (disabled.length) {
    group.append(el('div', { class: 'yanta-qc-settings-add-title' }, t('settings.quickCreate.addAction')));

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
            toastMessage: t('settings.quickCreate.actionAdded'),
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
    title: t('settings.quickCreate.chooseIcon'),
    onclick: async () => {
      const { openIconPicker } = await import('./icon-picker.js');

      openIconPicker({
        title: t('settings.quickCreate.iconForLabel', { label }),
        initialIcon: action.icon || cat?.defaultIcon || 'circle',
        initialColor: '#6ea8fe',
        allowReset: false,
        applyLabel: t('common.apply'),
        onApply: ({ icon }) => {
          if (!icon) return;

          const next = cloneQuickCreateSettings(settings);
          const a = quickCreateActionById(next, action.id);
          if (!a) return;

          a.icon = icon;

          persistQuickCreateSettings(next, {
            toastMessage: t('settings.quickCreate.iconUpdated'),
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
    title: t('settings.quickCreate.actionLabelField'),
  });

  labelInput.addEventListener('change', () => {
    const next = cloneQuickCreateSettings(settings);
    const a = quickCreateActionById(next, action.id);
    if (!a) return;

    a.label = labelInput.value.trim() || cat?.defaultLabel || action.id;

    persistQuickCreateSettings(next, {
      rerender: false,
      toastMessage: t('settings.quickCreate.labelSaved'),
    });
  });

  const moveUp = el('button', {
    type: 'button',
    class: 'icon-btn',
    title: t('settings.quickCreate.moveUp'),
    onclick: () => {
      moveQuickCreateAction(settings, action.id, -1);
    },
  });

  moveUp.innerHTML = lucide('chevron-up', 15);

  const moveDown = el('button', {
    type: 'button',
    class: 'icon-btn',
    title: t('settings.quickCreate.moveDown'),
    onclick: () => {
      moveQuickCreateAction(settings, action.id, 1);
    },
  });

  moveDown.innerHTML = lucide('chevron-down', 15);

  const remove = el('button', {
    type: 'button',
    class: 'icon-btn danger',
    title: t('settings.quickCreate.removeAction'),
    onclick: () => {
      const next = cloneQuickCreateSettings(settings);
      const a = quickCreateActionById(next, action.id);
      if (!a) return;

      a.enabled = false;

      persistQuickCreateSettings(next, {
        toastMessage: t('settings.quickCreate.actionRemoved'),
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
    toastMessage: t('settings.quickCreate.orderUpdated'),
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

  group.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.quickCreate.bubbleLayout')));

  const hint = el('p', { class: 'yanta-settings-hint' },
    t('settings.quickCreate.bubbleLayoutHint', { distance: FLOATING_CREATE_MIN_DISTANCE })
  );

  group.append(hint);

  const toolbar = el('div', { class: 'yanta-qc-layout-toolbar' });

  const activeLabel = el('span', { class: 'yanta-qc-layout-active-label' }, t('settings.quickCreate.dragBubble'));

  toolbar.append(activeLabel);
  group.append(toolbar);

  const stage = el('div', { class: 'yanta-qc-layout-stage' });

  function renderStage() {
    stage.replaceChildren();

    const origin = el('div', {
      class: 'yanta-qc-layout-origin',
      title: t('settings.quickCreate.quickActionsButton'),
    });

    origin.innerHTML = floatingCreateIconPreview(working.iconStyle);
    stage.append(origin);

    const enabled = enabledQuickCreateActions(working);

    if (!enabled.length) {
      const empty = el('div', { class: 'yanta-qc-layout-empty' }, t('settings.quickCreate.enableFirst'));
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

        const label = quickCreateActionById(working, activeId)?.label || t('settings.quickCreate.bubbleFallback');
        activeLabel.textContent = t('settings.quickCreate.dragging', { label });

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
          activeLabel.textContent = t('settings.quickCreate.layoutSaved');

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
          activeLabel.textContent = t('settings.quickCreate.dragBubble');

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
        activeLabel.textContent = t('settings.quickCreate.reloadedLayout');
      },
    }, t('settings.quickCreate.reloadLayout')),

    el('button', {
      class: 'btn',
      onclick: () => {
        resetFloatingCreateSettings();
        toast(t('settings.quickCreate.layoutReset'), 'success');
        renderSettingsBody();
      },
    }, t('settings.quickCreate.resetLayout'))
  );

  group.append(actions);

  return group;
}

// ---- Dashboard section ----
function renderDashboardSection(host) {
  host.replaceChildren();

  host.append(sectionHeader(
    t('settings.sections.dashboard.title'),
    t('settings.sections.dashboard.subtitle'),
  ));

  const prefs = getDashboardCardDisplayPrefs();

  const group = el('div', { class: 'yanta-settings-group' });

  group.append(
    el('div', { class: 'yanta-settings-group-title' }, t('settings.dashboard.cardLabels'))
  );

  group.append(
    renderDashboardToggle({
      checked: !!prefs.notesShowHeader,
      label: t('settings.dashboard.showNoteHeader'),
      hint: t('settings.dashboard.showNoteHeaderHint'),
      onChange: async (checked) => {
        await setDashboardCardDisplayPrefs({
          notesShowHeader: checked,
        });

        toast(t('settings.dashboard.saved'), 'success');
      },
    }),

    renderDashboardToggle({
      checked: !!prefs.foldersShowHeader,
      label: t('settings.dashboard.showFolderHeader'),
      hint: t('settings.dashboard.showFolderHeaderHint'),
      onChange: async (checked) => {
        await setDashboardCardDisplayPrefs({
          foldersShowHeader: checked,
        });

        toast(t('settings.dashboard.saved'), 'success');
      },
    }),
  );

  // Wichtig: Card labels zuerst anhängen.
  host.append(group);

  const eventGroup = el('div', { class: 'yanta-settings-group' });

  eventGroup.append(
    el('div', { class: 'yanta-settings-group-title' }, t('settings.dashboard.linkedEventCard'))
  );

  eventGroup.append(
    renderDashboardToggle({
      checked: prefs.linkedEventShow !== false,
      label: t('settings.dashboard.showLinkedEvent'),
      hint: t('settings.dashboard.showLinkedEventHint'),
      onChange: async (checked) => {
        await setDashboardCardDisplayPrefs({
          linkedEventShow: checked,
        });

        toast(t('settings.dashboard.saved'), 'success');
        renderSettingsBody();
      },
    })
  );

  const fieldPrefs = prefs.linkedEventFields || {};

  const fields = ['icon', 'title', 'time', 'location', 'description'];

  for (const key of fields) {
    eventGroup.append(
      renderDashboardToggle({
        checked: fieldPrefs[key] !== false,
        label: t(`settings.dashboard.fields.${key}.label`),
        hint: t(`settings.dashboard.fields.${key}.hint`),
        onChange: async (checked) => {
          const current = getDashboardCardDisplayPrefs();

          await setDashboardCardDisplayPrefs({
            linkedEventFields: {
              ...(current.linkedEventFields || {}),
              [key]: checked,
            },
          });

          toast(t('settings.dashboard.saved'), 'success');
        },
      })
    );
  }

  // Danach Linked event card.
  host.append(eventGroup);

  const info = el('div', { class: 'yanta-settings-info' });

  info.append(
    el('p', {},
      el('strong', {}, t('settings.dashboard.info.renameTitle')),
      ' ' + t('settings.dashboard.info.renameBody'),
    ),
    el('p', {}, t('settings.dashboard.info.line2')),
  );

  host.append(info);
}

function renderCalendarSection(host) {
  host.replaceChildren();

  const prefs = getCalendarPreferences();

  host.append(sectionHeader(
    t('settings.sections.calendar.title'),
    t('settings.sections.calendar.subtitle'),
  ));

  const group = el('div', { class: 'yanta-settings-group' });
  group.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.calendar.regionalFormat')));

  group.append(
    renderSettingsSelect({
      label: t('settings.calendar.localeLabel'),
      hint: t('settings.calendar.localeHint'),
      value: prefs.locale,
      options: CALENDAR_LOCALES.map((x) => ({
        value: x.id,
        // Language names stay as autonyms (Deutsch, Français…); only 'Auto' translates.
        label: x.id === 'auto' ? t('settings.data.calLocaleAuto') : x.label,
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ locale: value });
        toast(t('settings.calendar.saved'), 'success');
        renderSettingsBody();
      },
    }),

    renderSettingsSelect({
      label: t('settings.calendar.dateFormatLabel'),
      hint: t('settings.calendar.dateFormatHint'),
      value: prefs.dateFormat,
      options: CALENDAR_DATE_FORMATS.map((x) => ({
        value: x.id,
        label: `${x.label} · ${x.example}`,
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ dateFormat: value });
        toast(t('settings.calendar.saved'), 'success');
        renderSettingsBody();
      },
    }),

    renderSettingsSelect({
      label: t('settings.calendar.editorPreviewLabel'),
      hint: t('settings.calendar.editorPreviewHint'),
      value: prefs.editorDateStyle,
      options: CALENDAR_EDITOR_DATE_STYLES.map((x) => ({
        value: x.id,
        label: `${t('settings.data.calEditorStyle.' + x.id)} · ${x.exampleDe}`,
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ editorDateStyle: value });
        toast(t('settings.calendar.saved'), 'success');
        renderSettingsBody();
      },
    }),

    renderSettingsSelect({
      label: t('settings.calendar.timeFormatLabel'),
      hint: t('settings.calendar.timeFormatHint'),
      value: prefs.timeFormat,
      options: CALENDAR_TIME_FORMATS.map((x) => ({
        value: x.id,
        label: `${t(x.id === '24' ? 'settings.data.calTime24' : 'settings.data.calTime12')} · ${x.example}`,
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ timeFormat: value });
        toast(t('settings.calendar.saved'), 'success');
        renderSettingsBody();
      },
    })
  );

  host.append(group);

  const weekGroup = el('div', { class: 'yanta-settings-group' });
  weekGroup.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.calendar.weeks')));

  weekGroup.append(
    renderSettingsSelect({
      label: t('settings.calendar.weekStartLabel'),
      hint: t('settings.calendar.weekStartHint'),
      value: String(prefs.weekStart),
      options: CALENDAR_WEEK_STARTS.map((x) => ({
        value: String(x.id),
        label: t('settings.data.calWeekday.' + ({ 1: 'mon', 0: 'sun', 6: 'sat' }[x.id] || 'mon')),
      })),
      onChange: async (value) => {
        await saveCalendarPreferences({ weekStart: Number(value) });
        toast(t('settings.calendar.saved'), 'success');
        renderSettingsBody();
      },
    }),

    renderCalendarToggle({
      checked: !!prefs.weekNumbers,
      label: t('settings.calendar.weekNumbersLabel'),
      hint: t('settings.calendar.weekNumbersHint'),
      onChange: async (checked) => {
        await saveCalendarPreferences({ weekNumbers: checked });
        toast(t('settings.calendar.saved'), 'success');
        renderSettingsBody();
      },
    })
  );

  host.append(weekGroup);

  const resetGroup = el('div', { class: 'yanta-settings-group' });
  resetGroup.append(el('div', { class: 'yanta-settings-group-title' }, t('common.reset')));

  resetGroup.append(el('button', {
    class: 'btn',
    onclick: async () => {
      const ok = await yantaConfirm({
        title: t('settings.calendar.resetConfirmTitle'),
        message: t('settings.calendar.resetConfirmMessage'),
        confirmLabel: t('settings.calendar.resetConfirmAction'),
        danger: true,
      });

      if (!ok) return;

      await resetCalendarPreferences();
      toast(t('settings.calendar.resetToast'), 'success');
      renderSettingsBody();
    },
  }, t('settings.calendar.resetButton')));

  host.append(resetGroup);
}

function renderSourcesSection(host) {
  host.replaceChildren();

  host.append(sectionHeader(
    t('settings.sections.sources.title'),
    t('settings.sections.sources.subtitle'),
  ));

  const info = el('div', { class: 'yanta-settings-info' });
  info.append(
    el('p', {},
      el('strong', {}, t('settings.sources.infoTitle')),
      ' ' + t('settings.sources.infoBody'),
    ),
    el('p', {}, t('settings.sources.infoLine2')),
  );
  host.append(info);

  const mount = el('div', {
    class: 'yanta-settings-group',
  });

  mount.append(el('div', { class: 'tree-empty' }, t('settings.sources.loading')));
  host.append(mount);

  import('./rss/rss-settings-panel.js')
    .then(({ renderRssSettingsPanel }) => {
      if (!mount.isConnected) return;
      renderRssSettingsPanel(mount);
    })
    .catch((err) => {
      console.error('[YANTA Settings] Could not load Sources settings', err);
      mount.replaceChildren(el('div', { class: 'yanta-settings-info' }, t('settings.sources.loadError')));
    });
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

function renderAiSection(host) {
  host.replaceChildren();

  host.append(sectionHeader(
    t('settings.sections.ai.title'),
    t('settings.sections.ai.subtitle'),
  ));

  const info = el('div', { class: 'yanta-settings-info' });
  info.append(
    el('p', {}, el('strong', {}, t('settings.ai.infoTitle')), ' ' + t('settings.ai.infoBody')),
    el('p', {}, t('settings.ai.infoLine2')),
  );
  host.append(info);

  const mount = el('div', {
    class: 'yanta-settings-group yanta-ai-main-settings-mirror',
  });

  mount.append(el('div', { class: 'tree-empty', style: 'display:block;padding:14px' }, t('settings.ai.loading')));

  host.append(mount);

  import('./ai/ai-settings-panel.js')
    .then(({ renderAiSettingsPanel }) => {
      if (!mount.isConnected) return;
      renderAiSettingsPanel(mount);
    })
    .catch((err) => {
      console.error('[YANTA Settings] Could not load AI settings panel', err);

      mount.replaceChildren(el('div', { class: 'yanta-settings-info' }, t('settings.ai.loadError')));
    });
}

function renderSemanticSection(host) {
  host.append(sectionHeader(
    t('settings.sections.semantic.title'),
    t('settings.sections.semantic.subtitle'),
  ));

  const mount = el('div', { class: 'yanta-settings-group' });

  mount.append(el('div', { class: 'tree-empty', style: 'display:block;padding:14px' }, t('settings.semantic.loading')));

  host.append(mount);

  import('./semantic/semantic-settings-ui.js')
    .then(({ renderSemanticSettingsPanel }) => {
      if (!mount.isConnected) return;
      renderSemanticSettingsPanel(mount);
    })
    .catch((err) => {
      console.error('[YANTA Settings] Could not load semantic settings panel', err);

      mount.replaceChildren(el('div', { class: 'yanta-settings-info' }, t('settings.semantic.loadError')));
    });
}

async function renderChatSection(host) {
  host.replaceChildren();

  host.append(sectionHeader(
    t('settings.sections.chat.title'),
    t('settings.sections.chat.subtitle'),
  ));

  const loading = el('div', {
    class: 'yanta-settings-group',
  });

  loading.innerHTML = `
    <div class="yanta-settings-info">
      <p><strong>${t('settings.chat.loading')}</strong></p>
    </div>
  `;

  host.append(loading);

  try {
    const [
      prefsMod,
      cacheMod,
      cryptoMod,
      sessionMod,
      storeMod,
    ] = await Promise.all([
      import('./chat/chat-preferences.js'),
      import('./chat/chat-media-cache.js'),
      import('./chat/matrix-crypto.js'),
      import('./chat/matrix-session.js'),
      import('./chat/chat-store.js'),
    ]);

    const prefs = await prefsMod.getChatPreferences();
    const usage = await cacheMod.getChatMediaCacheUsage();
    const limit = await cacheMod.getChatMediaCacheLimitBytes();
    const session = sessionMod.getChatSession?.();
    const client = session?.client || window.yantaMatrixClient || null;

    host.replaceChildren();

    host.append(sectionHeader(
      t('settings.sections.chat.title'),
      t('settings.sections.chat.subtitle'),
    ));

    host.append(renderChatConnectionCard({
      client,
      session,
      sessionMod,
    }));

    host.append(renderChatPreferencesCard({
      prefs,
      prefsMod,
    }));

    host.append(renderChatStorageCard({
      usage,
      limit,
      cacheMod,
    }));

    host.append(renderChatRecoveryCard({
      cryptoMod,
    }));

    host.append(renderChatDeviceCard({
      client,
      sessionMod,
      storeMod,
    }));
  } catch (err) {
    console.warn('[YANTA Settings] Could not render Chat settings', err);
    toast(t('settings.chat.loadError'), 'error');

    loading.innerHTML = `
      <div class="yanta-settings-info">
        <p><strong>${t('settings.chat.loadError')}</strong></p>
        <p>${escapeSettingsText(err?.message || String(err))}</p>
      </div>
    `;
  }
}

function escapeSettingsText(value = '') {
  const div = document.createElement('div');
  div.textContent = String(value || '');
  return div.innerHTML;
}

function renderChatConnectionCard({
  client,
  session,
  sessionMod,
}) {
  const group = el('div', {
    class: 'yanta-settings-group',
  });

  const userId = client?.getUserId?.() || session?.credentials?.userId || '';

  group.innerHTML = `
    <div class="yanta-sync-card">
      <div class="yanta-sync-card-head">
        <div class="yanta-sync-card-icon">
          ${lucide(client ? 'message-circle-check' : 'message-circle-warning', 22)}
        </div>

        <div class="yanta-sync-card-title">
          <strong>${t('settings.chat.connection.title')}</strong>
          <p>
            ${
              client
                ? t('settings.chat.connection.connectedAs', { user: `<code>${escapeSettingsText(userId)}</code>` })
                : t('settings.chat.connection.notConnected')
            }
          </p>
        </div>
      </div>

      <div class="compress-actions yanta-sync-card-actions">
        <button class="btn primary" data-chat-reconnect>
          ${lucide('refresh-cw', 14)}
          ${client ? t('settings.chat.connection.reconnect') : t('settings.chat.connection.connect')}
        </button>
      </div>
    </div>
  `;

  group.querySelector('[data-chat-reconnect]')?.addEventListener('click', async () => {
    try {
      await sessionMod.stopChatSession?.({
        silent: true,
      });

      await sessionMod.startChatSession?.({
        forceLogin: true,
        reason: 'settings-chat-reconnect',
      });

      toast(t('settings.chat.connection.reconnectedToast'), 'success');
      renderSettingsBody();
    } catch (err) {
      console.warn('[YANTA Settings] Chat reconnect failed', err);
      toast(t('settings.chat.connection.reconnectError'), 'error');
    }
  });

  return group;
}

function renderChatPreferencesCard({
  prefs,
  prefsMod,
}) {
  const group = el('div', {
    class: 'yanta-settings-group',
  });

  group.append(
    el('div', {
      class: 'yanta-settings-group-title',
    }, t('settings.chat.prefs.messaging'))
  );

  group.append(
    renderSettingsToggleRow({
      checked: prefs.sendReadReceipts !== false,
      label: t('settings.chat.prefs.readReceipts'),
      hint: t('settings.chat.prefs.readReceiptsHint'),
      onChange: async (checked) => {
        await prefsMod.setChatPreferences({
          sendReadReceipts: checked,
        });

        toast(t('settings.chat.prefs.saved'), 'success');
      },
    }),

    renderSettingsSelect({
      label: t('settings.chat.prefs.enterBehavior'),
      hint: t('settings.chat.prefs.enterBehaviorHint'),
      value: prefs.enterBehavior || 'send',
      options: [
        {
          value: 'send',
          label: t('settings.chat.prefs.enterSends'),
        },
        {
          value: 'newline',
          label: t('settings.chat.prefs.enterNewline'),
        },
      ],
      onChange: async (value) => {
        await prefsMod.setChatPreferences({
          enterBehavior: value,
        });

        toast(t('settings.chat.prefs.saved'), 'success');
      },
    }),

    renderSettingsSelect({
      label: t('settings.chat.prefs.mediaAutoDownload'),
      hint: t('settings.chat.prefs.mediaAutoDownloadHint'),
      value: prefs.mediaAutoDownload || 'ask',
      options: [
        {
          value: 'always',
          label: t('settings.chat.prefs.always'),
        },
        {
          value: 'ask',
          label: t('settings.chat.prefs.onDemand'),
        },
      ],
      onChange: async (value) => {
        await prefsMod.setChatPreferences({
          mediaAutoDownload: value,
        });

        toast(t('settings.chat.prefs.saved'), 'success');
      },
    })
  );

  return group;
}

function renderChatStorageCard({
  usage,
  limit,
  cacheMod,
}) {
  const group = el('div', {
    class: 'yanta-settings-group',
  });

  const pct = limit > 0
    ? Math.max(0, Math.min(100, Math.round((usage.totalBytes / limit) * 100)))
    : 0;

  group.innerHTML = `
    <div class="yanta-sync-card">
      <div class="yanta-sync-card-head">
        <div class="yanta-sync-card-icon secondary">
          ${lucide('database', 22)}
        </div>

        <div class="yanta-sync-card-title">
          <strong>${t('settings.chat.storage.title')}</strong>
          <p>
            ${t('settings.chat.storage.cacheUsage', {
              size: `<strong>${fmtBytes(usage.totalBytes || 0)}</strong>`,
              items: t('settings.chat.storage.itemsCount', { count: Number(usage.count || 0) }),
            })}
          </p>
        </div>
      </div>

      <div class="yanta-chat-settings-mini-meter">
        <span style="width:${pct}%"></span>
      </div>

      <div class="yanta-chat-settings-row">
        <label>
          ${t('settings.chat.storage.cacheLimit')}
          <select class="text-input" data-chat-cache-limit>
            ${cacheMod.CHAT_MEDIA_CACHE_LIMITS.map((option) => `
              <option value="${option.bytes}" ${Number(option.bytes) === Number(limit) ? 'selected' : ''}>
                ${escapeSettingsText(option.label)}
              </option>
            `).join('')}
          </select>
        </label>
      </div>

      <div class="compress-actions yanta-sync-card-actions">
        <button class="btn danger" data-chat-cache-clear>
          ${lucide('trash', 14)}
          ${t('settings.chat.storage.clearCache')}
        </button>
      </div>
    </div>
  `;

  group.querySelector('[data-chat-cache-limit]')?.addEventListener('change', async (e) => {
    try {
      await cacheMod.setChatMediaCacheLimitBytes(Number(e.currentTarget.value || 0));
      await updateStorageMeter();

      toast(t('settings.chat.storage.limitSaved'), 'success');
      renderSettingsBody();
    } catch (err) {
      console.warn('[YANTA Settings] Could not save media cache limit', err);
      toast(t('settings.chat.storage.limitError'), 'error');
    }
  });

  group.querySelector('[data-chat-cache-clear]')?.addEventListener('click', async () => {
    const ok = await yantaConfirm({
      title: t('settings.chat.storage.clearConfirmTitle'),
      message: t('settings.chat.storage.clearConfirmMessage'),
      confirmLabel: t('settings.chat.storage.clearConfirmAction'),
      danger: true,
      icon: 'trash',
    });

    if (!ok) return;

    try {
      const result = await cacheMod.purgeAllChatMediaCache();

      await updateStorageMeter();

      toast(t('settings.chat.storage.cleared', { size: fmtBytes(result.bytes || 0) }), 'success');
      renderSettingsBody();
    } catch (err) {
      console.warn('[YANTA Settings] Could not clear media cache', err);
      toast(t('settings.chat.storage.clearError'), 'error');
    }
  });

  return group;
}

function renderChatRecoveryCard({
  cryptoMod,
}) {
  const group = el('div', {
    class: 'yanta-settings-group',
  });

  group.innerHTML = `
    <div class="yanta-sync-card">
      <div class="yanta-sync-card-head">
        <div class="yanta-sync-card-icon secondary">
          ${lucide('key-round', 22)}
        </div>

        <div class="yanta-sync-card-title">
          <strong>${t('settings.chat.recovery.title')}</strong>
          <p>${t('settings.chat.recovery.desc')}</p>
        </div>
      </div>

      <div class="compress-actions yanta-sync-card-actions">
        <button class="btn" data-chat-show-recovery>
          ${lucide('eye', 14)}
          ${t('settings.chat.recovery.showButton')}
        </button>
      </div>
    </div>
  `;

  group.querySelector('[data-chat-show-recovery]')?.addEventListener('click', async () => {
    const ok = await yantaConfirm({
      title: t('settings.chat.recovery.confirmTitle'),
      message: t('settings.chat.recovery.confirmMessage'),
      confirmLabel: t('settings.chat.recovery.confirmAction'),
      danger: true,
      icon: 'key-round',
    });

    if (!ok) return;

    try {
      const recovery = await cryptoMod.readChatRecoveryKeyTextForDisplay();

      const overlay = el('div', {
        class: 'modal',
      });

      overlay.innerHTML = `
        <div class="modal-card" style="width:min(620px,94vw)">
          <header class="modal-head">
            <h3>${t('settings.chat.recovery.modalTitle')}</h3>
            <button class="icon-btn" data-close>${lucide('x', 18)}</button>
          </header>

          <div style="padding:16px">
            <p class="yanta-settings-hint">
              ${t('settings.chat.recovery.modalHint')}
            </p>

            <pre style="
              white-space:pre-wrap;
              word-break:break-word;
              padding:12px;
              border:1px solid var(--border);
              border-radius:12px;
              background:var(--bg);
              color:var(--text);
              font-family:var(--font-mono);
              font-size:12px;
              max-height:260px;
              overflow:auto;
            ">${escapeSettingsText(recovery.text)}</pre>

            <div class="compress-actions" style="margin-top:12px">
              <button class="btn primary" data-copy>${lucide('copy', 14)} ${t('settings.chat.recovery.copyKey')}</button>
              <button class="btn" data-close>${t('common.done')}</button>
            </div>
          </div>
        </div>
      `;

      overlay.addEventListener('click', async (e) => {
        if (e.target === overlay || e.target.closest?.('[data-close]')) {
          overlay.remove();
          return;
        }

        if (e.target.closest?.('[data-copy]')) {
          try {
            await navigator.clipboard.writeText(recovery.text);
            toast(t('settings.chat.recovery.copiedToast'), 'success');
          } catch (err) {
            console.warn('[YANTA Settings] Could not copy recovery key', err);
            toast(t('settings.chat.recovery.copyError'), 'error');
          }
        }
      });

      document.body.append(overlay);
    } catch (err) {
      console.warn('[YANTA Settings] Could not show recovery key', err);
      toast(t('settings.chat.recovery.showError'), 'error');
    }
  });

  return group;
}

function renderChatDeviceCard({
  client,
  sessionMod,
  storeMod,
}) {
  const group = el('div', {
    class: 'yanta-settings-group',
  });

  group.innerHTML = `
    <div class="yanta-sync-card">
      <div class="yanta-sync-card-head">
        <div class="yanta-sync-card-icon secondary">
          ${lucide('smartphone', 22)}
        </div>

        <div class="yanta-sync-card-title">
          <strong>${t('settings.chat.device.title')}</strong>
          <p>${t('settings.chat.device.desc')}</p>
        </div>
      </div>

      <div class="compress-actions yanta-sync-card-actions">
        <button class="btn danger" data-chat-deprovision>
          ${lucide('log-out', 14)}
          ${t('settings.chat.device.deprovisionButton')}
        </button>
      </div>
    </div>
  `;

  group.querySelector('[data-chat-deprovision]')?.addEventListener('click', async () => {
    const ok = await yantaConfirm({
      title: t('settings.chat.device.confirmTitle'),
      message: t('settings.chat.device.confirmMessage'),
      confirmLabel: t('settings.chat.device.confirmAction'),
      danger: true,
      icon: 'log-out',
    });

    if (!ok) return;

    try {
      try {
        await client?.logout?.(true);
      } catch (err) {
        console.warn('[YANTA Settings] Matrix logout failed during deprovision', err);
        toast(t('settings.chat.device.logoutFailed'), 'error');
      }

      await sessionMod.stopChatSession?.({
        silent: true,
      });

      await storeMod.clearChatCredentials?.();
      await sessionMod.clearChatMatrixLocalStoresForDebugOnly?.();

      toast(t('settings.chat.device.deprovisionedToast'), 'success');
      renderSettingsBody();
    } catch (err) {
      console.warn('[YANTA Settings] Could not deprovision Chat', err);
      toast(t('settings.chat.device.deprovisionError'), 'error');
    }
  });

  return group;
}

function renderSettingsToggleRow({
  checked,
  label,
  hint,
  onChange,
}) {
  const row = el('label', {
    class: 'yanta-settings-toggle',
  });

  const cb = el('input', {
    type: 'checkbox',
  });

  cb.checked = !!checked;

  cb.addEventListener('change', async () => {
    try {
      await onChange?.(cb.checked);
    } catch (err) {
      console.warn('[YANTA Settings] Toggle change failed', err);
      toast(t('settings.saveError'), 'error');

      cb.checked = !cb.checked;
    }
  });

  row.append(
    cb,
    el('div', {
      class: 'yanta-settings-toggle-meta',
    },
      el('div', {
        class: 'yanta-settings-toggle-label',
      }, label),
      el('div', {
        class: 'yanta-settings-toggle-hint',
      }, hint),
    )
  );

  return row;
}

// ---- Sync section ----
function renderSyncSection(host) {
  host.replaceChildren();

  host.append(sectionHeader(
    t('settings.sections.sync.title'),
    t('settings.sections.sync.subtitle'),
  ));

  host.append(renderYantaCloudSyncPrimaryCard());
  host.append(renderEncryptedBackupCard());
  host.append(renderAdvancedSyncMethods());
}

// ---- Plan & Billing section ----
function renderBillingSection(host) {
  host.replaceChildren();

  host.append(sectionHeader(
    t('settings.sections.billing.title'),
    t('settings.sections.billing.subtitle'),
  ));

  host.append(renderYantaPlusBillingCard());
}

function renderYantaCloudSyncPrimaryCard() {
  const group = el('div', { class: 'yanta-settings-group yanta-sync-primary-card' });

  group.innerHTML = `
    <div class="yanta-sync-card yanta-sync-card-primary">
      <div class="yanta-sync-card-head">
        <div class="yanta-sync-card-icon">
          ${lucide('cloud', 24)}
        </div>

        <div class="yanta-sync-card-title">
          <span class="yanta-sync-card-kicker">${t('settings.sync.recommended')}</span>
          <strong>YANTA Cloud Sync</strong>
          <p>${t('settings.sync.cloudDesc')}</p>
        </div>
      </div>

      <div class="yanta-sync-card-points">
        <span>${lucide('check', 13)} ${t('settings.sync.cloudPoint1')}</span>
        <span>${lucide('check', 13)} ${t('settings.sync.cloudPoint2')}</span>
      </div>

      <div class="yanta-sync-status-line" data-yanta-cloud-sync-status>
        ${t('settings.sync.checkingStatus')}
      </div>

      <div class="compress-actions yanta-sync-card-actions">
        <button class="btn primary" data-yanta-cloud-open>
          ${lucide('cloud', 14)}
          ${t('settings.sync.setUpCloud')}
        </button>

        <button class="btn" data-yanta-cloud-sync-now hidden>
          ${lucide('refresh-cw', 14)}
          ${t('settings.sync.syncNow')}
        </button>
      </div>
    </div>
  `;

  const openBtn = group.querySelector('[data-yanta-cloud-open]');
  const syncNowBtn = group.querySelector('[data-yanta-cloud-sync-now]');
  const statusEl = group.querySelector('[data-yanta-cloud-sync-status]');

  openBtn?.addEventListener('click', async () => {
    closeSettings();

    const { openYantaCloudSetup } = await import('./sync2/yanta-cloud-setup-ui.js');
    await openYantaCloudSetup();
  });

  syncNowBtn?.addEventListener('click', async () => {
    try {
      statusEl.textContent = t('settings.sync.synchronizing');

      if (typeof window.yantaSync2Now === 'function') {
        await window.yantaSync2Now({
          interactive: true,
          catchUp: false,
        });
      } else {
        await window.yantaSync2?.syncNow?.({
          verbose: false,
          pullSnapshots: false,
        });
      }

      statusEl.textContent = t('settings.sync.syncComplete');
      toast(t('settings.sync.syncCompleteToast'), 'success');
    } catch (err) {
      statusEl.textContent = err?.message || t('settings.sync.syncFailed');
      toast(t('settings.sync.syncFailedToast'), 'error');
    }
  });

  updateYantaCloudSyncPrimaryCard(group).catch(() => {});

  return group;
}

async function updateYantaCloudSyncPrimaryCard(group) {
  const provider = await store.settings.get('sync2.provider', null).catch(() => null);
  const vaultId = await store.settings.get('sync2.yantaCloud.vaultId', '').catch(() => '');

  const statusEl = group.querySelector('[data-yanta-cloud-sync-status]');
  const openBtn = group.querySelector('[data-yanta-cloud-open]');
  const syncNowBtn = group.querySelector('[data-yanta-cloud-sync-now]');

  if (!statusEl || !openBtn || !syncNowBtn) return;

  if (provider === 'yanta-cloud' && vaultId) {
    statusEl.innerHTML = `
      <strong style="color:var(--green)">${t('settings.sync.activeLabel')}</strong>
      ${t('settings.sync.activeBody')}
    `;

    openBtn.innerHTML = `${lucide('settings', 14)} ${t('settings.sync.manageCloud')}`;
    syncNowBtn.hidden = false;
    return;
  }

  if (provider === 'google-drive') {
    statusEl.innerHTML = `
      <strong style="color:var(--yellow)">${t('settings.sync.gdriveActiveLabel')}</strong>
      ${t('settings.sync.gdriveActiveBody')}
    `;

    openBtn.innerHTML = `${lucide('cloud', 14)} ${t('settings.sync.setUpCloud')}`;
    syncNowBtn.hidden = true;
    return;
  }

  statusEl.innerHTML = `
    <strong>${t('settings.sync.noSyncLabel')}</strong>
    ${t('settings.sync.noSyncBody')}
  `;

  openBtn.innerHTML = `${lucide('cloud', 14)} ${t('settings.sync.setUpCloud')}`;
  syncNowBtn.hidden = true;
}

function yantaPlusPreferredPriceId() {
  const lang = navigator.language || '';
  const wantsEur =
    lang.startsWith('de') ||
    lang.startsWith('fr') ||
    lang.startsWith('es') ||
    lang.startsWith('it') ||
    lang.startsWith('nl') ||
    lang.startsWith('pt') ||
    lang.startsWith('fi') ||
    lang.startsWith('sv') ||
    lang.startsWith('da') ||
    lang.startsWith('pl') ||
    lang.startsWith('cs') ||
    lang.startsWith('sk') ||
    lang.startsWith('sl') ||
    lang.startsWith('et') ||
    lang.startsWith('lv') ||
    lang.startsWith('lt') ||
    lang.startsWith('el');

  if (wantsEur) {
    return (
      import.meta.env.VITE_PADDLE_PLUS_YEARLY_EUR_PRICE_ID ||
      import.meta.env.VITE_PADDLE_PLUS_MONTHLY_EUR_PRICE_ID ||
      import.meta.env.VITE_PADDLE_PLUS_YEARLY_USD_PRICE_ID ||
      import.meta.env.VITE_PADDLE_PLUS_MONTHLY_USD_PRICE_ID ||
      ''
    );
  }

  return (
    import.meta.env.VITE_PADDLE_PLUS_YEARLY_USD_PRICE_ID ||
    import.meta.env.VITE_PADDLE_PLUS_MONTHLY_USD_PRICE_ID ||
    import.meta.env.VITE_PADDLE_PLUS_YEARLY_EUR_PRICE_ID ||
    import.meta.env.VITE_PADDLE_PLUS_MONTHLY_EUR_PRICE_ID ||
    ''
  );
}

function renderYantaPlusBillingCard() {
  const group = el('div', { class: 'yanta-settings-group yanta-sync-billing-card' });

  group.innerHTML = `
    <div class="yanta-sync-card">
      <div class="yanta-sync-card-head">
        <div class="yanta-sync-card-icon secondary">
          ${lucide('sparkles', 22)}
        </div>

        <div class="yanta-sync-card-title">
          <strong>YANTA Plus</strong>
          <p>${t('settings.billing.plusDesc')}</p>
        </div>
      </div>

      <div class="yanta-sync-card-points">
        <span>${lucide('database', 13)} ${t('settings.billing.point1')}</span>
        <span>${lucide('smartphone', 13)} ${t('settings.billing.point2')}</span>
        <span>${lucide('bot', 13)} ${t('settings.billing.point3')}</span>
      </div>

      <div class="yanta-sync-status-line" data-yanta-plus-status>
        ${t('settings.billing.checkingStatus')}
      </div>

      <div class="compress-actions yanta-sync-card-actions">
        <button class="btn primary" data-yanta-plus-upgrade hidden>
          ${lucide('sparkles', 14)}
          ${t('settings.billing.upgrade')}
        </button>

        <button class="btn" data-yanta-plus-manage hidden>
          ${lucide('credit-card', 14)}
          ${t('settings.billing.manage')}
        </button>

        <a class="btn" href="/pricing" target="_blank" rel="noopener">
          ${lucide('external-link', 14)}
          ${t('settings.billing.pricing')}
        </a>
      </div>

      <p class="yanta-sync-card-fineprint" data-yanta-plus-fineprint hidden>
        ${t('settings.billing.fineprint')}
      </p>
    </div>
  `;

  const status = group.querySelector('[data-yanta-plus-status]');
  const upgrade = group.querySelector('[data-yanta-plus-upgrade]');
  const manage = group.querySelector('[data-yanta-plus-manage]');
  const fineprint = group.querySelector('[data-yanta-plus-fineprint]');

  const applyState = (state) => {
    status.innerHTML = state.html;
    upgrade.hidden = !state.showUpgrade;
    manage.hidden = !state.showManage;
    fineprint.hidden = !state.isPlus;
  };

  import('./billing/billing-ui.js')
    .then(async ({ currentBillingSummary, describeBillingState, reconciledBillingSummary }) => {
      const summary = await currentBillingSummary();
      const state = describeBillingState(summary);
      applyState(state);

      // A past renewal date means the local plan cache missed a webhook.
      // Reconcile against Paddle and re-render with the authoritative state.
      if (state.stale) {
        try {
          const fresh = await reconciledBillingSummary();
          applyState(describeBillingState(fresh, { afterReconcile: true }));
        } catch (err) {
          console.warn('[YANTA Billing] Reconcile failed', err);
          applyState(describeBillingState(summary, { afterReconcile: true }));
        }
      }
    })
    .catch(() => {
      status.innerHTML = `
        <strong>${t('settings.billing.unavailableLabel')}</strong>
        ${t('settings.billing.unavailableBody')}
      `;
    });

  upgrade?.addEventListener('click', async () => {
    try {
      const { openYantaPlusUpgrade } = await import('./billing/billing-ui.js');

      await openYantaPlusUpgrade({
        interval: 'yearly',
      });
    } catch (err) {
      console.error(err);
      toast(err?.message || t('settings.billing.checkoutError'), 'error');
    }
  });

  manage?.addEventListener('click', async () => {
    try {
      const { openYantaBillingPortal } = await import('./billing/billing-ui.js');

      await openYantaBillingPortal();
    } catch (err) {
      console.error(err);
      toast(err?.message || t('settings.billing.portalError'), 'error');
    }
  });

  return group;
}

function renderEncryptedBackupCard() {
  const group = el('div', { class: 'yanta-settings-group yanta-sync-backup-card' });

  group.innerHTML = `
    <div class="yanta-sync-card">
      <div class="yanta-sync-card-head">
        <div class="yanta-sync-card-icon secondary">
          ${lucide('download', 22)}
        </div>

        <div class="yanta-sync-card-title">
          <strong>${t('settings.sync.backupTitle')}</strong>
          <p>${t('settings.sync.backupDesc', { ext: '<code>.yanta</code>' })}</p>
        </div>
      </div>

      <div class="compress-actions yanta-sync-card-actions">
        <button class="btn primary" data-yanta-backup-now>
          ${lucide('download', 14)}
          ${t('settings.sync.backupCreate')}
        </button>

        <button class="btn" data-yanta-restore-backup>
          ${lucide('upload', 14)}
          ${t('settings.sync.backupRestore')}
        </button>

        <button class="btn" data-yanta-copy-sync-key>
          ${lucide('key-round', 14)}
          ${t('settings.sync.copySyncKey')}
        </button>
      </div>
    </div>
  `;

  group.querySelector('[data-yanta-backup-now]')?.addEventListener('click', async () => {
    const { exportSyncCapsule } = await import('./sync2/capsule.js');

    await exportSyncCapsule();

    try {
      const { markSyncReminderBackupCreated } = await import('./sync2/sync-reminder-ui.js');
      markSyncReminderBackupCreated();
    } catch {}
  });

  group.querySelector('[data-yanta-restore-backup]')?.addEventListener('click', async () => {
    closeSettings();

    const { pickAndImportSyncCapsule } = await import('./sync2/capsule.js');
    await pickAndImportSyncCapsule();
  });

  group.querySelector('[data-yanta-copy-sync-key]')?.addEventListener('click', async () => {
    const { copySyncCapsuleRecoveryKey } = await import('./sync2/capsule.js');
    await copySyncCapsuleRecoveryKey();
  });

  return group;
}

function renderAdvancedSyncMethods() {
  const group = el('div', { class: 'yanta-settings-group yanta-sync-advanced-group' });

  const details = el('details', { class: 'yanta-sync-advanced-details' });

  const summary = el('summary', {}, t('settings.sync.advancedSummary'));

  const body = el('div', { class: 'yanta-sync-advanced-body' });

  body.innerHTML = `
    <p class="yanta-settings-hint">
      ${t('settings.sync.advancedHint')}
    </p>

    <div class="yanta-sync-advanced-grid">
      <div class="yanta-sync-advanced-card">
        <strong>${lucide('hard-drive', 14)} ${t('settings.sync.gdriveTitle')}</strong>
        <p>${t('settings.sync.gdriveDesc')}</p>
        <button class="btn" data-advanced-google-drive>
          ${lucide('settings', 14)}
          ${t('settings.sync.gdriveOpen')}
        </button>
      </div>

      <div class="yanta-sync-advanced-card">
        <strong>${lucide('folder-sync', 14)} ${t('settings.sync.folderTitle')}</strong>
        <p>${t('settings.sync.folderDesc')}</p>
        <button class="btn" data-advanced-sync-folder>
          ${lucide('folder', 14)}
          ${t('settings.sync.folderSetup')}
        </button>
      </div>

      <div class="yanta-sync-advanced-card">
        <strong>${lucide('server', 14)} ${t('settings.sync.brokerTitle')}</strong>
        <p>${t('settings.sync.brokerDesc')}</p>
        <button class="btn" data-advanced-broker-info>
          ${lucide('terminal', 14)}
          ${t('settings.sync.brokerHintBtn')}
        </button>
      </div>

      <div class="yanta-sync-advanced-card">
        <strong>${lucide('key-round', 14)} ${t('settings.sync.syncKeyTitle')}</strong>
        <p>${t('settings.sync.syncKeyDesc')}</p>
        <button class="btn" data-advanced-copy-sync-key>
          ${lucide('copy', 14)}
          ${t('settings.sync.copySyncKey')}
        </button>
      </div>
    </div>
  `;

  body.querySelector('[data-advanced-google-drive]')?.addEventListener('click', async () => {
    closeSettings();

    const { openGoogleDriveSyncSetup } = await import('./sync2/sync-setup-ui.js');
    openGoogleDriveSyncSetup();
  });

  body.querySelector('[data-advanced-sync-folder]')?.addEventListener('click', async () => {
    closeSettings();

    const { openSyncSetup } = await import('./sync.js');
    openSyncSetup();
  });

  body.querySelector('[data-advanced-broker-info]')?.addEventListener('click', () => {
    toast(t('settings.sync.brokerHintToast'), 'success');
  });

  body.querySelector('[data-advanced-copy-sync-key]')?.addEventListener('click', async () => {
    const { copySyncCapsuleRecoveryKey } = await import('./sync2/capsule.js');
    await copySyncCapsuleRecoveryKey();
  });

  details.append(summary, body);

  group.append(details);

  /*
    Keep the existing setting-scope feature.
    It is not removed, only moved below the main sync UX.
  */
  const a = getAppearance();

  const scopeDetails = el('details', {
    class: 'yanta-sync-advanced-details yanta-sync-settings-scope-details',
  });

  scopeDetails.append(
    el('summary', {}, t('settings.sync.scopeSummary')),
    renderDeviceOnlyToggle(a)
  );

  group.append(scopeDetails);

  return group;
}

// ---- About section ----
function renderAboutSection(host) {
  host.append(sectionHeader(t('settings.sections.about.title'), null));
  const about = el('div', { class: 'yanta-settings-info' });
  about.append(
    el('p', {}, el('strong', {}, 'YANTA'), ' — ' + t('settings.about.tagline')),
    el('p', {}, t('settings.about.description')),
    el('p', { style: 'color:var(--text-faint);font-size:12px;margin-top:12px' }, t('settings.about.privacy')),
  );
  host.append(about);

  // Danger zone
  const danger = el('div', { class: 'yanta-settings-group' });
  danger.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.about.resetAllTitle')));
  danger.append(el('p', { class: 'yanta-settings-hint' }, t('settings.about.resetAllHint')));
  danger.append(el('button', {
    class: 'btn danger',
    onclick: async () => {
      const ok = await yantaConfirm({
        title: t('settings.about.resetConfirmTitle'),
        message: t('settings.about.resetConfirmMessage'),
        confirmLabel: t('settings.about.resetConfirmAction'),
        danger: true,
      });

      if (!ok) return;
      clearDeviceSettings();
      await clearSyncedSettings();
      appearance = deepMerge(DEFAULT_APPEARANCE, {});
      applyAppearance();
      renderSettingsBody();
      toast(t('settings.about.resetToast'), 'success');
    },
  }, t('settings.about.resetAllButton')));
  host.append(danger);

  /*
    In-app route to account deletion. Google Play requires apps with accounts
    to offer one, and GDPR Art. 17 wants erasure to be genuinely reachable.
    The page itself does the work — it also has to exist as a public URL, so
    duplicating the flow here would mean two implementations of one deletion.
  */
  const account = el('div', { class: 'yanta-settings-group' });
  account.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.about.deleteAccountTitle')));
  account.append(el('p', { class: 'yanta-settings-hint' }, t('settings.about.deleteAccountHint')));
  account.append(el('a', {
    class: 'btn danger',
    href: '/delete-account',
  }, t('settings.about.deleteAccountButton')));
  host.append(account);
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
  group.append(el('div', { class: 'yanta-settings-group-title' }, t('settings.sync.scope')));

  const row = el('label', { class: 'yanta-settings-toggle' });
  const cb = el('input', { type: 'checkbox' });
  cb.checked = !!a.deviceOnly;
cb.addEventListener('change', async () => {
  await saveAppearance({ deviceOnly: cb.checked });
  toast(cb.checked ? t('settings.sync.deviceOnlySavedToast') : t('settings.sync.deviceSyncedToast'), 'success');
  rerenderSettingsBody();
});
  row.append(cb);
  row.append(el('div', { class: 'yanta-settings-toggle-meta' },
    el('div', { class: 'yanta-settings-toggle-label' }, t('settings.sync.deviceOnlyLabel')),
    el('div', { class: 'yanta-settings-toggle-hint' },
      t('settings.sync.deviceOnlyHint')),
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
  // height: min(720px, 92vh);
  // max-height: 92vh;
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
  gap: 8px;
  overflow: hidden;
  min-height: 0;
}

.yanta-settings-search {
  flex: 0 0 auto;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}

.yanta-settings-search:focus {
  outline: none;
  border-color: var(--accent);
}

.yanta-settings-search::placeholder { color: var(--text-faint); }

.yanta-settings-rail-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.yanta-settings-rail-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
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

.yanta-settings-rail-btn[hidden] { display: none; }

.yanta-settings-rail-label { flex: 1; min-width: 0; }

.yanta-settings-rail-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
}

.yanta-settings-rail-icon svg {
  display: block;
  width: 16px;
  height: 16px;
  overflow: visible;
}

/* Drill-down affordance — mobile only. */
.yanta-settings-rail-chevron {
  display: none;
  color: var(--text-faint);
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

/* Back button in the header — mobile drill-down only. */
.yanta-settings-back { display: none; }

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

/* Shortcuts */
.yanta-shortcut-row {
  display: flex;
  align-items: center;
  gap: 10px;

  padding: 7px 0;
  border-bottom: 1px solid var(--border);
}

.yanta-shortcut-row:last-child {
  border-bottom: 0;
}

.yanta-shortcut-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
}

.yanta-shortcut-keys {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.yanta-shortcut-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  padding: 2px 4px 2px 8px;

  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 6px;

  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--text);
}

.yanta-shortcut-chip-remove {
  border: 0;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 3px;
  border-radius: 4px;
}

.yanta-shortcut-chip-remove:hover {
  color: var(--red);
  background: var(--bg-elev-3);
}

.yanta-shortcut-empty {
  font-size: 12px;
  color: var(--text-faint);
}

.yanta-shortcut-record.is-recording {
  border-color: var(--accent);
  color: var(--accent);
}

.yanta-shortcut-record,
.yanta-shortcut-reset {
  flex: none;
  padding: 4px 10px;
  font-size: 12px;
}

.yanta-shortcut-conflict {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;

  margin: 6px 0 10px;
  padding: 10px 12px;

  background: var(--bg-elev-2);
  border: 1px solid var(--accent);
  border-radius: 8px;

  font-size: 12px;
  color: var(--text-dim);
}

.yanta-shortcut-conflict .btn {
  padding: 4px 10px;
  font-size: 12px;
}

.yanta-shortcuts-footer {
  display: flex;
  justify-content: flex-end;
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

/* Quick Actions settings */
.yanta-qc-icon-choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 10px;

  margin-top: 10px;
}

.yanta-qc-icon-choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;

  padding: 14px 10px 11px;

  border: 1px solid var(--border);
  border-radius: 14px;

  background: var(--bg-elev-2);
  color: var(--text);

  cursor: pointer;

  transition:
    border-color 140ms ease,
    background-color 140ms ease,
    transform 140ms cubic-bezier(.2,.8,.2,1);
}

.yanta-qc-icon-choice:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  transform: translateY(-1px);
}

.yanta-qc-icon-choice.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-elev-2));
}

.yanta-qc-icon-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  width: 46px;
  height: 46px;

  border-radius: 999px;

  background: var(--accent);
  color: white;

  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

.yanta-qc-icon-preview svg {
  display: block;
  width: 24px;
  height: 24px;
  overflow: visible;
}

.yanta-qc-icon-choice-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
}

.yanta-qc-icon-choice.active .yanta-qc-icon-choice-label {
  color: var(--text);
}

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

.yanta-qc-layout-origin svg {
  display: block;
  width: 25px;
  height: 25px;
  overflow: visible;
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

/* Sync settings SaaS UX */
.yanta-sync-card {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-elev-2);
}

.yanta-sync-card-primary {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 11%, var(--bg-elev-2)),
      var(--bg-elev-2)
    );
}

.yanta-sync-card-head {
  display: flex;
  align-items: flex-start;
  gap: 13px;
}

.yanta-sync-card-icon {
  width: 46px;
  height: 46px;
  flex: 0 0 46px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 16px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}

.yanta-sync-card-icon.secondary {
  color: var(--accent-2);
  background: color-mix(in srgb, var(--accent-2) 15%, transparent);
}

.yanta-sync-card-title {
  flex: 1;
  min-width: 0;
}

.yanta-sync-card-kicker {
  display: inline-flex;
  width: fit-content;

  margin-bottom: 5px;
  padding: 2px 8px;

  border-radius: 999px;

  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);

  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.yanta-sync-card-title strong {
  display: block;
  color: var(--text);
  font-size: 15px;
  line-height: 1.25;
}

.yanta-sync-card-title p {
  margin: 5px 0 0;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.5;
}

.yanta-sync-card-points {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;

  margin-top: 13px;
}

.yanta-sync-card-points span {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  padding: 4px 8px;
  border-radius: 999px;

  color: var(--text-dim);
  background: var(--bg-elev);

  border: 1px solid var(--border);

  font-size: 11px;
}

.yanta-sync-card-points svg {
  color: var(--green);
}

.yanta-sync-status-line {
  margin-top: 13px;
  padding: 9px 10px;

  border: 1px solid var(--border);
  border-radius: 10px;

  background: var(--bg-elev);
  color: var(--text-dim);

  font-size: 12px;
  line-height: 1.45;
}

.yanta-sync-status-line strong {
  color: var(--text);
}

.yanta-sync-card-actions {
  margin-top: 13px;
  justify-content: flex-start;
  flex-wrap: wrap;
}

.yanta-sync-card-fineprint {
  margin: 9px 2px 0;
  color: var(--text-faint);
  font-size: 11.5px;
  line-height: 1.45;
}

.yanta-sync-advanced-details {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elev-2);
  margin-bottom: 10px;
  overflow: hidden;
}

.yanta-sync-advanced-details summary {
  cursor: pointer;
  user-select: none;

  padding: 12px 14px;

  color: var(--text);
  font-size: 13px;
  font-weight: 800;

  background: var(--bg-elev-2);
}

.yanta-sync-advanced-details summary:hover {
  color: var(--accent);
}

.yanta-sync-advanced-body {
  padding: 0 14px 14px;
}

.yanta-sync-advanced-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 10px;
}

.yanta-sync-advanced-card {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--bg-elev);
}

.yanta-sync-advanced-card strong {
  display: flex;
  align-items: center;
  gap: 7px;

  color: var(--text);
  font-size: 13px;
}

.yanta-sync-advanced-card strong svg {
  color: var(--accent);
}

.yanta-sync-advanced-card p {
  min-height: 64px;
  margin: 7px 0 11px;

  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.yanta-sync-settings-scope-details .yanta-settings-group {
  margin: 0;
  padding: 0 14px 14px;
}

/* Mobile */
@media (max-width: 720px) {
  .yanta-settings-body {
    grid-template-columns: 1fr;
  }

  /* Drill-down: the rail is a full-width vertical list (master),
     the content is the detail. Only one is visible at a time. */
  .yanta-settings-rail {
    border-right: 0;
    padding: 12px;
    gap: 10px;
  }

  .yanta-settings-rail-list { gap: 4px; }

  .yanta-settings-rail-btn {
    padding: 13px 12px;
    font-size: 15px;
    border-radius: 10px;
  }

  .yanta-settings-rail-btn.active {
    background: transparent;
    color: var(--text-dim);
    font-weight: 400;
  }

  .yanta-settings-rail-btn:active { background: var(--bg-elev-3); }

  .yanta-settings-rail-chevron { display: inline-flex; }

  /* List mode → show rail, hide detail. Detail mode → the reverse. */
  .yanta-settings-card:not(.is-detail) .yanta-settings-content { display: none; }

  .yanta-settings-card.is-detail .yanta-settings-rail { display: none; }

  .yanta-settings-card.is-detail .yanta-settings-back { display: inline-flex; }

  .yanta-settings-content { padding: 18px 18px 28px; }

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
/* AI settings mirrored inside Main Settings */
.yanta-ai-main-settings-mirror {
  margin-top: 18px;
}

.yanta-ai-main-settings-mirror .yanta-ai-settings-panel {
  padding: 0;
}

.yanta-ai-main-settings-mirror .compress-actions {
  flex-wrap: wrap;
}

.yanta-ai-main-settings-mirror .btn.primary {
  flex: 0 0 auto;
}

@media (max-width: 720px) {
  .yanta-ai-main-settings-mirror .compress-actions {
    justify-content: stretch;
  }

  .yanta-ai-main-settings-mirror .compress-actions .btn {
    flex: 1 1 auto;
    justify-content: center;
  }
}

.yanta-chat-settings-mini-meter {
  position: relative;
  height: 8px;
  overflow: hidden;
  margin-top: 13px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-faint) 16%, transparent);
}

.yanta-chat-settings-mini-meter > span {
  display: block;
  height: 100%;
  min-width: 4px;
  max-width: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    var(--accent),
    color-mix(in srgb, var(--accent) 70%, white)
  );
}

.yanta-chat-settings-row {
  margin-top: 12px;
}

.yanta-chat-settings-row label {
  display: grid;
  gap: 6px;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 750;
}
  `;

  document.head.append(style);
}
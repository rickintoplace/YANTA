// ============================================================
// YANTA Sync2 — Provider Registry
//
// Provider-neutral remote storage registry.
//
// Sync2 itself only needs a RemoteObjectStore.
// Providers only implement encrypted object storage transport.
// ============================================================

import { GoogleDriveObjectStore } from './google-drive-object-store.js';
import { BrokerObjectStore } from './broker-object-store.js';
import { YantaCloudObjectStore } from './yanta-cloud-object-store.js';

export const SYNC2_PROVIDERS = {
  'google-drive': {
    id: 'google-drive',
    label: 'Google Drive',
    description: 'Encrypted blobs in your hidden Google Drive app data folder.',
    requiresOAuth: true,
    stable: true,

    createRemote({
      clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID,
      prompt = '',
    } = {}) {
      return new GoogleDriveObjectStore({
        clientId,
        initialPrompt: prompt,
      });
    },
  },

  broker: {
    id: 'broker',
    label: 'Custom Sync Broker',
    description: 'Provider-neutral encrypted object storage endpoint.',
    requiresOAuth: false,
    stable: false,

    createRemote({
      baseUrl = 'http://localhost:8787',
      token = '',
    } = {}) {
      return new BrokerObjectStore({
        baseUrl,
        token,
      });
    },
  },

    'yanta-cloud': {
    id: 'yanta-cloud',
    label: 'YANTA Cloud',
    description: 'Encrypted zero-knowledge sync through your YANTA account.',
    requiresOAuth: false,
    stable: true,

    createRemote({
      baseUrl = '',
      vaultId = '',
      deviceId = '',
    } = {}) {
      return new YantaCloudObjectStore({
        baseUrl,
        vaultId,
        deviceId,
      });
    },
  },

  // Future providers should only add a RemoteObjectStore implementation:
  //
  // dropbox: {
  //   id: 'dropbox',
  //   label: 'Dropbox',
  //   description: 'Encrypted blobs in Dropbox app storage.',
  //   requiresOAuth: true,
  //   createRemote(options) {
  //     return new DropboxObjectStore(options);
  //   },
  // },
  //
  // onedrive: {
  //   id: 'onedrive',
  //   label: 'OneDrive',
  //   description: 'Encrypted blobs in OneDrive app storage.',
  //   requiresOAuth: true,
  //   createRemote(options) {
  //     return new OneDriveObjectStore(options);
  //   },
  // },
};

export function sync2ProviderIds() {
  return Object.keys(SYNC2_PROVIDERS);
}

export function getSync2Provider(providerId) {
  return SYNC2_PROVIDERS[providerId] || null;
}

export function requireSync2Provider(providerId) {
  const provider = getSync2Provider(providerId);

  if (!provider) {
    throw new Error(`Unknown sync provider: ${providerId}`);
  }

  return provider;
}
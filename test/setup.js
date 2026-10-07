// Installs IDBKeyRange & friends globally. Each simulated device/origin
// then swaps in its own IDBFactory (see test/sync2/harness.js).
import 'fake-indexeddb/auto';

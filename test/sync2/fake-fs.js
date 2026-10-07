// In-memory File System Access API (just what src/sync.js uses).

class FakeFileHandle {
  constructor(name, dir) {
    this.kind = 'file';
    this.name = name;
    this.dir = dir;
    this.content = '';
    this.lastModified = 0;
  }

  async getFile() {
    const content = this.content;
    return {
      name: this.name,
      lastModified: this.lastModified,
      text: async () => (typeof content === 'string' ? content : new TextDecoder().decode(content)),
      arrayBuffer: async () => (typeof content === 'string' ? new TextEncoder().encode(content) : content).buffer,
    };
  }

  async createWritable() {
    let next = '';
    return {
      write: async (data) => {
        if (typeof data === 'string') next = data;
        else if (data instanceof Uint8Array) next = new Uint8Array(data);
        else if (data?.arrayBuffer) next = new Uint8Array(await data.arrayBuffer());
        else next = String(data);
      },
      close: async () => {
        this.content = next;
        this.lastModified = this.dir.root.clock();
      },
    };
  }
}

export class FakeDirectoryHandle {
  constructor(name = 'root', root = null) {
    this.kind = 'directory';
    this.name = name;
    this.root = root || this;
    this.children = new Map();
    if (!root) this.now = Date.now();
  }

  clock() {
    // Strictly increasing "mtime", aligned with wall time.
    this.now = Math.max(this.now + 1, Date.now());
    return this.now;
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    let child = this.children.get(name);
    if (!child && create) {
      child = new FakeDirectoryHandle(name, this.root);
      this.children.set(name, child);
    }
    if (!child || child.kind !== 'directory') {
      throw Object.assign(new Error(`NotFound: ${name}`), { name: 'NotFoundError' });
    }
    return child;
  }

  async getFileHandle(name, { create = false } = {}) {
    let child = this.children.get(name);
    if (!child && create) {
      child = new FakeFileHandle(name, this);
      this.children.set(name, child);
    }
    if (!child || child.kind !== 'file') {
      throw Object.assign(new Error(`NotFound: ${name}`), { name: 'NotFoundError' });
    }
    return child;
  }

  async removeEntry(name) {
    if (!this.children.delete(name)) {
      throw Object.assign(new Error(`NotFound: ${name}`), { name: 'NotFoundError' });
    }
  }

  async *entries() {
    for (const entry of [...this.children]) yield entry;
  }

  // Test helpers.
  async readText(path) {
    const parts = path.split('/');
    const file = parts.pop();
    let dir = this;
    for (const p of parts) dir = await dir.getDirectoryHandle(p);
    return (await (await dir.getFileHandle(file)).getFile()).text();
  }

  async findFiles(dirPath) {
    let dir = this;
    for (const p of dirPath.split('/')) dir = await dir.getDirectoryHandle(p);
    return [...dir.children.values()].filter((c) => c.kind === 'file');
  }
}

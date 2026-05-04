/* eslint-disable */
// This file is read via Vite ?raw and injected into the inspected page's main world
// via chrome.devtools.inspectedWindow.eval. Keep it dependency-free and ES2020-compatible.
// It exposes window.__BRAINWIRES_OPFS__ with invoke(opId, op, args) -> id and poll(id) -> result.
(() => {
  if (window.__BRAINWIRES_OPFS__ && window.__BRAINWIRES_OPFS__.v === 1) return;

  const splitPath = (p) => {
    if (!p || p === '/' || p === '') return [];
    return p.replace(/^\/+|\/+$/g, '').split('/');
  };

  const joinPath = (...parts) => '/' + parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/+/, '');

  async function getRoot() {
    if (!navigator.storage || !navigator.storage.getDirectory) {
      throw mkErr('NoOpfs', 'OPFS not available in this context');
    }
    return await navigator.storage.getDirectory();
  }

  async function resolveDir(path, { create = false } = {}) {
    let dir = await getRoot();
    for (const seg of splitPath(path)) {
      dir = await dir.getDirectoryHandle(seg, { create });
    }
    return dir;
  }

  async function resolveFile(path, { create = false } = {}) {
    const parts = splitPath(path);
    if (parts.length === 0) throw mkErr('TypeMismatch', 'Path is root, not a file');
    const name = parts.pop();
    const parent = await resolveDir('/' + parts.join('/'), { create });
    return await parent.getFileHandle(name, { create });
  }

  async function resolveAny(path) {
    const parts = splitPath(path);
    if (parts.length === 0) {
      const root = await getRoot();
      return { kind: 'directory', handle: root, parent: null, name: '' };
    }
    const name = parts[parts.length - 1];
    const parent = await resolveDir('/' + parts.slice(0, -1).join('/'));
    try {
      const fh = await parent.getFileHandle(name);
      return { kind: 'file', handle: fh, parent, name };
    } catch (e) {
      const dh = await parent.getDirectoryHandle(name);
      return { kind: 'directory', handle: dh, parent, name };
    }
  }

  function mkErr(code, message) {
    const e = new Error(message);
    e.__opfs_code = code;
    return e;
  }

  function classify(e) {
    if (e && e.__opfs_code) return { code: e.__opfs_code, message: e.message };
    const name = (e && e.name) || '';
    const msg = (e && e.message) || String(e);
    if (name === 'NotFoundError') return { code: 'NotFound', message: msg };
    if (name === 'NotAllowedError') return { code: 'NotAllowed', message: msg };
    if (name === 'TypeMismatchError') return { code: 'TypeMismatch', message: msg };
    if (name === 'NoModificationAllowedError' || /lock/i.test(msg)) return { code: 'Locked', message: msg };
    return { code: 'Unknown', message: msg };
  }

  function bytesToB64(uint8) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < uint8.length; i += chunk) {
      s += String.fromCharCode.apply(null, uint8.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function b64ToBytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function probeLocked(fileHandle) {
    // Try to acquire a sync access handle in a worker-free probe; we only check via createWritable
    // because createSyncAccessHandle requires a worker. createWritable will throw on locked files.
    try {
      const w = await fileHandle.createWritable({ keepExistingData: true });
      await w.close();
      return false;
    } catch (e) {
      if ((e && e.name === 'NoModificationAllowedError') || /lock/i.test(String(e && e.message))) return true;
      return false;
    }
  }

  const ops = {
    async quota() {
      const est = await navigator.storage.estimate();
      return { usage: est.usage || 0, quota: est.quota || 0 };
    },

    async list({ path }) {
      const dir = await resolveDir(path);
      const out = [];
      for await (const [name, handle] of dir.entries()) {
        const childPath = joinPath(path, name);
        if (handle.kind === 'file') {
          const f = await handle.getFile();
          out.push({
            name,
            path: childPath,
            kind: 'file',
            size: f.size,
            lastModified: f.lastModified,
            locked: false,
          });
        } else {
          out.push({
            name,
            path: childPath,
            kind: 'directory',
            size: 0,
            lastModified: 0,
            locked: false,
          });
        }
      }
      out.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return out;
    },

    async tree({ path, maxDepth = Infinity }) {
      const out = [];
      async function walk(dirPath, dirHandle, depth) {
        for await (const [name, handle] of dirHandle.entries()) {
          const childPath = joinPath(dirPath, name);
          if (handle.kind === 'file') {
            const f = await handle.getFile();
            out.push({
              name,
              path: childPath,
              kind: 'file',
              size: f.size,
              lastModified: f.lastModified,
              locked: false,
            });
          } else {
            out.push({
              name,
              path: childPath,
              kind: 'directory',
              size: 0,
              lastModified: 0,
              locked: false,
            });
            if (depth + 1 < maxDepth) await walk(childPath, handle, depth + 1);
          }
        }
      }
      const root = await resolveDir(path);
      await walk(path, root, 0);
      return out;
    },

    async read({ path, offset = 0, length }) {
      const fh = await resolveFile(path);
      const file = await fh.getFile();
      const end = length == null ? file.size : Math.min(offset + length, file.size);
      const slice = file.slice(offset, end);
      const buf = new Uint8Array(await slice.arrayBuffer());
      return {
        b64: bytesToB64(buf),
        size: file.size,
        eof: end >= file.size,
      };
    },

    async write({ path, b64, mode }) {
      const fh = await resolveFile(path, { create: true });
      const bytes = b64ToBytes(b64);
      if (mode === 'append') {
        const existing = await fh.getFile();
        const w = await fh.createWritable({ keepExistingData: true });
        await w.seek(existing.size);
        await w.write(bytes);
        await w.close();
      } else {
        const w = await fh.createWritable({ keepExistingData: false });
        await w.write(bytes);
        await w.close();
      }
      return { bytesWritten: bytes.length };
    },

    async mkdir({ path }) {
      await resolveDir(path, { create: true });
      return undefined;
    },

    async rm({ path, recursive }) {
      const parts = splitPath(path);
      if (parts.length === 0) throw mkErr('NotAllowed', 'Refusing to remove OPFS root');
      const name = parts.pop();
      const parent = await resolveDir('/' + parts.join('/'));
      await parent.removeEntry(name, { recursive });
      return undefined;
    },

    async move({ from, to }) {
      const src = await resolveAny(from);
      if (src.kind === 'file') {
        // Modern Chrome supports FileSystemHandle.move
        if (typeof src.handle.move === 'function') {
          const toParts = splitPath(to);
          const toName = toParts.pop();
          const toParent = await resolveDir('/' + toParts.join('/'), { create: true });
          await src.handle.move(toParent, toName);
          return undefined;
        }
        // Fallback: copy bytes then delete original
        const f = await src.handle.getFile();
        const dest = await resolveFile(to, { create: true });
        const w = await dest.createWritable({ keepExistingData: false });
        await w.write(await f.arrayBuffer());
        await w.close();
        await src.parent.removeEntry(src.name, { recursive: false });
        return undefined;
      }
      // Directory move: recursive copy + delete
      async function copyDir(srcDir, destPath) {
        const dest = await resolveDir(destPath, { create: true });
        for await (const [name, handle] of srcDir.entries()) {
          if (handle.kind === 'file') {
            const f = await handle.getFile();
            const dh = await dest.getFileHandle(name, { create: true });
            const w = await dh.createWritable({ keepExistingData: false });
            await w.write(await f.arrayBuffer());
            await w.close();
          } else {
            await copyDir(handle, joinPath(destPath, name));
          }
        }
      }
      await copyDir(src.handle, to);
      await src.parent.removeEntry(src.name, { recursive: true });
      return undefined;
    },

    async stat({ path }) {
      const r = await resolveAny(path);
      if (r.kind === 'file') {
        const f = await r.handle.getFile();
        return {
          name: r.name,
          path,
          kind: 'file',
          size: f.size,
          lastModified: f.lastModified,
          locked: await probeLocked(r.handle),
        };
      }
      return { name: r.name, path, kind: 'directory', size: 0, lastModified: 0, locked: false };
    },

    async mtimes({ path }) {
      const out = {};
      const root = await resolveDir(path);
      async function walk(p, dh) {
        for await (const [name, handle] of dh.entries()) {
          const child = joinPath(p, name);
          if (handle.kind === 'file') {
            const f = await handle.getFile();
            out[child] = f.lastModified;
          } else {
            await walk(child, handle);
          }
        }
      }
      await walk(path, root);
      return out;
    },
  };

  const bridge = {
    v: 1,
    nextId: 1,
    results: new Map(),
    invoke(op, args) {
      if (!ops[op]) {
        const id = this.nextId++;
        this.results.set(id, { pending: false, ok: false, error: { code: 'Unknown', message: 'Unknown op: ' + op } });
        return id;
      }
      const id = this.nextId++;
      this.results.set(id, { pending: true });
      Promise.resolve().then(async () => {
        try {
          const value = await ops[op](args || {});
          this.results.set(id, { pending: false, ok: true, value });
        } catch (e) {
          this.results.set(id, { pending: false, ok: false, error: classify(e) });
        }
      });
      return id;
    },
    poll(id) {
      const r = this.results.get(id);
      if (!r) return { pending: false, ok: false, error: { code: 'Unknown', message: 'Result expired' } };
      if (!r.pending) this.results.delete(id);
      return r;
    },
    info() {
      return {
        v: this.v,
        hasOpfs: !!(navigator.storage && navigator.storage.getDirectory),
        origin: location.origin,
      };
    },
  };

  Object.defineProperty(window, '__BRAINWIRES_OPFS__', {
    value: bridge,
    configurable: true,
    writable: false,
    enumerable: false,
  });
})();

import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const installerPath = path.resolve(__dirname, '../../src/panel/bridge/installer.js');

let installerSrc: string;

test.beforeAll(async () => {
  installerSrc = await readFile(installerPath, 'utf-8');
});

async function setup(page: Page) {
  await page.goto('http://127.0.0.1:5179/');
  await page.waitForFunction(() => (window as typeof window & { __OPFS_READY__?: boolean }).__OPFS_READY__ === true);
  // Inject the bridge in the same way inspectedWindow.eval would
  await page.evaluate(`(function(){${installerSrc}})()`);
  // Confirm it's installed
  const info = await page.evaluate(`window.__BRAINWIRES_OPFS__.info()`);
  expect(info).toMatchObject({ v: 1, hasOpfs: true });
}

async function call<T>(page: Page, op: string, args: unknown): Promise<T> {
  const id = await page.evaluate<number, [string, string]>(
    ([o, a]) => {
      const w = window as typeof window & {
        __BRAINWIRES_OPFS__: { invoke(op: string, args: unknown): number };
      };
      return w.__BRAINWIRES_OPFS__.invoke(o, JSON.parse(a));
    },
    [op, JSON.stringify(args)],
  );
  // Poll
  const start = Date.now();
  while (true) {
    const r = await page.evaluate<{ pending: boolean; ok?: boolean; value?: unknown; error?: { code: string; message: string } }, number>(
      (i) => {
        const w = window as typeof window & {
          __BRAINWIRES_OPFS__: { poll(id: number): { pending: boolean; ok?: boolean; value?: unknown; error?: { code: string; message: string } } };
        };
        return w.__BRAINWIRES_OPFS__.poll(i);
      },
      id,
    );
    if (!r.pending) {
      if (r.ok) return r.value as T;
      throw new Error(`${r.error!.code}: ${r.error!.message}`);
    }
    if (Date.now() - start > 10_000) throw new Error(`Op ${op} timed out`);
    await new Promise((res) => setTimeout(res, 25));
  }
}

function bytesToB64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}
function b64ToBytes(b64: string): number[] {
  return Array.from(Buffer.from(b64, 'base64'));
}

test.describe('bridge installer', () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test('quota returns numbers', async ({ page }) => {
    const q = await call<{ usage: number; quota: number }>(page, 'quota', {});
    expect(typeof q.usage).toBe('number');
    expect(typeof q.quota).toBe('number');
    expect(q.quota).toBeGreaterThan(0);
  });

  test('list root on empty OPFS returns []', async ({ page }) => {
    const entries = await call<unknown[]>(page, 'list', { path: '/' });
    expect(entries).toEqual([]);
  });

  test('write -> list -> read round-trip (small text)', async ({ page }) => {
    const original = 'Hello, OPFS!\nLine 2.\n';
    const b64 = bytesToB64([...new TextEncoder().encode(original)]);
    await call(page, 'write', { path: '/hello.txt', b64, mode: 'replace' });

    const entries = await call<{ name: string; kind: string; size: number }[]>(page, 'list', { path: '/' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'hello.txt', kind: 'file', size: original.length });

    const read = await call<{ b64: string; size: number; eof: boolean }>(page, 'read', { path: '/hello.txt' });
    expect(read.size).toBe(original.length);
    expect(read.eof).toBe(true);
    expect(new TextDecoder().decode(new Uint8Array(b64ToBytes(read.b64)))).toBe(original);
  });

  test('mkdir + nested write + tree walk', async ({ page }) => {
    await call(page, 'mkdir', { path: '/a/b/c' });
    await call(page, 'write', {
      path: '/a/b/c/leaf.txt',
      b64: bytesToB64([...new TextEncoder().encode('leaf')]),
      mode: 'replace',
    });
    const tree = await call<{ path: string; kind: string }[]>(page, 'tree', { path: '/' });
    const paths = tree.map((e) => `${e.kind}:${e.path}`).sort();
    expect(paths).toEqual([
      'directory:/a',
      'directory:/a/b',
      'directory:/a/b/c',
      'file:/a/b/c/leaf.txt',
    ]);
  });

  test('list sorts directories before files alphabetically', async ({ page }) => {
    await call(page, 'write', { path: '/zebra.txt', b64: '', mode: 'replace' });
    await call(page, 'mkdir', { path: '/alpha' });
    await call(page, 'write', { path: '/banana.txt', b64: '', mode: 'replace' });
    await call(page, 'mkdir', { path: '/charlie' });
    const entries = await call<{ name: string; kind: string }[]>(page, 'list', { path: '/' });
    expect(entries.map((e) => e.name)).toEqual(['alpha', 'charlie', 'banana.txt', 'zebra.txt']);
  });

  test('write with mode=append concatenates', async ({ page }) => {
    const enc = (s: string) => bytesToB64([...new TextEncoder().encode(s)]);
    await call(page, 'write', { path: '/log.txt', b64: enc('hello '), mode: 'replace' });
    await call(page, 'write', { path: '/log.txt', b64: enc('world'), mode: 'append' });
    await call(page, 'write', { path: '/log.txt', b64: enc('!'), mode: 'append' });
    const r = await call<{ b64: string }>(page, 'read', { path: '/log.txt' });
    expect(new TextDecoder().decode(new Uint8Array(b64ToBytes(r.b64)))).toBe('hello world!');
  });

  test('chunked read with offset/length', async ({ page }) => {
    const data = new Uint8Array(1024);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    await call(page, 'write', {
      path: '/blob.bin',
      b64: bytesToB64([...data]),
      mode: 'replace',
    });
    const first = await call<{ b64: string; eof: boolean }>(page, 'read', { path: '/blob.bin', offset: 0, length: 256 });
    expect(b64ToBytes(first.b64).length).toBe(256);
    expect(first.eof).toBe(false);
    const second = await call<{ b64: string; eof: boolean }>(page, 'read', { path: '/blob.bin', offset: 256, length: 1024 });
    expect(b64ToBytes(second.b64).length).toBe(768);
    expect(second.eof).toBe(true);
    const combined = [...b64ToBytes(first.b64), ...b64ToBytes(second.b64)];
    expect(combined).toEqual([...data]);
  });

  test('binary integrity for 4 MB+ payload', async ({ page }) => {
    const N = 4 * 1024 * 1024 + 7;
    // Build deterministic data in the page (avoids huge Playwright→browser arg)
    const sha = await page.evaluate(async (size) => {
      const w = window as typeof window & {
        __BRAINWIRES_OPFS__: { invoke(op: string, args: unknown): number; poll(id: number): { pending: boolean; ok?: boolean; value?: unknown; error?: { message: string } } };
      };
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = (i * 13 + 7) & 0xff;
      const buf = data.buffer.slice(0);
      const hash = await crypto.subtle.digest('SHA-256', buf);
      // base64 of data
      let s = '';
      const chunk = 0x8000;
      for (let i = 0; i < data.length; i += chunk) {
        s += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + chunk)));
      }
      const b64 = btoa(s);
      // write
      const id = w.__BRAINWIRES_OPFS__.invoke('write', { path: '/big.bin', b64, mode: 'replace' });
      while (true) {
        const r = w.__BRAINWIRES_OPFS__.poll(id);
        if (!r.pending) {
          if (!r.ok) throw new Error(r.error!.message);
          break;
        }
        await new Promise((res) => setTimeout(res, 5));
      }
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }, N);

    // Read back via the bridge in chunks; hash incrementally to avoid building a huge array
    const crypto = await import('node:crypto');
    const hasher = crypto.createHash('sha256');
    let total = 0;
    let offset = 0;
    while (offset < N) {
      const r = await call<{ b64: string; size: number; eof: boolean }>(page, 'read', {
        path: '/big.bin',
        offset,
        length: 1 * 1024 * 1024,
      });
      const buf = Buffer.from(r.b64, 'base64');
      hasher.update(buf);
      total += buf.length;
      offset += buf.length;
      if (r.eof) break;
    }
    expect(total).toBe(N);
    expect(hasher.digest('hex')).toBe(sha);
  });

  test('move (rename) preserves file contents', async ({ page }) => {
    await call(page, 'write', {
      path: '/before.txt',
      b64: bytesToB64([...new TextEncoder().encode('moved!')]),
      mode: 'replace',
    });
    await call(page, 'move', { from: '/before.txt', to: '/after.txt' });
    const r = await call<{ b64: string }>(page, 'read', { path: '/after.txt' });
    expect(new TextDecoder().decode(new Uint8Array(b64ToBytes(r.b64)))).toBe('moved!');
    await expect(call(page, 'read', { path: '/before.txt' })).rejects.toThrow(/NotFound/);
  });

  test('move into another directory', async ({ page }) => {
    await call(page, 'write', { path: '/a.txt', b64: bytesToB64([...new TextEncoder().encode('hi')]), mode: 'replace' });
    await call(page, 'mkdir', { path: '/sub' });
    await call(page, 'move', { from: '/a.txt', to: '/sub/a.txt' });
    const r = await call<{ b64: string }>(page, 'read', { path: '/sub/a.txt' });
    expect(new TextDecoder().decode(new Uint8Array(b64ToBytes(r.b64)))).toBe('hi');
  });

  test('rm non-recursive on directory with children fails predictably', async ({ page }) => {
    await call(page, 'mkdir', { path: '/d' });
    await call(page, 'write', { path: '/d/x.txt', b64: '', mode: 'replace' });
    await expect(call(page, 'rm', { path: '/d', recursive: false })).rejects.toThrow();
  });

  test('rm recursive removes whole subtree', async ({ page }) => {
    await call(page, 'mkdir', { path: '/d/sub' });
    await call(page, 'write', { path: '/d/sub/x.txt', b64: '', mode: 'replace' });
    await call(page, 'rm', { path: '/d', recursive: true });
    const entries = await call<unknown[]>(page, 'list', { path: '/' });
    expect(entries).toEqual([]);
  });

  test('refuses to remove root', async ({ page }) => {
    await expect(call(page, 'rm', { path: '/', recursive: true })).rejects.toThrow(/NotAllowed/);
  });

  test('mtimes returns lastModified for every file', async ({ page }) => {
    await call(page, 'write', { path: '/a.txt', b64: '', mode: 'replace' });
    await call(page, 'mkdir', { path: '/sub' });
    await call(page, 'write', { path: '/sub/b.txt', b64: '', mode: 'replace' });
    const m = await call<Record<string, number>>(page, 'mtimes', { path: '/' });
    expect(Object.keys(m).sort()).toEqual(['/a.txt', '/sub/b.txt']);
    for (const v of Object.values(m)) {
      expect(v).toBeGreaterThan(0);
    }
  });

  test('stat returns full FsEntry shape', async ({ page }) => {
    await call(page, 'write', { path: '/x.txt', b64: bytesToB64([1, 2, 3]), mode: 'replace' });
    const stat = await call<{ name: string; kind: string; size: number; locked: boolean }>(page, 'stat', { path: '/x.txt' });
    expect(stat).toMatchObject({ name: 'x.txt', kind: 'file', size: 3, locked: false });
  });

  test('reads NotFound surface as typed error', async ({ page }) => {
    await expect(call(page, 'read', { path: '/nope.txt' })).rejects.toThrow(/NotFound/);
  });

  test('empty file write + read', async ({ page }) => {
    await call(page, 'write', { path: '/empty', b64: '', mode: 'replace' });
    const r = await call<{ b64: string; size: number; eof: boolean }>(page, 'read', { path: '/empty' });
    expect(r.size).toBe(0);
    expect(r.b64).toBe('');
    expect(r.eof).toBe(true);
  });

  test('paths with unicode names round-trip', async ({ page }) => {
    const name = 'naïve—résumé.txt';
    await call(page, 'write', {
      path: `/${name}`,
      b64: bytesToB64([...new TextEncoder().encode('héllo')]),
      mode: 'replace',
    });
    const list = await call<{ name: string }[]>(page, 'list', { path: '/' });
    expect(list[0].name).toBe(name);
    const r = await call<{ b64: string }>(page, 'read', { path: `/${name}` });
    expect(new TextDecoder().decode(new Uint8Array(b64ToBytes(r.b64)))).toBe('héllo');
  });

  test('reinstalling bridge is idempotent (same instance, no error)', async ({ page }) => {
    const ref1 = await page.evaluate(`window.__BRAINWIRES_OPFS__.v`);
    await page.evaluate(`(function(){${installerSrc}})()`);
    const ref2 = await page.evaluate(`window.__BRAINWIRES_OPFS__.v`);
    expect(ref1).toBe(1);
    expect(ref2).toBe(1);
  });

  test('detects locked file via syncAccessHandle', async ({ page }) => {
    await call(page, 'write', { path: '/locked.bin', b64: bytesToB64([1, 2, 3]), mode: 'replace' });

    // Hold a SyncAccessHandle in a worker
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle('locked.bin');
      const workerSrc = `self.onmessage = async (e) => {
        const sync = await e.data.createSyncAccessHandle();
        self.postMessage('locked');
        await new Promise(r => self.addEventListener('message', m => { if (m.data === 'release') { sync.close(); r(); } }));
      };`;
      const blob = new Blob([workerSrc], { type: 'text/javascript' });
      const w = new Worker(URL.createObjectURL(blob), { type: 'module' });
      await new Promise<void>((res, rej) => {
        w.onmessage = (m) => (m.data === 'locked' ? res() : null);
        w.onerror = (e) => rej(e);
        w.postMessage(fh);
      });
      (window as typeof window & { __holdingWorker?: Worker }).__holdingWorker = w;
    });

    // Stat should report locked: true
    const stat = await call<{ locked: boolean }>(page, 'stat', { path: '/locked.bin' });
    expect(stat.locked).toBe(true);

    // Attempting a write should throw with Locked code
    await expect(
      call(page, 'write', { path: '/locked.bin', b64: bytesToB64([9]), mode: 'replace' }),
    ).rejects.toThrow(/Locked/);

    // Release lock
    await page.evaluate(() => {
      const w = (window as typeof window & { __holdingWorker?: Worker }).__holdingWorker;
      w?.postMessage('release');
      w?.terminate();
    });
  });
});

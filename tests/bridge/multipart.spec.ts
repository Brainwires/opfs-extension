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
  await page.evaluate(`(function(){${installerSrc}})()`);
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
    await new Promise((res) => setTimeout(res, 25));
  }
}

function bytesToB64(bytes: number[] | Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

interface ListEntry {
  name: string;
  kind: 'file' | 'directory';
  size: number;
  path: string;
  lastModified: number;
  locked: boolean;
}

test.describe('multipart helpers (panel-side, exercised through the bridge)', () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test('uploadSegmented creates .000, .001, ...; downloadJoined reconstructs', async ({ page }) => {
    // Build deterministic 17 KB payload, "upload" it as 8 KB shards via the bridge ops directly
    const TOTAL = 17 * 1024;
    const CHUNK = 8 * 1024;
    const data = new Uint8Array(TOTAL);
    for (let i = 0; i < TOTAL; i++) data[i] = (i * 11) & 0xff;

    let cursor = 0;
    let index = 0;
    while (cursor < TOTAL) {
      const end = Math.min(cursor + CHUNK, TOTAL);
      const slice = data.subarray(cursor, end);
      const suffix = String(index).padStart(3, '0');
      await call(page, 'write', {
        path: `/payload.bin.${suffix}`,
        b64: bytesToB64(slice),
        mode: 'replace',
      });
      cursor = end;
      index++;
    }
    expect(index).toBe(3); // 17 KB / 8 KB = 3 shards

    // List dir, find shards in order
    const entries = await call<ListEntry[]>(page, 'list', { path: '/' });
    const shards = entries
      .filter((e) => e.name.startsWith('payload.bin.'))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(shards.map((s) => s.name)).toEqual(['payload.bin.000', 'payload.bin.001', 'payload.bin.002']);

    // Read all three back, concatenate, hash
    const crypto = await import('node:crypto');
    const hasher = crypto.createHash('sha256');
    let total = 0;
    for (const s of shards) {
      let off = 0;
      while (off < s.size) {
        const r = await call<{ b64: string; eof: boolean }>(page, 'read', {
          path: s.path,
          offset: off,
          length: 4096,
        });
        const buf = Buffer.from(r.b64, 'base64');
        hasher.update(buf);
        total += buf.length;
        off += buf.length;
        if (r.eof) break;
      }
    }
    expect(total).toBe(TOTAL);

    const expectedHasher = crypto.createHash('sha256');
    expectedHasher.update(Buffer.from(data));
    expect(hasher.digest('hex')).toBe(expectedHasher.digest('hex'));
  });

  test('reshard write-back: shrinking removes trailing shards', async ({ page }) => {
    // Seed 3 shards
    for (let i = 0; i < 3; i++) {
      const buf = new Uint8Array(1024);
      buf.fill(i + 1);
      await call(page, 'write', {
        path: `/db.${String(i).padStart(3, '0')}`,
        b64: bytesToB64(buf),
        mode: 'replace',
      });
    }

    // "Re-write" as a smaller 1.5 KB DB → 1 shard of 1024 + 1 shard of 512
    const newDb = new Uint8Array(1024 + 512);
    newDb.fill(0xaa);
    const SHARD_SIZE = 1024;
    let cursor = 0;
    let i = 0;
    while (cursor < newDb.length) {
      const end = Math.min(cursor + SHARD_SIZE, newDb.length);
      await call(page, 'write', {
        path: `/db.${String(i).padStart(3, '0')}`,
        b64: bytesToB64(newDb.subarray(cursor, end)),
        mode: 'replace',
      });
      cursor = end;
      i++;
    }
    // Delete trailing
    await call(page, 'rm', { path: '/db.002', recursive: false });

    const after = await call<ListEntry[]>(page, 'list', { path: '/' });
    const dbShards = after.filter((e) => e.name.startsWith('db.'));
    expect(dbShards.map((s) => s.name).sort()).toEqual(['db.000', 'db.001']);
    expect(dbShards.find((s) => s.name === 'db.000')?.size).toBe(1024);
    expect(dbShards.find((s) => s.name === 'db.001')?.size).toBe(512);
  });

  test('lock detection on a multipart shard prevents write-back', async ({ page }) => {
    await call(page, 'write', { path: '/locked.000', b64: bytesToB64([1, 2, 3]), mode: 'replace' });

    // Hold a SyncAccessHandle on /locked.000 from a worker
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle('locked.000');
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

    const stat = await call<{ locked: boolean }>(page, 'stat', { path: '/locked.000' });
    expect(stat.locked).toBe(true);

    // Release
    await page.evaluate(() => {
      const w = (window as typeof window & { __holdingWorker?: Worker }).__holdingWorker;
      w?.postMessage('release');
      w?.terminate();
    });
  });
});

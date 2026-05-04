import installerSrc from './installer.js?raw';
import type { FsError, RpcArgs, RpcOp, RpcResults } from './types';

export class RpcError extends Error {
  code: FsError['code'];
  constructor(err: FsError) {
    super(err.message);
    this.name = 'RpcError';
    this.code = err.code;
  }
}

interface BridgeInfo {
  v: number;
  hasOpfs: boolean;
  origin: string;
}

interface PendingResult {
  pending: true;
}

interface SuccessResult<T> {
  pending: false;
  ok: true;
  value: T;
}

interface FailureResult {
  pending: false;
  ok: false;
  error: FsError;
}

type PollResult<T> = PendingResult | SuccessResult<T> | FailureResult;

const INSTALLER_EXPR = `(function(){${installerSrc}})()`;

function evalRaw<T>(expr: string): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!chrome?.devtools?.inspectedWindow?.eval) {
      reject(new RpcError({ code: 'BridgeNotInstalled', message: 'DevTools API unavailable' }));
      return;
    }
    chrome.devtools.inspectedWindow.eval<T>(expr, (result, exceptionInfo) => {
      if (exceptionInfo && (exceptionInfo.isError || exceptionInfo.isException)) {
        reject(
          new RpcError({
            code: 'Unknown',
            message: exceptionInfo.value || exceptionInfo.description || 'eval failed',
          }),
        );
        return;
      }
      resolve(result as T);
    });
  });
}

let installPromise: Promise<BridgeInfo> | null = null;
let lastInstalledTabId: number | null = null;

async function ensureInstalled(): Promise<BridgeInfo> {
  const tabId = chrome.devtools?.inspectedWindow?.tabId ?? null;
  if (lastInstalledTabId !== tabId) {
    installPromise = null;
    lastInstalledTabId = tabId;
  }
  if (!installPromise) {
    installPromise = (async () => {
      await evalRaw<void>(INSTALLER_EXPR);
      const info = await evalRaw<BridgeInfo | null>('window.__BRAINWIRES_OPFS__ && window.__BRAINWIRES_OPFS__.info()');
      if (!info) {
        installPromise = null;
        throw new RpcError({ code: 'BridgeNotInstalled', message: 'Failed to install bridge in inspected page' });
      }
      return info;
    })().catch((e) => {
      installPromise = null;
      throw e;
    });
  }
  return installPromise;
}

export async function getBridgeInfo(): Promise<BridgeInfo> {
  return ensureInstalled();
}

export function resetBridge(): void {
  installPromise = null;
  lastInstalledTabId = null;
}

const POLL_INTERVAL_MS = 25;
const POLL_BACKOFF_MS = 200;
const POLL_TIMEOUT_MS = 60_000;

async function pollUntilDone<T>(invocationId: number): Promise<T> {
  const start = Date.now();
  let interval = POLL_INTERVAL_MS;
  while (true) {
    const r = await evalRaw<PollResult<T>>(`window.__BRAINWIRES_OPFS__.poll(${invocationId})`);
    if (r && r.pending === false) {
      if (r.ok) return r.value;
      throw new RpcError(r.error);
    }
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new RpcError({ code: 'Unknown', message: 'Op timed out' });
    }
    await new Promise((res) => setTimeout(res, interval));
    if (interval < POLL_BACKOFF_MS) interval = Math.min(interval + 25, POLL_BACKOFF_MS);
  }
}

export async function call<O extends RpcOp>(op: O, args: RpcArgs[O]): Promise<RpcResults[O]> {
  const info = await ensureInstalled();
  if (!info.hasOpfs) {
    throw new RpcError({ code: 'NoOpfs', message: 'OPFS not available on this origin' });
  }
  const argsJson = JSON.stringify(args);
  const invocationId = await evalRaw<number>(
    `window.__BRAINWIRES_OPFS__.invoke(${JSON.stringify(op)}, ${argsJson})`,
  );
  return pollUntilDone<RpcResults[O]>(invocationId);
}

const READ_CHUNK = 4 * 1024 * 1024; // 4 MB per eval round-trip

export async function readFile(
  path: string,
  onProgress?: (read: number, total: number) => void,
): Promise<Uint8Array> {
  const first = await call('read', { path, offset: 0, length: READ_CHUNK });
  const total = first.size;
  onProgress?.(Math.min(READ_CHUNK, total), total);
  const out = new Uint8Array(total);
  let cursor = 0;
  out.set(b64ToBytes(first.b64), cursor);
  cursor += b64ToBytes(first.b64).length;
  while (cursor < total) {
    const chunk = await call('read', { path, offset: cursor, length: READ_CHUNK });
    const bytes = b64ToBytes(chunk.b64);
    out.set(bytes, cursor);
    cursor += bytes.length;
    onProgress?.(cursor, total);
    if (chunk.eof) break;
  }
  return out;
}

const WRITE_CHUNK = 4 * 1024 * 1024;

export async function writeFile(
  path: string,
  data: Uint8Array,
  onProgress?: (written: number, total: number) => void,
): Promise<void> {
  const total = data.length;
  if (total === 0) {
    await call('write', { path, b64: '', mode: 'replace' });
    onProgress?.(0, 0);
    return;
  }
  let cursor = 0;
  while (cursor < total) {
    const end = Math.min(cursor + WRITE_CHUNK, total);
    const slice = data.subarray(cursor, end);
    await call('write', {
      path,
      b64: bytesToB64(slice),
      mode: cursor === 0 ? 'replace' : 'append',
    });
    cursor = end;
    onProgress?.(cursor, total);
  }
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

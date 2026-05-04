// Detection + thin client for rsqlite-wasm's exposeForDevtools() bridge.
//
// When the inspected page calls `exposeForDevtools(db)` from rsqlite-wasm,
// it installs `window.__BRAINWIRES_RSQLITE_DEVTOOLS__` — a synchronous
// invoke()/poll() interface for routing SQL through the page's own
// Database. The panel uses this when it's available so it can edit data
// even while the page actively holds the OPFS SyncAccessHandle.
//
// We talk to the bridge through chrome.devtools.inspectedWindow.eval —
// same transport the OPFS bridge already uses — so the protocol is
// poll-based on this side too.

import type { Database, Row, SqlValue } from 'rsqlite-wasm';

interface ExceptionInfo {
  isException?: boolean;
  isError?: boolean;
  value?: string;
  description?: string;
}

function evalRaw<T>(expr: string): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!chrome?.devtools?.inspectedWindow?.eval) {
      reject(new Error('DevTools API unavailable'));
      return;
    }
    chrome.devtools.inspectedWindow.eval<T>(expr, (result, exceptionInfo) => {
      const ex = exceptionInfo as ExceptionInfo | undefined;
      if (ex && (ex.isException || ex.isError)) {
        reject(new Error(ex.value || ex.description || 'eval failed'));
        return;
      }
      resolve(result as T);
    });
  });
}

export interface BridgeInfo {
  v: number;
  dbs: string[];
}

/** Detect whether the inspected page has called `exposeForDevtools(db)`.
 *  Returns null if no bridge is installed or the page hasn't loaded yet. */
export async function detectBridge(): Promise<BridgeInfo | null> {
  try {
    const result = await evalRaw<{ v: number; dbs: string[] } | null>(
      `(() => {
        const b = window.__BRAINWIRES_RSQLITE_DEVTOOLS__;
        if (!b || typeof b.listDbs !== 'function') return null;
        return { v: b.v, dbs: b.listDbs() };
      })()`,
    );
    return result;
  } catch {
    return null;
  }
}

interface DbInfo {
  name: string;
  changeCounter: number;
  closed: boolean;
}

export async function bridgeInfo(name: string): Promise<DbInfo | null> {
  return evalRaw<DbInfo | null>(
    `window.__BRAINWIRES_RSQLITE_DEVTOOLS__.info(${JSON.stringify(name)})`,
  );
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
  error: { message: string; code?: string };
}
type PollResult<T> = PendingResult | SuccessResult<T> | FailureResult;

const POLL_INTERVAL_MS = 25;
const POLL_TIMEOUT_MS = 30_000;

async function bridgeCall<T>(
  name: string,
  op: 'query' | 'queryOne' | 'exec' | 'execMany',
  sql: string,
  params?: SqlValue[],
): Promise<T> {
  const argsExpr =
    params !== undefined && params.length > 0
      ? `, ${JSON.stringify(params)}`
      : '';
  const id = await evalRaw<number>(
    `window.__BRAINWIRES_RSQLITE_DEVTOOLS__.invoke(` +
      `${JSON.stringify(name)}, ${JSON.stringify(op)}, ${JSON.stringify(sql)}${argsExpr})`,
  );
  const start = Date.now();
  while (true) {
    const r = await evalRaw<PollResult<T>>(
      `window.__BRAINWIRES_RSQLITE_DEVTOOLS__.poll(${id})`,
    );
    if (!r.pending) {
      if (r.ok) return r.value;
      throw new Error(`${r.error.code ?? 'BridgeError'}: ${r.error.message}`);
    }
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error(`bridge call timed out: ${op}`);
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
}

/**
 * Database-shaped proxy that forwards every SQL call through the page's
 * exposeForDevtools bridge. Mimics the rsqlite-wasm `Database` surface so
 * the SqliteViewer can use it interchangeably with a snapshot-loaded
 * Database.
 *
 * NOTE: methods are async here even where the real Database is sync —
 * the bridge transport (inspectedWindow.eval + poll) is fundamentally
 * async, and the SqliteViewer is rewritten to await every call so
 * either flavour works.
 */
export class BridgedDatabase {
  readonly name: string;
  closed = false;

  constructor(name: string) {
    this.name = name;
  }

  async query<T extends Row = Row>(sql: string, params?: SqlValue[]): Promise<T[]> {
    return bridgeCall<T[]>(this.name, 'query', sql, params);
  }

  async queryOne<T extends Row = Row>(
    sql: string,
    params?: SqlValue[],
  ): Promise<T | null> {
    return bridgeCall<T | null>(this.name, 'queryOne', sql, params);
  }

  async exec(sql: string, params?: SqlValue[]): Promise<number> {
    return bridgeCall<number>(this.name, 'exec', sql, params);
  }

  async execMany(sql: string): Promise<void> {
    await bridgeCall<undefined>(this.name, 'execMany', sql);
  }

  /** A bridged db can't toBuffer (the page's Database can but exposing
   *  that is a future enhancement; for now we surface "Save changes" as
   *  immediate on every write since the bridge writes through the live
   *  engine). */
  toBuffer(): Uint8Array {
    throw new Error('toBuffer() is not available for bridged databases');
  }

  flush(): void {
    /* no-op — page-side engine manages its own flushing */
  }

  /** Close the bridge proxy. Doesn't close the page's underlying db —
   *  that's the page's responsibility. */
  close(): void {
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/** Pick a bridged db name to use given (a) the bridge's registered names
 *  and (b) the multipart group name we're trying to view. Tries an exact
 *  match first, then a case-insensitive prefix match (e.g. group `bw-chat.db`
 *  → bridge name `bw-chat`), then falls back to the only registered db if
 *  there's exactly one. Returns null if there's no good match. */
export function chooseBridgedDb(
  bridgeDbs: string[],
  groupBase: string,
): string | null {
  if (bridgeDbs.length === 0) return null;
  if (bridgeDbs.includes(groupBase)) return groupBase;
  // Strip extensions from the group base and try again
  const stripped = groupBase.replace(/\.(db|sqlite|sqlite3)$/i, '');
  if (bridgeDbs.includes(stripped)) return stripped;
  // Case-insensitive prefix match in either direction
  const lcBase = groupBase.toLowerCase();
  const lcStripped = stripped.toLowerCase();
  for (const name of bridgeDbs) {
    const ln = name.toLowerCase();
    if (ln === lcBase || ln === lcStripped) return name;
    if (ln.startsWith(lcStripped) || lcStripped.startsWith(ln)) return name;
  }
  // Last resort: if there's exactly one db registered, use it
  if (bridgeDbs.length === 1) return bridgeDbs[0];
  return null;
}

/** Re-export Database type for callers that want to check structurally. */
export type { Database };

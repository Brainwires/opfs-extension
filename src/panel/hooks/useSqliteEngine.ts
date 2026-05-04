import { useEffect, useRef, useState } from 'react';
import type { Database } from 'rsqlite-wasm';
import { BridgedDatabase, chooseBridgedDb, detectBridge } from '../lib/rsqliteBridge';

/**
 * What backs the SqliteViewer's in-memory database.
 *  - 'live': page exposed its own Database via exposeForDevtools(). All
 *            queries route through the page's engine — fully read/write,
 *            even while the page holds the OPFS handle.
 *  - 'snapshot': page hasn't (or can't) expose its db; we loaded the
 *                bytes ourselves and instantiate a fresh Database from
 *                them. Read works, writes will conflict with the page's
 *                handle if there is one.
 */
export type EngineMode = 'live' | 'snapshot';

interface State {
  db: Database | BridgedDatabase | null;
  mode: EngineMode | null;
  /** Name of the bridged db when mode='live'; null when mode='snapshot'. */
  bridgedName: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Lazy-loads rsqlite-wasm and either:
 *  - returns a `BridgedDatabase` when the inspected page has called
 *    `exposeForDevtools(db)` (live mode), or
 *  - opens a fresh in-memory Database from the supplied snapshot bytes
 *    (snapshot mode).
 *
 * The returned `db` interface is uniform — both shapes implement
 * `query/queryOne/exec/execMany`. The SqliteViewer uses it transparently.
 */
export function useSqliteEngine(
  bytes: Uint8Array | null,
  groupBase: string | null,
): State {
  const [state, setState] = useState<State>({
    db: null,
    mode: null,
    bridgedName: null,
    loading: false,
    error: null,
  });
  const ownedRef = useRef<Database | BridgedDatabase | null>(null);

  useEffect(() => {
    if (!bytes && !groupBase) {
      if (ownedRef.current) {
        try {
          ownedRef.current.close();
        } catch {
          /* ignore */
        }
        ownedRef.current = null;
      }
      setState({
        db: null,
        mode: null,
        bridgedName: null,
        loading: false,
        error: null,
      });
      return undefined;
    }

    let cancelled = false;
    setState({
      db: null,
      mode: null,
      bridgedName: null,
      loading: true,
      error: null,
    });

    (async () => {
      try {
        // Step 1: try the page-side bridge first. Live mode beats snapshot
        // when both are available.
        if (groupBase) {
          const info = await detectBridge();
          if (info && info.dbs.length > 0) {
            const picked = chooseBridgedDb(info.dbs, groupBase);
            if (picked) {
              if (cancelled) return;
              const db = new BridgedDatabase(picked);
              ownedRef.current = db;
              setState({
                db,
                mode: 'live',
                bridgedName: picked,
                loading: false,
                error: null,
              });
              return;
            }
          }
        }

        // Step 2: snapshot mode. Need bytes for this.
        if (!bytes) {
          throw new Error('No bridge available and no snapshot bytes loaded');
        }
        const mod = await import('rsqlite-wasm');
        const glueUrl = new URL(
          import.meta.env.DEV
            ? '/node_modules/rsqlite-wasm/dist/wasm/rsqlite_wasm.js'
            : './rsqlite-wasm/rsqlite_wasm.js',
          window.location.origin === 'null' ? document.baseURI : window.location.href,
        );
        await mod.initWasm(glueUrl);
        const db = await mod.Database.fromBuffer(bytes);
        if (cancelled) {
          db.close();
          return;
        }
        ownedRef.current = db;
        setState({
          db,
          mode: 'snapshot',
          bridgedName: null,
          loading: false,
          error: null,
        });
      } catch (e) {
        if (cancelled) return;
        setState({
          db: null,
          mode: null,
          bridgedName: null,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => {
      cancelled = true;
      if (ownedRef.current) {
        try {
          ownedRef.current.close();
        } catch {
          /* ignore */
        }
        ownedRef.current = null;
      }
    };
  }, [bytes, groupBase]);

  return state;
}

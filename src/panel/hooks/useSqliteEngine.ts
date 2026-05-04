import { useEffect, useRef, useState } from 'react';
import type { Database } from 'rsqlite-wasm';

interface State {
  db: Database | null;
  loading: boolean;
  error: string | null;
}

/**
 * Lazy-loads rsqlite-wasm on first use, then opens a fresh in-memory Database
 * from the supplied bytes. Disposes the Database when the bytes change or the
 * component unmounts.
 */
export function useSqliteEngine(bytes: Uint8Array | null): State {
  const [state, setState] = useState<State>({ db: null, loading: false, error: null });
  const ownedRef = useRef<Database | null>(null);

  useEffect(() => {
    if (!bytes) {
      // close any existing
      if (ownedRef.current) {
        try {
          ownedRef.current.close();
        } catch {
          // ignore double-close
        }
        ownedRef.current = null;
      }
      setState({ db: null, loading: false, error: null });
      return undefined;
    }

    let cancelled = false;
    setState({ db: null, loading: true, error: null });
    (async () => {
      try {
        const mod = await import('rsqlite-wasm');
        // The wasm-pack glue + .wasm are copied to dist/rsqlite-wasm/ by vite-plugin-static-copy.
        // We pass the absolute extension URL of the JS glue so rsqlite-wasm dynamic-imports it
        // from a stable, bundled location (its sibling .wasm is fetched via import.meta.url).
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
        setState({ db, loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        setState({ db: null, loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();

    return () => {
      cancelled = true;
      if (ownedRef.current) {
        try {
          ownedRef.current.close();
        } catch {
          // ignore
        }
        ownedRef.current = null;
      }
    };
  }, [bytes]);

  return state;
}

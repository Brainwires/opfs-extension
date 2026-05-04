import { useEffect, useMemo, useState } from 'react';
import { Database, Loader2, Play, Table as TableIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';

interface SqlDb {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  close(): void;
}

interface SqlJs {
  Database: new (data?: Uint8Array) => SqlDb;
}

const PAGE_SIZE = 100;

export function SqliteViewer({ bytes }: { bytes: Uint8Array }) {
  const [SQL, setSQL] = useState<SqlJs | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [tables, setTables] = useState<{ name: string; type: string; sql: string }[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowCount, setRowCount] = useState(0);
  const [rows, setRows] = useState<{ columns: string[]; values: unknown[][] } | null>(null);
  const [adhocSql, setAdhocSql] = useState('');
  const [adhocResult, setAdhocResult] = useState<{ columns: string[]; values: unknown[][] } | null>(
    null,
  );
  const [adhocError, setAdhocError] = useState<string | null>(null);

  const db = useMemo<SqlDb | null>(() => {
    if (!SQL) return null;
    try {
      return new SQL.Database(bytes);
    } catch (e) {
      setLoadingError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [SQL, bytes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initSqlJsMod = await import('sql.js');
        // Resolve the wasm file URL via Vite
        const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
        const initSqlJs = (initSqlJsMod as unknown as { default: (cfg: { locateFile: () => string }) => Promise<SqlJs> }).default;
        const lib = await initSqlJs({ locateFile: () => wasmUrl });
        if (!cancelled) setSQL(lib);
      } catch (e) {
        if (!cancelled) setLoadingError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!db) return;
    try {
      const r = db.exec(
        "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
      );
      const list = (r[0]?.values ?? []).map((row) => ({
        name: row[0] as string,
        type: row[1] as string,
        sql: (row[2] as string) ?? '',
      }));
      setTables(list);
      if (list.length && !activeTable) setActiveTable(list[0].name);
    } catch (e) {
      setLoadingError(e instanceof Error ? e.message : String(e));
    }
  }, [db, activeTable]);

  useEffect(() => {
    if (!db || !activeTable) return;
    try {
      const cnt = db.exec(`SELECT COUNT(*) FROM "${activeTable}"`);
      setRowCount((cnt[0]?.values[0]?.[0] as number) ?? 0);
      const r = db.exec(
        `SELECT * FROM "${activeTable}" LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`,
      );
      setRows(r[0] ?? { columns: [], values: [] });
    } catch (e) {
      setRows(null);
      setLoadingError(e instanceof Error ? e.message : String(e));
    }
  }, [db, activeTable, page]);

  useEffect(() => () => db?.close(), [db]);

  const runAdhoc = () => {
    if (!db || !adhocSql.trim()) return;
    try {
      setAdhocError(null);
      const r = db.exec(adhocSql);
      setAdhocResult(r[0] ?? { columns: [], values: [] });
    } catch (e) {
      setAdhocResult(null);
      setAdhocError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loadingError) {
    return (
      <div className="p-6 text-sm">
        <p className="text-destructive font-medium mb-2">SQLite parsing failed</p>
        <p className="text-muted-foreground text-xs">{loadingError}</p>
      </div>
    );
  }

  if (!SQL || !db) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading sql.js…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-56 border-r border-border overflow-auto bg-muted/10">
        <div className="px-2 py-2 text-[10px] uppercase tracking-wide text-muted-foreground/70 flex items-center gap-1">
          <Database className="h-3 w-3" /> Tables
        </div>
        {tables.map((t) => (
          <button
            key={t.name}
            onClick={() => {
              setActiveTable(t.name);
              setPage(0);
            }}
            className={cn(
              'flex w-full items-center gap-1.5 px-2 py-1 text-xs text-left hover:bg-accent/40',
              activeTable === t.name && 'bg-accent text-accent-foreground',
            )}
          >
            <TableIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{t.name}</span>
            {t.type === 'view' && (
              <span className="ml-auto text-[9px] uppercase text-muted-foreground/60">view</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
          <span className="text-xs font-mono">{activeTable}</span>
          <span className="text-xs text-muted-foreground">{rowCount} rows</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            ‹ Prev
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rowCount)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={(page + 1) * PAGE_SIZE >= rowCount}
            onClick={() => setPage(page + 1)}
          >
            Next ›
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          {rows && <ResultTable result={rows} />}
        </div>
        <div className="border-t border-border p-2 bg-muted/10">
          <div className="flex gap-2">
            <Input
              value={adhocSql}
              onChange={(e) => setAdhocSql(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runAdhoc();
              }}
              placeholder={`SELECT * FROM ${activeTable ?? 'table'} WHERE …`}
              className="font-mono"
            />
            <Button size="sm" onClick={runAdhoc} className="gap-1">
              <Play className="h-3.5 w-3.5" />
              Run
            </Button>
          </div>
          {adhocError && <div className="mt-2 text-xs text-destructive">{adhocError}</div>}
          {adhocResult && (
            <div className="mt-2 max-h-40 overflow-auto border border-border rounded">
              <ResultTable result={adhocResult} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultTable({ result }: { result: { columns: string[]; values: unknown[][] } }) {
  return (
    <table className="w-full text-xs font-mono">
      <thead className="sticky top-0 bg-muted/40 z-10">
        <tr>
          {result.columns.map((c) => (
            <th
              key={c}
              className="text-left px-2 py-1 font-medium border-b border-border whitespace-nowrap"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.values.map((row, ri) => (
          <tr key={ri} className="hover:bg-accent/30">
            {row.map((v, ci) => (
              <td
                key={ci}
                className="px-2 py-0.5 border-b border-border/40 whitespace-nowrap text-muted-foreground"
                title={v == null ? 'NULL' : String(v)}
              >
                {v == null ? <em className="text-muted-foreground/50">NULL</em> : String(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

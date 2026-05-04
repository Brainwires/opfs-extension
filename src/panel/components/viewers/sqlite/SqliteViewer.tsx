import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { toast } from 'sonner';
import type { Row, SqlValue } from 'rsqlite-wasm';
import { useSqliteEngine } from '../../../hooks/useSqliteEngine';
import { useStore } from '../../../state/store';
import {
  cleanupBareLeftover,
  loadGroup,
  reshardAndWrite,
  type MultipartGroup,
} from '../../../lib/multipart';
import { downloadAs } from '../../../lib/sqlExport';
import { cn } from '../../../lib/utils';
import { Header } from './Header';
import { SchemaTree, readSchema, type SchemaSnapshot } from './SchemaTree';
import { DataGrid } from './DataGrid';
import { ResultGrid } from './ResultGrid';
import { QueryConsole } from './QueryConsole';
import { ExportMenu } from './ExportMenu';
import { ExplainPanel } from './ExplainPanel';

interface InnerTab {
  id: string;
  kind: 'table' | 'query' | 'explain';
  label: string;
  table?: string;
  sql?: string;
  rows?: Row[];
  columns?: string[];
  ranAt?: number;
  filter?: { column: string; value: SqlValue };
}

interface Props {
  group: MultipartGroup;
}

export function SqliteViewer({ group }: Props) {
  const refreshAllOpfs = useStore((s) => s.refreshAll);
  const reloadAncestor = useStore((s) => s.reloadAncestor);

  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ read: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { db, loading: engineLoading, error: engineError } = useSqliteEngine(bytes);
  const [schema, setSchema] = useState<SchemaSnapshot | null>(null);

  const [tabs, setTabs] = useState<InnerTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const consoleSqlRef = useRef('SELECT 1');

  // Load shards
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setBytes(null);
    setLoadProgress(null);
    (async () => {
      try {
        const data = await loadGroup(group, (read, total) => {
          if (!cancelled) setLoadProgress({ read, total });
        });
        if (!cancelled) setBytes(data);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [group, reloadKey]);

  // Read schema once db is ready
  useEffect(() => {
    if (!db) {
      setSchema(null);
      return;
    }
    try {
      setSchema(readSchema(db));
    } catch (e) {
      console.error(e);
    }
  }, [db, reloadKey]);

  // Open the first table by default once schema lands
  useEffect(() => {
    if (!schema || tabs.length > 0) return;
    const firstTable = schema.tables.find((t) => t.type === 'table');
    if (firstTable) {
      const tab: InnerTab = {
        id: `table:${firstTable.name}`,
        kind: 'table',
        label: firstTable.name,
        table: firstTable.name,
      };
      setTabs([tab]);
      setActiveId(tab.id);
    }
  }, [schema, tabs.length]);

  const openTable = useCallback((name: string, filter?: InnerTab['filter']) => {
    setTabs((prev) => {
      const id = filter ? `table:${name}:${filter.column}=${String(filter.value)}` : `table:${name}`;
      const existing = prev.find((t) => t.id === id);
      if (existing) {
        setActiveId(existing.id);
        return prev;
      }
      const tab: InnerTab = {
        id,
        kind: 'table',
        label: filter ? `${name} (${filter.column}=${String(filter.value)})` : name,
        table: name,
        ...(filter ? { filter } : {}),
      };
      setActiveId(tab.id);
      return [...prev, tab];
    });
  }, []);

  const runQuery = useCallback(
    (sql: string) => {
      if (!db) return;
      consoleSqlRef.current = sql;
      const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(sql);
      const id = `query:${Date.now()}`;
      try {
        let rows: Row[] = [];
        let mutating = false;
        if (isSelect) {
          rows = db.query<Row>(sql);
        } else {
          // DDL/DML: execMany so semicolons split
          db.execMany(sql);
          mutating = true;
        }
        const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
        const tab: InnerTab = {
          id,
          kind: 'query',
          label: sql.split('\n')[0].slice(0, 32) + (sql.length > 32 ? '…' : ''),
          sql,
          rows,
          columns: cols,
          ranAt: Date.now(),
        };
        setTabs((prev) => [...prev, tab]);
        setActiveId(id);
        if (mutating) {
          setDirty(true);
          // refresh schema (in case DDL changed it)
          setSchema(readSchema(db));
        }
        toast.success(
          isSelect
            ? `${rows.length.toLocaleString()} ${rows.length === 1 ? 'row' : 'rows'}`
            : 'Statement executed (uncommitted)',
          { duration: 1500 },
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [db],
  );

  const runExplain = useCallback(
    (sql: string) => {
      if (!db || !sql.trim()) return;
      const id = `explain:${Date.now()}`;
      const tab: InnerTab = {
        id,
        kind: 'explain',
        label: `EXPLAIN ${sql.slice(0, 24)}…`,
        sql,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveId(id);
    },
    [db],
  );

  const insertSnippet = useCallback((snippet: string) => {
    consoleSqlRef.current = consoleSqlRef.current
      ? `${consoleSqlRef.current.replace(/;$/, '')} ${snippet}`
      : snippet;
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveId((curr) => {
        if (curr !== id) return curr;
        return next[next.length - 1]?.id ?? null;
      });
      return next;
    });
  }, []);

  const onFkClick = useCallback(
    (toTable: string, toColumn: string, value: SqlValue) => {
      openTable(toTable, { column: toColumn, value });
    },
    [openTable],
  );

  const onRowEdited = useCallback(() => {
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!db || !dirty) return;
    setSaving(true);
    try {
      const buf = db.toBuffer();
      const result = await reshardAndWrite(group, buf);
      setDirty(false);
      toast.success(
        `Saved · ${result.shardsWritten} shard${result.shardsWritten === 1 ? '' : 's'}` +
          (result.shardsRemoved ? `, removed ${result.shardsRemoved}` : ''),
      );
      // Tree might need to refresh
      await reloadAncestor(group.shards[0].path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [db, dirty, group, reloadAncestor]);

  const handleRefresh = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved changes and reload?')) return;
    setDirty(false);
    setTabs([]);
    setActiveId(null);
    setReloadKey((k) => k + 1);
    void refreshAllOpfs();
  }, [dirty, refreshAllOpfs]);

  const handleExportSqlite = useCallback(() => {
    if (!db) return;
    try {
      const buf = db.toBuffer();
      downloadAs(buf, `${group.base.replace(/\.\d+$/, '')}.sqlite`, 'application/vnd.sqlite3');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [db, group.base]);

  const handleCleanupBare = useCallback(async () => {
    if (!group.bareLeftover) return;
    if (!window.confirm(`Delete stale legacy file ${group.bareLeftover.path}?`)) return;
    try {
      await cleanupBareLeftover(group);
      toast.success('Cleaned up');
      await reloadAncestor(group.bareLeftover.path);
      handleRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [group, handleRefresh, reloadAncestor]);

  // ⌘S to save
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        if (dirty && !saving) void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, handleSave]);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  if (loadError || engineError) {
    return (
      <div className="p-6 text-sm">
        <p className="text-destructive font-medium mb-1">Couldn't load database</p>
        <p className="text-muted-foreground text-xs">{loadError ?? engineError}</p>
      </div>
    );
  }

  if (!bytes || engineLoading || !db) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">
          {!bytes
            ? loadProgress && loadProgress.total > 0
              ? `Reading ${group.base}… ${Math.round((loadProgress.read / loadProgress.total) * 100)}%`
              : `Reading ${group.base}…`
            : 'Booting rsqlite-wasm…'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <Header
        group={group}
        dirty={dirty}
        saving={saving}
        onRefresh={handleRefresh}
        onExportSqlite={handleExportSqlite}
        onSave={handleSave}
        onCleanupBare={group.bareLeftover ? handleCleanupBare : null}
      />
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={22} minSize={12} maxSize={45} className="border-r border-border">
            <SchemaTree
              db={db}
              onOpenTable={openTable}
              onInsertSnippet={insertSnippet}
              selectedTable={activeTab?.table}
              refreshKey={reloadKey + (dirty ? 1 : 0)}
            />
          </Panel>
          <PanelResizeHandle className="w-px bg-border data-[resize-handle-state=hover]:bg-primary" />
          <Panel minSize={30}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={65} minSize={20}>
                <div className="flex flex-col h-full min-h-0">
                  <InnerTabs
                    tabs={tabs}
                    activeId={activeId}
                    onSelect={setActiveId}
                    onClose={closeTab}
                  />
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {!activeTab && (
                      <div className="p-6 text-sm text-muted-foreground">
                        Pick a table on the left or run a query below.
                      </div>
                    )}
                    {activeTab?.kind === 'table' && schema && activeTab.table && (
                      <TableTabContent
                        // Force a fresh mount on every tab switch so per-tab
                        // useState (rows, filters, sort, page) doesn't leak
                        // between tables. The previous behaviour reused the
                        // component instance and the stale rows array bled
                        // into the next table's render.
                        key={activeTab.id}
                        db={db}
                        tableName={activeTab.table}
                        schema={schema}
                        filter={activeTab.filter}
                        onFkClick={onFkClick}
                        onRowEdited={onRowEdited}
                        refreshKey={reloadKey + (dirty ? 1 : 0)}
                      />
                    )}
                    {activeTab?.kind === 'query' && activeTab.rows && activeTab.columns && (
                      <div className="flex flex-col h-full">
                        <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/10 text-[11px]">
                          <span className="text-muted-foreground tabular-nums">
                            {activeTab.rows.length.toLocaleString()} rows
                          </span>
                          <div className="flex-1" />
                          <ExportMenu
                            rows={activeTab.rows}
                            columns={activeTab.columns}
                            baseName="query"
                          />
                        </div>
                        <div className="flex-1 min-h-0">
                          <ResultGrid rows={activeTab.rows} columns={activeTab.columns} />
                        </div>
                      </div>
                    )}
                    {activeTab?.kind === 'explain' && activeTab.sql && (
                      <ExplainPanel db={db} sql={activeTab.sql} />
                    )}
                  </div>
                </div>
              </Panel>
              <PanelResizeHandle className="h-px bg-border data-[resize-handle-state=hover]:bg-primary" />
              <Panel defaultSize={35} minSize={15}>
                <QueryConsole
                  initialSql={consoleSqlRef.current}
                  schema={schema}
                  onRun={runQuery}
                  onExplain={runExplain}
                />
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function InnerTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: InnerTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex border-b border-border bg-muted/20 overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            'group flex items-center gap-1.5 h-7 px-3 text-xs cursor-default border-r border-border min-w-0',
            activeId === tab.id
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:bg-accent/30',
          )}
        >
          <span className="truncate max-w-[180px]" title={tab.label}>
            {tab.label}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            className="opacity-50 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function TableTabContent({
  db,
  tableName,
  schema,
  filter,
  onFkClick,
  onRowEdited,
  refreshKey,
}: {
  db: import('rsqlite-wasm').Database;
  tableName: string;
  schema: SchemaSnapshot;
  filter: InnerTab['filter'];
  onFkClick: (toTable: string, toColumn: string, value: SqlValue) => void;
  onRowEdited: () => void;
  refreshKey: number;
}) {
  const table = schema.tables.find((t) => t.name === tableName);
  if (!table) return <div className="p-3 text-xs text-destructive">Table not found</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/10 text-[11px]">
        <span className="font-mono">{tableName}</span>
        <span className="text-muted-foreground">{table.rowCount.toLocaleString()} rows</span>
        {filter && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-purple-500">
              {filter.column} = {String(filter.value)}
            </span>
          </>
        )}
        <div className="flex-1" />
        <ExportMenu
          rows={[]}
          columns={table.columns.map((c) => c.name)}
          baseName={tableName}
          insertTable={tableName}
        />
      </div>
      <div className="flex-1 min-h-0">
        <DataGrid
          db={db}
          table={table}
          {...(filter ? { initialEqualityFilter: filter } : {})}
          onFkClick={onFkClick}
          onRowEdited={onRowEdited}
          refreshKey={refreshKey}
        />
      </div>
    </div>
  );
}

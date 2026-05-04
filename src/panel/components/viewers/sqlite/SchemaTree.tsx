import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Database as DatabaseIcon,
  Eye,
  FileCode2,
  Hash,
  Key,
  KeyRound,
  Layers,
  Table as TableIcon,
  Zap,
} from 'lucide-react';
import type { Database, Row } from 'rsqlite-wasm';
import { cn } from '../../../lib/utils';

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  pk: number;
  defaultValue: string | null;
}

interface FkInfo {
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface TableSchema {
  name: string;
  type: 'table' | 'view';
  columns: ColumnInfo[];
  fks: FkInfo[];
  rowCount: number;
}

export interface SchemaSnapshot {
  tables: TableSchema[];
  indexes: Array<{ name: string; tableName: string; sql: string }>;
  triggers: Array<{ name: string; tableName: string; sql: string }>;
  pragmas: Record<string, string | number>;
}

export function readSchema(db: Database): SchemaSnapshot {
  const tablesAndViews = db.query<Row>(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  const tables: TableSchema[] = tablesAndViews.map((row) => {
    const name = String(row.name);
    const type = row.type === 'view' ? 'view' : 'table';
    const cols = db.query<Row>(`PRAGMA table_info("${name.replace(/"/g, '""')}")`);
    const columns: ColumnInfo[] = cols.map((c) => ({
      cid: Number(c.cid),
      name: String(c.name),
      type: String(c.type ?? ''),
      notNull: Boolean(Number(c.notnull)),
      pk: Number(c.pk),
      defaultValue: c.dflt_value === null ? null : String(c.dflt_value),
    }));
    let fks: FkInfo[] = [];
    try {
      const fkRows = db.query<Row>(`PRAGMA foreign_key_list("${name.replace(/"/g, '""')}")`);
      fks = fkRows.map((f) => ({
        fromColumn: String(f.from),
        toTable: String(f.table),
        toColumn: String(f.to),
      }));
    } catch {
      // PRAGMA foreign_key_list may not be supported on views
    }
    let rowCount = 0;
    try {
      const r = db.queryOne<Row>(`SELECT COUNT(*) AS c FROM "${name.replace(/"/g, '""')}"`);
      rowCount = Number(r?.c ?? 0);
    } catch {
      // some views fail to count
    }
    return { name, type, columns, fks, rowCount };
  });

  const indexes = db
    .query<Row>(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name",
    )
    .map((r) => ({ name: String(r.name), tableName: String(r.tbl_name), sql: String(r.sql ?? '') }));

  const triggers = db
    .query<Row>(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name",
    )
    .map((r) => ({ name: String(r.name), tableName: String(r.tbl_name), sql: String(r.sql ?? '') }));

  const pragmas: Record<string, string | number> = {};
  for (const key of [
    'page_size',
    'page_count',
    'journal_mode',
    'user_version',
    'schema_version',
    'auto_vacuum',
    'foreign_keys',
    'cache_size',
  ]) {
    try {
      const r = db.queryOne<Row>(`PRAGMA ${key}`);
      if (r) {
        const v = Object.values(r)[0] as string | number;
        pragmas[key] = v;
      }
    } catch {
      // ignore
    }
  }

  return { tables, indexes, triggers, pragmas };
}

interface Props {
  db: Database;
  onOpenTable: (name: string) => void;
  onInsertSnippet: (snippet: string) => void;
  selectedTable?: string;
  refreshKey: number;
}

export function SchemaTree({ db, onOpenTable, onInsertSnippet, selectedTable, refreshKey }: Props) {
  const [schema, setSchema] = useState<SchemaSnapshot | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tables: true,
    views: true,
    indexes: false,
    triggers: false,
    pragmas: false,
  });
  const [openTables, setOpenTables] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      setSchema(readSchema(db));
    } catch (e) {
      // surface via empty schema
      console.error('readSchema failed', e);
      setSchema({ tables: [], indexes: [], triggers: [], pragmas: {} });
    }
  }, [db, refreshKey]);

  if (!schema) {
    return <div className="p-3 text-xs text-muted-foreground">Reading schema…</div>;
  }

  const tables = schema.tables.filter((t) => t.type === 'table');
  const views = schema.tables.filter((t) => t.type === 'view');

  const toggleSection = (k: string) => setOpenSections((s) => ({ ...s, [k]: !s[k] }));
  const toggleTable = (name: string) =>
    setOpenTables((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="overflow-auto h-full text-xs">
      <Section
        label={`Tables (${tables.length})`}
        icon={<TableIcon className="h-3 w-3" />}
        open={openSections.tables}
        onToggle={() => toggleSection('tables')}
      >
        {tables.map((t) => (
          <TableNode
            key={t.name}
            table={t}
            open={openTables.has(t.name)}
            onToggle={() => toggleTable(t.name)}
            selected={selectedTable === t.name}
            onOpen={() => onOpenTable(t.name)}
            onInsertSnippet={onInsertSnippet}
          />
        ))}
      </Section>

      {views.length > 0 && (
        <Section
          label={`Views (${views.length})`}
          icon={<Eye className="h-3 w-3" />}
          open={openSections.views}
          onToggle={() => toggleSection('views')}
        >
          {views.map((t) => (
            <TableNode
              key={t.name}
              table={t}
              open={openTables.has(t.name)}
              onToggle={() => toggleTable(t.name)}
              selected={selectedTable === t.name}
              onOpen={() => onOpenTable(t.name)}
              onInsertSnippet={onInsertSnippet}
            />
          ))}
        </Section>
      )}

      <Section
        label={`Indexes (${schema.indexes.length})`}
        icon={<Layers className="h-3 w-3" />}
        open={openSections.indexes}
        onToggle={() => toggleSection('indexes')}
      >
        {schema.indexes.map((ix) => (
          <div
            key={ix.name}
            className="px-3 py-0.5 text-muted-foreground hover:bg-accent/40 cursor-default truncate"
            title={ix.sql || `${ix.tableName}: ${ix.name}`}
          >
            <span className="text-amber-500/80">{ix.name}</span>
            <span className="ml-1 text-muted-foreground/60">on {ix.tableName}</span>
          </div>
        ))}
      </Section>

      <Section
        label={`Triggers (${schema.triggers.length})`}
        icon={<Zap className="h-3 w-3" />}
        open={openSections.triggers}
        onToggle={() => toggleSection('triggers')}
      >
        {schema.triggers.map((t) => (
          <div
            key={t.name}
            className="px-3 py-0.5 text-muted-foreground hover:bg-accent/40 cursor-default truncate"
            title={t.sql}
          >
            <span className="text-rose-500/80">{t.name}</span>
            <span className="ml-1 text-muted-foreground/60">on {t.tableName}</span>
          </div>
        ))}
      </Section>

      <Section
        label="Pragmas"
        icon={<DatabaseIcon className="h-3 w-3" />}
        open={openSections.pragmas}
        onToggle={() => toggleSection('pragmas')}
      >
        {Object.entries(schema.pragmas).map(([k, v]) => (
          <div key={k} className="flex justify-between px-3 py-0.5 text-muted-foreground">
            <span>{k}</span>
            <span className="text-foreground tabular-nums">{String(v)}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({
  label,
  icon,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70 hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        {icon}
        <span className="ml-1">{label}</span>
      </button>
      {open && children}
    </div>
  );
}

function TableNode({
  table,
  open,
  onToggle,
  selected,
  onOpen,
  onInsertSnippet,
}: {
  table: TableSchema;
  open: boolean;
  onToggle: () => void;
  selected: boolean;
  onOpen: () => void;
  onInsertSnippet: (s: string) => void;
}) {
  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 px-2 py-0.5 hover:bg-accent/40 cursor-default',
          selected && 'bg-accent text-accent-foreground',
        )}
      >
        <button
          onClick={onToggle}
          className="text-muted-foreground/70 hover:text-foreground"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        </button>
        <button onClick={onOpen} className="flex-1 text-left truncate">
          {table.type === 'view' ? (
            <Eye className="inline h-3 w-3 mr-1 text-emerald-500/80" />
          ) : (
            <TableIcon className="inline h-3 w-3 mr-1 text-sky-500/80" />
          )}
          <span className="font-medium">{table.name}</span>
          <span className="ml-2 text-muted-foreground/70 text-[10px] tabular-nums">
            {table.rowCount.toLocaleString()}
          </span>
        </button>
      </div>
      {open && (
        <div className="pl-7 pb-1">
          {table.columns.map((c) => (
            <div
              key={c.cid}
              className="flex items-center gap-1.5 px-1 py-px text-[11px] hover:bg-accent/30"
              onDoubleClick={() => onInsertSnippet(c.name)}
              title={`${c.type || 'ANY'}${c.notNull ? ' NOT NULL' : ''}${c.defaultValue !== null ? ` DEFAULT ${c.defaultValue}` : ''}`}
            >
              {c.pk > 0 ? (
                <Key className="h-3 w-3 text-amber-500/80 shrink-0" />
              ) : table.fks.some((fk) => fk.fromColumn === c.name) ? (
                <KeyRound className="h-3 w-3 text-purple-500/80 shrink-0" />
              ) : (
                <Hash className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              )}
              <span className="truncate">{c.name}</span>
              <span className="ml-auto text-muted-foreground/60">{c.type || ''}</span>
              {c.notNull && <span className="text-rose-500/70 text-[9px]">!</span>}
            </div>
          ))}
          {table.fks.length > 0 && (
            <div className="mt-1 pl-1 text-[10px] text-muted-foreground/60">
              <FileCode2 className="inline h-2.5 w-2.5" /> FKs
              {table.fks.map((fk) => (
                <div key={fk.fromColumn + fk.toTable} className="ml-3 truncate">
                  {fk.fromColumn} → {fk.toTable}.{fk.toColumn}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

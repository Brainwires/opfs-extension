import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import type { Database, Row, SqlValue } from 'rsqlite-wasm';
import { Button } from '../../ui/button';
import { renderCell } from './cellRenderers';
import { cn } from '../../../lib/utils';
import { qident } from '../../../lib/sqlIdent';
import type { TableSchema } from './SchemaTree';

const PAGE_SIZE = 100;

interface Props {
  db: Database;
  table: TableSchema;
  /** Optional initial filter: e.g. for FK click-through, prefill `{ column, value }`
   *  as a strict-equality WHERE condition instead of a LIKE. */
  initialEqualityFilter?: { column: string; value: SqlValue };
  onFkClick: (toTable: string, toColumn: string, value: SqlValue) => void;
  onRowEdited: () => void;
  refreshKey: number;
}

export function DataGrid({
  db,
  table,
  initialEqualityFilter,
  onFkClick,
  onRowEdited,
  refreshKey,
}: Props) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [lastSql, setLastSql] = useState<string>('');

  // Reset page when table or filters/sort change
  useEffect(() => setPage(0), [table.name, filters, sort]);
  // Reset filters/sort/rows when the table itself changes — if the parent
  // reuses this DataGrid instance across different tables, stale state from
  // the previous table must not bleed into the new query.
  useEffect(() => {
    setFilters({});
    setSort(null);
    setRows([]);
    setTotalRows(0);
    setLastSql('');
  }, [table.name]);

  const filterClause = useMemo(() => {
    const parts: string[] = [];
    const params: SqlValue[] = [];
    if (initialEqualityFilter) {
      parts.push(`${qident(initialEqualityFilter.column)} = ?`);
      params.push(initialEqualityFilter.value);
    }
    for (const [col, val] of Object.entries(filters)) {
      if (!val) continue;
      parts.push(`${qident(col)} LIKE ?`);
      params.push(`%${val}%`);
    }
    return parts.length ? { sql: 'WHERE ' + parts.join(' AND '), params } : { sql: '', params: [] };
  }, [filters, initialEqualityFilter]);

  const orderClause = sort ? ` ORDER BY ${qident(sort.col)} ${sort.dir.toUpperCase()}` : '';

  useEffect(() => {
    setLoading(true);
    setError(null);
    try {
      const tname = qident(table.name);
      const offset = page * PAGE_SIZE;
      // Don't trust COUNT(*) AS c — alias preservation has been a portability gotcha.
      // Read the value out of the first column regardless of its key name.
      const countSql = `SELECT COUNT(*) FROM ${tname} ${filterClause.sql}`;
      const cnt = db.queryOne<Row>(countSql, filterClause.params as SqlValue[]);
      const cntFirst = cnt ? Object.values(cnt)[0] : 0;
      setTotalRows(Number(cntFirst ?? 0));
      const selectSql = `SELECT * FROM ${tname} ${filterClause.sql}${orderClause} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
      setLastSql(selectSql);
      const r = db.query<Row>(selectSql, filterClause.params as SqlValue[]);
      setRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [db, table.name, filterClause, orderClause, page, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  // PK detection: walk schema columns by descending pk priority. Composite
  // PKs (multi-column) get the FIRST one as the inline-edit anchor — good
  // enough; tables without any PK fall back to no inline editing.
  const pkCol =
    table.columns
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)[0]?.name ?? null;
  // Display columns: ALWAYS derive from the actual returned row's keys when
  // rows exist, so cell lookups never mismatch schema-vs-result column names
  // (case differences, alias-stripped expressions, qualified vs bare, etc.).
  // Augment with type info from the schema where available. Only fall back
  // to schema columns when there are no rows yet (header-only render).
  const displayColumns = useMemo<{ name: string; type: string }[]>(() => {
    if (rows.length > 0) {
      const schemaByName = new Map(
        table.columns.map((c) => [c.name.toLowerCase(), c]),
      );
      return Object.keys(rows[0]).map((name) => {
        const sc = schemaByName.get(name.toLowerCase());
        return { name, type: sc?.type ?? '' };
      });
    }
    return table.columns.map((c) => ({ name: c.name, type: c.type }));
  }, [rows, table.columns]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead className="sticky top-0 bg-muted/60 backdrop-blur z-10">
            <tr>
              {displayColumns.map((c) => (
                <th
                  key={c.name}
                  className="text-left px-2 py-1 font-medium border-b border-border whitespace-nowrap"
                >
                  <button
                    onClick={() => {
                      setSort((s) => {
                        if (s?.col === c.name) return s.dir === 'asc' ? { col: c.name, dir: 'desc' } : null;
                        return { col: c.name, dir: 'asc' };
                      });
                    }}
                    className="flex items-center gap-1 hover:text-primary"
                  >
                    {c.name}
                    {sort?.col === c.name &&
                      (sort.dir === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                    {c.type && (
                      <span className="text-muted-foreground/50 text-[10px] font-normal">
                        {c.type}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
            <tr>
              {displayColumns.map((c) => (
                <th key={c.name + '-f'} className="px-1 pb-1 border-b border-border">
                  <input
                    placeholder="filter…"
                    value={filters[c.name] ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, [c.name]: e.target.value }))}
                    className="w-full h-5 text-[11px] bg-muted/30 px-1 rounded outline-none focus:ring-1 ring-ring font-normal"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <DataRow
                key={(pkCol ? String(row[pkCol]) : String(i)) + '-' + page}
                row={row}
                table={table}
                displayColumns={displayColumns}
                pkCol={pkCol}
                db={db}
                onFkClick={onFkClick}
                onRowEdited={onRowEdited}
              />
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={Math.max(1, displayColumns.length)}
                  className="text-center text-muted-foreground py-10"
                >
                  {error ? error : 'no rows'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-muted/20 text-xs">
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
        <span className="text-muted-foreground tabular-nums">
          {totalRows === 0
            ? rows.length > 0
              ? `${rows.length} returned (count unavailable)`
              : '0 rows'
            : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalRows)} of ${totalRows.toLocaleString()}`}
        </span>
        {table.columns.length === 0 && rows.length > 0 && (
          <span className="text-amber-500 text-[10px]" title="PRAGMA table_info returned no columns; rendering inferred from row keys">
            inferred columns
          </span>
        )}
        {error && (
          <span
            className="text-destructive text-[11px] font-mono truncate max-w-md"
            title={`Last query: ${lastSql}\n\nError: ${error}`}
          >
            {error}
          </span>
        )}
        {lastSql && !error && (
          <span
            className="text-[10px] text-muted-foreground/50 font-mono truncate max-w-xs"
            title={lastSql}
          >
            {lastSql}
          </span>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ‹ Prev
        </Button>
        <span className="text-muted-foreground tabular-nums">
          {page + 1} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page + 1 >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          Next ›
        </Button>
      </div>
    </div>
  );
}

function DataRow({
  row,
  table,
  displayColumns,
  pkCol,
  db,
  onFkClick,
  onRowEdited,
}: {
  row: Row;
  table: TableSchema;
  displayColumns: { name: string; type: string }[];
  pkCol: string | null;
  db: Database;
  onFkClick: (toTable: string, toColumn: string, value: SqlValue) => void;
  onRowEdited: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');

  const startEdit = (col: string) => {
    if (!pkCol) return; // no PK → no inline edit (would require ROWID handling)
    const cur = row[col];
    if (cur instanceof Uint8Array) return; // BLOBs not editable inline
    setEditing(col);
    setDraft(cur === null ? '' : String(cur));
  };

  const commit = (col: string) => {
    if (!pkCol) {
      setEditing(null);
      return;
    }
    const cur = row[col];
    if (String(cur ?? '') === draft) {
      setEditing(null);
      return;
    }
    try {
      const tname = qident(table.name);
      const colName = qident(col);
      const pkName = qident(pkCol);
      // Treat empty string as NULL when original was null
      const newValue = draft === '' && cur === null ? null : draft;
      db.exec(
        `UPDATE ${tname} SET ${colName} = ? WHERE ${pkName} = ?`,
        [newValue as SqlValue, row[pkCol] as SqlValue],
      );
      setEditing(null);
      onRowEdited();
    } catch (e) {
      alert(`Update failed: ${e instanceof Error ? e.message : e}`);
      setEditing(null);
    }
  };

  return (
    <tr className="hover:bg-accent/30 group">
      {displayColumns.map((c) => {
        const fk = table.fks.find((f) => f.fromColumn === c.name);
        const schemaCol = table.columns.find((sc) => sc.name === c.name);
        const isPk = (schemaCol?.pk ?? 0) > 0;
        const value = row[c.name];
        const isEditing = editing === c.name;
        return (
          <td
            key={c.name}
            className={cn(
              'px-2 py-0.5 border-b border-border/40 whitespace-nowrap align-top',
              isPk && 'text-amber-500',
            )}
            onDoubleClick={() => !fk && startEdit(c.name)}
          >
            {isEditing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(c.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit(c.name);
                  if (e.key === 'Escape') setEditing(null);
                }}
                className="w-full bg-background border border-primary px-1 outline-none text-foreground"
              />
            ) : fk && value !== null ? (
              <button
                onClick={() => onFkClick(fk.toTable, fk.toColumn, value)}
                className="text-purple-500 hover:underline"
                title={`→ ${fk.toTable}.${fk.toColumn}`}
              >
                {String(value)} ↗
              </button>
            ) : (
              renderCell(value)
            )}
          </td>
        );
      })}
    </tr>
  );
}

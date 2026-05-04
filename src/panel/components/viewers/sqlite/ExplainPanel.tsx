import { useEffect, useState } from 'react';
import type { Database, Row } from 'rsqlite-wasm';

interface Props {
  db: Database;
  sql: string;
}

export function ExplainPanel({ db, sql }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sql.trim()) {
      setRows(null);
      setError(null);
      return;
    }
    try {
      const result = db.query<Row>(`EXPLAIN QUERY PLAN ${sql}`);
      setRows(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows(null);
    }
  }, [db, sql]);

  if (error) {
    return <div className="p-3 text-xs text-destructive">{error}</div>;
  }
  if (!rows) {
    return <div className="p-3 text-xs text-muted-foreground">No query.</div>;
  }
  if (rows.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">EXPLAIN returned no plan steps.</div>;
  }

  // Build indented tree from `parent` references
  const byId = new Map<number, Row[]>();
  for (const r of rows) {
    const parent = Number(r.parent ?? 0);
    if (!byId.has(parent)) byId.set(parent, []);
    byId.get(parent)!.push(r);
  }
  function render(parentId: number, depth: number): React.ReactNode {
    const children = byId.get(parentId) ?? [];
    return children.map((r) => (
      <div key={String(r.id)} style={{ paddingLeft: depth * 16 }} className="font-mono text-xs py-0.5">
        <span className="text-muted-foreground/60 mr-2">{r.id as number}</span>
        <span>{String(r.detail)}</span>
        {render(Number(r.id), depth + 1)}
      </div>
    ));
  }
  return <div className="p-3 overflow-auto h-full bg-muted/10">{render(0, 0)}</div>;
}

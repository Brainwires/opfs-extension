import type { SqlValue } from 'rsqlite-wasm';

export type ResultRow = Record<string, SqlValue>;

function escapeCsvCell(v: SqlValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Uint8Array) return `[blob ${v.length}B]`;
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows: ResultRow[], columns?: string[]): string {
  if (!rows.length) return columns ? columns.join(',') + '\n' : '';
  const cols = columns ?? Object.keys(rows[0]);
  const header = cols.join(',');
  const body = rows.map((row) => cols.map((c) => escapeCsvCell(row[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

export function rowsToJson(rows: ResultRow[]): string {
  // Replace Uint8Array with `{ "$blob": "<base64>" }` so JSON survives round-trips.
  return JSON.stringify(
    rows,
    (_key, value) => {
      if (value instanceof Uint8Array) {
        let s = '';
        for (let i = 0; i < value.length; i += 0x8000) {
          s += String.fromCharCode(...value.subarray(i, i + 0x8000));
        }
        return { $blob: btoa(s) };
      }
      return value;
    },
    2,
  );
}

function escapeSqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function blobLiteral(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `X'${hex}'`;
}

function sqlValueLiteral(v: SqlValue): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Uint8Array) return blobLiteral(v);
  return escapeSqlString(String(v));
}

export function rowsToInserts(table: string, rows: ResultRow[], columns?: string[]): string {
  if (!rows.length) return `-- 0 rows\n`;
  const cols = columns ?? Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
  const lines = rows.map(
    (row) =>
      `INSERT INTO "${table.replace(/"/g, '""')}" (${colList}) VALUES (${cols
        .map((c) => sqlValueLiteral(row[c]))
        .join(', ')});`,
  );
  return lines.join('\n') + '\n';
}

export function downloadAs(content: string | Uint8Array, filename: string, mime: string): void {
  const blob =
    typeof content === 'string'
      ? new Blob([content], { type: mime })
      : new Blob([content as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

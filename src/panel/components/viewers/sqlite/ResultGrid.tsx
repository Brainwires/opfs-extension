import type { Row } from 'rsqlite-wasm';
import { renderCell } from './cellRenderers';

interface Props {
  rows: Row[];
  columns: string[];
  maxRows?: number;
}

export function ResultGrid({ rows, columns, maxRows = 5000 }: Props) {
  const display = rows.slice(0, maxRows);
  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs font-mono border-collapse">
        <thead className="sticky top-0 bg-muted/60 backdrop-blur z-10">
          <tr>
            {columns.map((c) => (
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
          {display.map((row, i) => (
            <tr key={i} className="hover:bg-accent/30">
              {columns.map((c) => (
                <td
                  key={c}
                  className="px-2 py-0.5 border-b border-border/40 whitespace-nowrap align-top"
                >
                  {renderCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length || 1} className="text-center text-muted-foreground py-6">
                no rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <div className="px-3 py-2 text-[10px] text-muted-foreground bg-muted/20">
          showing first {maxRows.toLocaleString()} of {rows.length.toLocaleString()}
        </div>
      )}
    </div>
  );
}

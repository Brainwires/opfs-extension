import type { Row } from 'rsqlite-wasm';
import { Download } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { downloadAs, rowsToCsv, rowsToInserts, rowsToJson } from '../../../lib/sqlExport';

interface Props {
  rows: Row[];
  columns: string[];
  baseName: string;
  insertTable?: string;
}

export function ExportMenu({ rows, columns, baseName, insertTable }: Props) {
  const safe = baseName.replace(/[^a-z0-9._-]+/gi, '_') || 'result';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          onSelect={() => downloadAs(rowsToCsv(rows, columns), `${safe}.csv`, 'text/csv')}
        >
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => downloadAs(rowsToJson(rows), `${safe}.json`, 'application/json')}
        >
          JSON
        </DropdownMenuItem>
        {insertTable && (
          <DropdownMenuItem
            onSelect={() =>
              downloadAs(rowsToInserts(insertTable, rows, columns), `${safe}.sql`, 'text/sql')
            }
          >
            SQL INSERTs
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

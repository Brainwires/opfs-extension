import { useState } from 'react';
import type { SqlValue } from 'rsqlite-wasm';
import { rowAt, rowCount } from '../../../lib/hexdump';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Badge } from '../../ui/badge';

export function renderCell(v: SqlValue): React.ReactNode {
  if (v === null || v === undefined) return <em className="text-muted-foreground/50">NULL</em>;
  if (v instanceof Uint8Array) return <BlobCell bytes={v} />;
  if (typeof v === 'number') return <span className="tabular-nums">{v}</span>;
  // Detect ISO timestamps (cheap pattern)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) {
    return <time dateTime={v} className="tabular-nums">{v}</time>;
  }
  // Detect JSON strings
  if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
    try {
      JSON.parse(v);
      return <JsonCell raw={v} />;
    } catch {
      // fall through
    }
  }
  return <span title={String(v)}>{String(v)}</span>;
}

function BlobCell({ bytes }: { bytes: Uint8Array }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center"
        title={`${bytes.length} bytes`}
      >
        <Badge variant="secondary">blob {bytes.length}B</Badge>
      </button>
      {open && <BlobModal bytes={bytes} onClose={() => setOpen(false)} />}
    </>
  );
}

function BlobModal({ bytes, onClose }: { bytes: Uint8Array; onClose: () => void }) {
  const total = rowCount(bytes.length);
  const visible = Math.min(total, 64);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>BLOB · {bytes.length} bytes</DialogTitle>
        </DialogHeader>
        <div className="font-mono text-xs leading-[18px] max-h-[60vh] overflow-auto">
          {Array.from({ length: visible }, (_, i) => {
            const r = rowAt(bytes, i);
            return (
              <div key={r.offset} className="flex gap-3 px-1">
                <span className="w-20 text-muted-foreground/70">{r.offset.toString(16).padStart(8, '0')}</span>
                <span className="text-foreground whitespace-pre">{r.hex}</span>
                <span className="text-muted-foreground whitespace-pre">{r.ascii}</span>
              </div>
            );
          })}
          {total > visible && (
            <div className="text-muted-foreground p-2">… {total - visible} rows truncated</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function JsonCell({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center text-left max-w-[200px] truncate"
        title="Click to view formatted JSON"
      >
        <Badge variant="default">json</Badge>
        <span className="ml-1 truncate text-muted-foreground">{raw}</span>
      </button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>JSON</DialogTitle>
            </DialogHeader>
            <pre className="font-mono text-xs max-h-[60vh] overflow-auto bg-muted/30 p-3 rounded">
              {tryFormat(raw)}
            </pre>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function tryFormat(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

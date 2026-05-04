import { ChevronRight, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { useStore } from '../state/store';
import { downloadFile } from '../lib/zip';
import { call } from '../bridge/rpc';

export function BreadcrumbBar({ path }: { path: string }) {
  const select = useStore((s) => s.selectPath);
  const open = useStore((s) => s.openFile);
  const closeTab = useStore((s) => s.closeTab);
  const reloadAncestor = useStore((s) => s.reloadAncestor);
  const refreshQuota = useStore((s) => s.refreshQuota);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);
  const [busy, setBusy] = useState(false);
  const segments = path.split('/').filter(Boolean);

  const handleJump = async () => {
    setEditing(false);
    if (!draft.startsWith('/')) return;
    select(draft);
    open(draft);
  };

  const handleDownload = async () => {
    try {
      setBusy(true);
      const stat = await call('stat', { path });
      if (stat.kind !== 'file') return;
      await downloadFile(stat);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${path}?`)) return;
    try {
      await call('rm', { path, recursive: false });
      closeTab(path);
      await reloadAncestor(path);
      await refreshQuota();
      toast.success('Deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-3 h-8 border-b border-border">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleJump();
            if (e.key === 'Escape') {
              setDraft(path);
              setEditing(false);
            }
          }}
          onBlur={() => setEditing(false)}
          className="flex-1 h-6 text-xs bg-muted/40 px-2 rounded outline-none focus:ring-1 ring-ring font-mono"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-3 h-8 border-b border-border bg-muted/10">
      <button
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={() => {
          setDraft(path);
          setEditing(true);
        }}
        title="Click to edit path"
      >
        /
      </button>
      {segments.map((seg, i) => {
        const segPath = '/' + segments.slice(0, i + 1).join('/');
        const last = i === segments.length - 1;
        return (
          <span key={segPath} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <button
              className={
                last ? 'text-xs font-medium' : 'text-xs text-muted-foreground hover:text-foreground'
              }
              onClick={() => {
                if (!last) {
                  setDraft(segPath);
                  setEditing(true);
                }
              }}
            >
              {seg}
            </button>
          </span>
        );
      })}
      <div className="flex-1" />
      <Button variant="ghost" size="sm" onClick={handleDownload} disabled={busy} className="gap-1">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        download
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDelete}
        className="text-destructive hover:text-destructive"
      >
        delete
      </Button>
    </div>
  );
}

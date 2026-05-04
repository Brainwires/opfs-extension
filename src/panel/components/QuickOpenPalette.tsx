import { useEffect, useState } from 'react';
import { File, Folder, Loader2 } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command';
import { Dialog, DialogContent } from './ui/dialog';
import { useStore } from '../state/store';
import { call } from '../bridge/rpc';
import type { FsEntry } from '../bridge/types';
import { formatBytes } from '../lib/formatBytes';

export function QuickOpenPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPaletteOpen);
  const openFile = useStore((s) => s.openFile);
  const select = useStore((s) => s.selectPath);
  const expandDir = useStore((s) => s.expandDir);

  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    call('tree', { path: '/' })
      .then((r) => {
        if (!cancelled) setEntries(r);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const onSelect = async (entry: FsEntry) => {
    setOpen(false);
    select(entry.path);
    if (entry.kind === 'directory') {
      await expandDir(entry.path);
    } else {
      openFile(entry.path);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 max-w-2xl">
        <Command shouldFilter loop>
          <CommandInput placeholder="Search by path…" autoFocus />
          <CommandList>
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-3">
                <Loader2 className="h-3 w-3 animate-spin" />
                Indexing…
              </div>
            )}
            {!loading && entries && entries.length === 0 && (
              <CommandEmpty>No files</CommandEmpty>
            )}
            {!loading && entries && (
              <>
                {entries.slice(0, 500).map((e) => (
                  <CommandItem
                    key={e.path}
                    value={e.path}
                    keywords={[e.name]}
                    onSelect={() => onSelect(e)}
                  >
                    {e.kind === 'directory' ? (
                      <Folder className="h-3.5 w-3.5 text-amber-500/80" />
                    ) : (
                      <File className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="font-medium">{e.name}</span>
                    <span className="text-xs text-muted-foreground/70 ml-2 truncate">
                      {e.path.slice(0, e.path.length - e.name.length)}
                    </span>
                    {e.kind === 'file' && (
                      <span className="ml-auto text-[10px] text-muted-foreground/60">
                        {formatBytes(e.size)}
                      </span>
                    )}
                  </CommandItem>
                ))}
                {entries.length > 500 && (
                  <div className="px-3 py-1 text-[10px] text-muted-foreground">
                    {entries.length - 500} more — narrow your search
                  </div>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

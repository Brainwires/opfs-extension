import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Database,
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../state/store';
import type { FsEntry } from '../bridge/types';
import { call, writeFile } from '../bridge/rpc';
import { cn } from '../lib/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';
import { downloadFile } from '../lib/zip';
import { dirname } from '../lib/sniff';
import { downloadJoined, parseShardName, type MultipartGroup } from '../lib/multipart';
import { Badge } from './ui/badge';
import { formatBytes } from '../lib/formatBytes';

const ROOT = '/';
const INDENT_PX = 14;

function iconFor(entry: FsEntry, expanded: boolean, isMultipart: boolean) {
  if (entry.kind === 'directory') {
    return expanded ? (
      <FolderOpen className="h-3.5 w-3.5 text-amber-500/80" />
    ) : (
      <Folder className="h-3.5 w-3.5 text-amber-500/80" />
    );
  }
  if (isMultipart) {
    return <Database className="h-3.5 w-3.5 text-sky-500/80" />;
  }
  const ext = entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase();
  if (['db', 'sqlite', 'sqlite3'].includes(ext))
    return <Database className="h-3.5 w-3.5 text-sky-500/80" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico'].includes(ext))
    return <FileImage className="h-3.5 w-3.5 text-emerald-500/80" />;
  if (['json', 'json5'].includes(ext))
    return <FileJson className="h-3.5 w-3.5 text-orange-400/80" />;
  if (['js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'css', 'html'].includes(ext))
    return <FileCode2 className="h-3.5 w-3.5 text-sky-400/80" />;
  if (['md', 'txt', 'log'].includes(ext))
    return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  return <File className="h-3.5 w-3.5 text-muted-foreground" />;
}

function multipartGroupForEntry(
  entry: FsEntry,
  groupsForDir: Map<string, MultipartGroup> | undefined,
): { group: MultipartGroup; isBareLeftover: boolean; isReserved: boolean } | null {
  if (!groupsForDir) return null;
  const parsed = parseShardName(entry.name);
  const base = parsed ? parsed.base : entry.name;
  const group = groupsForDir.get(base);
  if (!group) return null;
  const isShard = group.shards.some((s) => s.path === entry.path);
  const isReserved = group.reservedShards.some((s) => s.path === entry.path);
  const isBare = group.bareLeftover?.path === entry.path;
  if (!isShard && !isReserved && !isBare) return null;
  return { group, isBareLeftover: isBare, isReserved };
}

interface NodeRenderProps {
  entry: FsEntry;
  depth: number;
  flashedAt: number | undefined;
}

function TreeNode({ entry, depth, flashedAt }: NodeRenderProps) {
  const expanded = useStore((s) => s.expanded.has(entry.path));
  const node = useStore((s) => s.nodes.get(entry.path));
  const selected = useStore((s) => s.selected === entry.path);
  const select = useStore((s) => s.selectPath);
  const toggle = useStore((s) => s.toggleDir);
  const open = useStore((s) => s.openFile);
  const reloadDir = useStore((s) => s.reloadDir);
  const reloadAncestor = useStore((s) => s.reloadAncestor);
  const refreshQuota = useStore((s) => s.refreshQuota);
  const closeTab = useStore((s) => s.closeTab);
  const treeMtimes = useStore((s) => s.treeMtimes);
  const flashed = flashedAt && Date.now() - flashedAt < 1500;
  const groupsForDir = useStore((s) => s.multipartGroups.get(dirname(entry.path)));
  const groupInfo = entry.kind === 'file' ? multipartGroupForEntry(entry, groupsForDir) : null;
  const group = groupInfo?.group ?? null;
  const isBare = groupInfo?.isBareLeftover ?? false;
  const isReserved = groupInfo?.isReserved ?? false;

  const handleClick = () => {
    select(entry.path);
    if (entry.kind === 'directory') void toggle(entry.path);
    else open(entry.path);
  };

  const handleDelete = async () => {
    if (isReserved && group) {
      toast.error(
        `${entry.name} is reserved capacity for ${group.base} — the page is holding it open. ` +
          `Close or pause the page first, then delete the whole group.`,
        { duration: 6000 },
      );
      return;
    }
    const ok = window.confirm(
      `Delete ${entry.path}${entry.kind === 'directory' ? ' and everything inside?' : '?'}`,
    );
    if (!ok) return;
    try {
      await call('rm', { path: entry.path, recursive: entry.kind === 'directory' });
      closeTab(entry.path);
      await reloadAncestor(entry.path);
      await refreshQuota();
      toast.success(`Deleted ${entry.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/NoModificationAllowed|modifications are not allowed|Locked/i.test(msg)) {
        toast.error(
          `${entry.name} is held open by the inspected page (probably an active SQLite shard). ` +
            `Close the page or pause writes, then try again.`,
          { duration: 6000 },
        );
      } else {
        toast.error(msg);
      }
    }
  };

  const handleRename = async () => {
    const newName = window.prompt('Rename to', entry.name);
    if (!newName || newName === entry.name) return;
    const dir = dirname(entry.path);
    const newPath = dir === '/' ? `/${newName}` : `${dir}/${newName}`;
    try {
      await call('move', { from: entry.path, to: newPath });
      await reloadDir(dir);
      toast.success('Renamed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDuplicate = async () => {
    if (entry.kind !== 'file') return;
    const stem = entry.name.includes('.') ? entry.name.slice(0, entry.name.lastIndexOf('.')) : entry.name;
    const ext = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : '';
    const newName = `${stem}-copy${ext}`;
    const dir = dirname(entry.path);
    const newPath = dir === '/' ? `/${newName}` : `${dir}/${newName}`;
    try {
      const r = await call('read', { path: entry.path });
      await call('write', { path: newPath, b64: r.b64, mode: 'replace' });
      await reloadDir(dir);
      await refreshQuota();
      toast.success('Duplicated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (entry.kind !== 'directory') return;
    const files = Array.from(ev.dataTransfer.files || []);
    if (!files.length) return;
    let count = 0;
    for (const file of files) {
      const path = entry.path === '/' ? `/${file.name}` : `${entry.path}/${file.name}`;
      try {
        await writeFile(path, new Uint8Array(await file.arrayBuffer()));
        count++;
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await reloadDir(entry.path);
    await refreshQuota();
    if (count) toast.success(`Uploaded ${count} into ${entry.path}`);
  };

  const onDragStart = (ev: React.DragEvent) => {
    if (entry.kind !== 'file') return;
    ev.dataTransfer.setData('text/plain', entry.path);
    ev.dataTransfer.setData('DownloadURL', `application/octet-stream:${entry.name}:about:blank`);
  };

  return (
    <div onDragOver={(e) => entry.kind === 'directory' && e.preventDefault()} onDrop={onDrop}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-selected={selected}
            aria-expanded={entry.kind === 'directory' ? expanded : undefined}
            tabIndex={selected ? 0 : -1}
            draggable={entry.kind === 'file'}
            onDragStart={onDragStart}
            onClick={handleClick}
            onDoubleClick={() => entry.kind === 'file' && open(entry.path)}
            className={cn(
              'group flex items-center gap-1 h-6 px-1 cursor-default rounded-sm select-none transition-colors',
              selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
              flashed && 'bg-primary/15',
            )}
            style={{ paddingLeft: depth * INDENT_PX + 4 }}
          >
            {entry.kind === 'directory' ? (
              <ChevronRight
                className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')}
              />
            ) : (
              <span className="w-3" />
            )}
            {iconFor(entry, expanded, !!group && !isBare)}
            <span
              className={cn(
                'truncate text-xs',
                isBare && 'text-amber-500',
                isReserved && 'text-muted-foreground/60 italic',
              )}
            >
              {entry.name}
            </span>
            {group && !isBare && !isReserved && (
              <Badge
                variant="default"
                className="ml-1"
                title={`Multipart group: ${group.shards.length} active${group.reservedShards.length ? ` + ${group.reservedShards.length} reserved` : ''} · ${formatBytes(group.totalSize)}`}
              >
                ×{group.shards.length}
                {group.reservedShards.length > 0 && (
                  <span className="opacity-60">+{group.reservedShards.length}</span>
                )}
              </Badge>
            )}
            {isReserved && (
              <Badge
                variant="secondary"
                className="ml-1"
                title="Pre-allocated by rsqlite-wasm — the page holds a SyncAccessHandle on it. Don't delete individually."
              >
                reserved
              </Badge>
            )}
            {isBare && (
              <Badge variant="destructive" className="ml-1" title="Stranded legacy file from a pre-pure-multiplex era">
                stale
              </Badge>
            )}
            {entry.locked && (
              <Lock className="h-3 w-3 ml-1 text-amber-500" aria-label="Locked by page" />
            )}
            {entry.kind === 'file' && (
              <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums opacity-0 group-hover:opacity-100">
                {formatTreeSize(entry.size)}
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {entry.kind === 'file' && (
            <>
              <ContextMenuItem onSelect={() => downloadFile(entry)}>Download</ContextMenuItem>
              {group && !isBare && group.shards.length > 1 && (
                <ContextMenuItem
                  onSelect={async () => {
                    try {
                      toast.info(`Joining ${group.shards.length} shards…`);
                      await downloadJoined(group);
                      toast.success(`Downloaded ${group.base}`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  Download joined ({group.shards.length} shards)
                </ContextMenuItem>
              )}
              <ContextMenuItem onSelect={handleDuplicate}>Duplicate</ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={handleRename}>Rename…</ContextMenuItem>
          <ContextMenuItem
            onSelect={handleDelete}
            className="text-destructive focus:text-destructive"
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {entry.kind === 'directory' && expanded && (
        <DirectoryChildren path={entry.path} depth={depth + 1} treeMtimes={treeMtimes} node={node} />
      )}
    </div>
  );
}

function formatTreeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function DirectoryChildren({
  depth,
  treeMtimes,
  node,
}: {
  path: string;
  depth: number;
  treeMtimes: Record<string, number>;
  node: ReturnType<typeof useStore.getState>['nodes'] extends Map<string, infer V> ? V | undefined : never;
}) {
  const flashTimesRef = useRef<Map<string, number>>(new Map());
  const prevMtimesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!node?.children) return;
    const newFlash = new Map(flashTimesRef.current);
    let changed = false;
    for (const child of node.children) {
      const t = treeMtimes[child.path];
      const prev = prevMtimesRef.current[child.path];
      if (t && prev && t !== prev) {
        newFlash.set(child.path, Date.now());
        changed = true;
      }
      if (t) prevMtimesRef.current[child.path] = t;
    }
    if (changed) flashTimesRef.current = newFlash;
  }, [node, treeMtimes]);

  if (!node) return null;
  if (node.loading && !node.loaded) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground py-1"
        style={{ paddingLeft: depth * INDENT_PX + 14 }}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading…
      </div>
    );
  }
  if (node.error) {
    return (
      <div
        className="text-xs text-destructive py-1"
        style={{ paddingLeft: depth * INDENT_PX + 14 }}
      >
        {node.error}
      </div>
    );
  }
  if (!node.children?.length) {
    return (
      <div
        className="text-xs text-muted-foreground/60 py-1 italic"
        style={{ paddingLeft: depth * INDENT_PX + 14 }}
      >
        empty
      </div>
    );
  }
  return (
    <>
      {node.children.map((c) => (
        <TreeNode
          key={c.path}
          entry={c}
          depth={depth}
          flashedAt={flashTimesRef.current.get(c.path)}
        />
      ))}
    </>
  );
}

export function FileTree() {
  const rootNode = useStore((s) => s.nodes.get(ROOT));
  const refreshQuota = useStore((s) => s.refreshQuota);
  const reloadDir = useStore((s) => s.reloadDir);
  const treeMtimes = useStore((s) => s.treeMtimes);
  const [filter, setFilter] = useState('');

  const filteredChildren = useMemo(() => {
    if (!rootNode?.children) return [];
    if (!filter) return rootNode.children;
    const q = filter.toLowerCase();
    return rootNode.children.filter((c) => c.name.toLowerCase().includes(q));
  }, [rootNode, filter]);

  const onRootDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    const files = Array.from(ev.dataTransfer.files || []);
    if (!files.length) return;
    let count = 0;
    for (const file of files) {
      try {
        await writeFile(`/${file.name}`, new Uint8Array(await file.arrayBuffer()));
        count++;
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await reloadDir('/');
    await refreshQuota();
    if (count) toast.success(`Uploaded ${count} to /`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2 pb-1">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          className="w-full h-6 text-xs rounded bg-muted/40 px-2 outline-none focus:ring-1 ring-ring"
        />
      </div>
      <div
        className="flex-1 overflow-auto py-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onRootDrop}
      >
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60 px-2 pb-1">
          /
        </div>
        {filteredChildren.length === 0 && rootNode?.loaded && (
          <div className="text-xs text-muted-foreground/60 italic px-3 py-2">
            {filter ? 'no matches' : 'empty'}
          </div>
        )}
        {filteredChildren.map((c) => (
          <TreeNode
            key={c.path}
            entry={c}
            depth={0}
            flashedAt={undefined}
          />
        ))}
      </div>
      <div className="px-2 pb-1 text-[10px] text-muted-foreground/60">
        {Object.keys(treeMtimes).length > 0 && `${Object.keys(treeMtimes).length} tracked`}
      </div>
    </div>
  );
}

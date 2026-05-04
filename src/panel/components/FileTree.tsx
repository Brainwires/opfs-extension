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
import {
  cleanupBareLeftover,
  downloadJoined,
  type MultipartGroup,
} from '../lib/multipart';
import { Badge } from './ui/badge';
import { formatBytes } from '../lib/formatBytes';
import { virtualize, type TreeItem } from '../lib/treeVirtualize';

const ROOT = '/';
const INDENT_PX = 14;

function iconFor(entry: FsEntry, expanded: boolean) {
  if (entry.kind === 'directory') {
    return expanded ? (
      <FolderOpen className="h-3.5 w-3.5 text-amber-500/80" />
    ) : (
      <Folder className="h-3.5 w-3.5 text-amber-500/80" />
    );
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

function formatTreeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface ItemProps {
  item: TreeItem;
  depth: number;
  flashedAt: number | undefined;
}

function TreeItemRow({ item, depth, flashedAt }: ItemProps) {
  if (item.kind === 'group') {
    return <GroupNode group={item.group} depth={depth} flashedAt={flashedAt} />;
  }
  return <EntryNode entry={item.entry} depth={depth} flashedAt={flashedAt} />;
}

function EntryNode({
  entry,
  depth,
  flashedAt,
  insideGroup,
}: {
  entry: FsEntry;
  depth: number;
  flashedAt: number | undefined;
  insideGroup?: { group: MultipartGroup; classification: 'active' | 'reserved' | 'bare' };
}) {
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

  const classification = insideGroup?.classification;
  const isReserved = classification === 'reserved';
  const isBare = classification === 'bare';

  const handleClick = () => {
    select(entry.path);
    if (entry.kind === 'directory') void toggle(entry.path);
    else if (insideGroup) {
      // Inside a group, single-clicking a shard opens the whole group's viewer.
      open(insideGroup.group.id);
    } else {
      open(entry.path);
    }
  };

  const handleDelete = async () => {
    if (isReserved && insideGroup) {
      toast.error(
        `${entry.name} is reserved capacity for ${insideGroup.group.base} — the page is holding it open. ` +
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
          `${entry.name} is held open by the inspected page. ` +
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
            onDoubleClick={() => entry.kind === 'file' && !insideGroup && open(entry.path)}
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
            {iconFor(entry, expanded)}
            <span
              className={cn(
                'truncate text-xs',
                isBare && 'text-amber-500',
                isReserved && 'text-muted-foreground/60 italic',
              )}
            >
              {entry.name}
            </span>
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
          {entry.kind === 'file' && !isReserved && !isBare && (
            <>
              <ContextMenuItem onSelect={() => downloadFile(entry)}>
                Download {insideGroup ? 'this shard' : ''}
              </ContextMenuItem>
              {!insideGroup && <ContextMenuItem onSelect={handleDuplicate}>Duplicate</ContextMenuItem>}
              <ContextMenuSeparator />
            </>
          )}
          {isBare && (
            <>
              <ContextMenuItem
                onSelect={async () => {
                  if (!insideGroup) return;
                  if (!window.confirm(`Delete stranded legacy file ${entry.path}?`)) return;
                  try {
                    await cleanupBareLeftover(insideGroup.group);
                    closeTab(entry.path);
                    await reloadAncestor(entry.path);
                    await refreshQuota();
                    toast.success('Cleaned up');
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Clean up stranded file
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {isReserved ? (
            <ContextMenuItem disabled>Reserved · cannot modify</ContextMenuItem>
          ) : (
            <>
              {!insideGroup && <ContextMenuItem onSelect={handleRename}>Rename…</ContextMenuItem>}
              <ContextMenuItem
                onSelect={handleDelete}
                className="text-destructive focus:text-destructive"
              >
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {entry.kind === 'directory' && expanded && (
        <DirectoryChildren path={entry.path} depth={depth + 1} treeMtimes={treeMtimes} node={node} />
      )}
    </div>
  );
}

function GroupNode({
  group,
  depth,
  flashedAt,
}: {
  group: MultipartGroup;
  depth: number;
  flashedAt: number | undefined;
}) {
  const expanded = useStore((s) => s.expanded.has(group.id));
  const toggleGroup = useStore((s) => s.toggleNonDirExpand);
  const selected = useStore((s) => s.selected === group.id);
  const select = useStore((s) => s.selectPath);
  const open = useStore((s) => s.openFile);
  const reloadAncestor = useStore((s) => s.reloadAncestor);
  const refreshQuota = useStore((s) => s.refreshQuota);
  const closeTab = useStore((s) => s.closeTab);
  const flashed = flashedAt && Date.now() - flashedAt < 1500;

  const allShards = useMemo(
    () => [...group.shards, ...group.reservedShards],
    [group.shards, group.reservedShards],
  );

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleGroup(group.id);
  };

  const handleOpen = () => {
    select(group.id);
    open(group.id);
  };

  const handleDownloadJoined = async () => {
    try {
      toast.info(`Joining ${group.shards.length} shards…`);
      await downloadJoined(group);
      toast.success(`Downloaded ${group.base}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteEntireGroup = async () => {
    const ok = window.confirm(
      `Delete the entire database "${group.base}" — all ${allShards.length} shard${allShards.length === 1 ? '' : 's'} (${formatBytes(group.totalSize)})?\n\nThe inspected page may still be holding handles on these files; if any deletion fails, the page is using it.`,
    );
    if (!ok) return;
    let removed = 0;
    let blocked = 0;
    let lockedExample = '';
    for (const shard of allShards) {
      try {
        await call('rm', { path: shard.path, recursive: false });
        closeTab(shard.path);
        removed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/NoModificationAllowed|modifications are not allowed|Locked/i.test(msg)) {
          blocked++;
          if (!lockedExample) lockedExample = shard.path;
        } else {
          toast.error(`${shard.path}: ${msg}`);
        }
      }
    }
    if (group.bareLeftover) {
      try {
        await call('rm', { path: group.bareLeftover.path, recursive: false });
        removed++;
      } catch {
        // ignore — bare can also be locked
      }
    }
    closeTab(group.id);
    await reloadAncestor(group.shards[0]?.path ?? group.bareLeftover?.path ?? group.id);
    await refreshQuota();
    if (blocked > 0) {
      toast.error(
        `Removed ${removed}/${allShards.length} shards. ${blocked} held open by the page (e.g., ${lockedExample}). Close the page and try again.`,
        { duration: 8000 },
      );
    } else {
      toast.success(`Removed ${removed} shard${removed === 1 ? '' : 's'}`);
    }
  };

  // Build TreeItems for the children — wrap each shard in an "entry" item with
  // group context so EntryNode can render reserved styling + per-shard actions.
  const childItems: { entry: FsEntry; classification: 'active' | 'reserved' | 'bare' }[] = [
    ...group.shards.map((entry) => ({ entry, classification: 'active' as const })),
    ...group.reservedShards.map((entry) => ({ entry, classification: 'reserved' as const })),
    ...(group.bareLeftover
      ? [{ entry: group.bareLeftover, classification: 'bare' as const }]
      : []),
  ];

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-selected={selected}
            aria-expanded={expanded}
            tabIndex={selected ? 0 : -1}
            onClick={handleOpen}
            onDoubleClick={handleOpen}
            className={cn(
              'group flex items-center gap-1 h-6 px-1 cursor-default rounded-sm select-none transition-colors',
              selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
              flashed && 'bg-primary/15',
            )}
            style={{ paddingLeft: depth * INDENT_PX + 4 }}
          >
            <button
              onClick={toggle}
              className="text-muted-foreground hover:text-foreground"
              aria-label={expanded ? 'Collapse shards' : 'Expand shards'}
            >
              <ChevronRight
                className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')}
              />
            </button>
            <Database className="h-3.5 w-3.5 text-sky-500" />
            <span className="truncate text-xs font-medium">{group.base}</span>
            <Badge
              variant="default"
              className="ml-1"
              title={`${group.shards.length} active${group.reservedShards.length ? ` + ${group.reservedShards.length} reserved` : ''} · ${formatBytes(group.totalSize)} · ${group.mode}`}
            >
              ×{group.shards.length}
              {group.reservedShards.length > 0 && (
                <span className="opacity-60">+{group.reservedShards.length}</span>
              )}
            </Badge>
            {group.bareLeftover && (
              <Badge
                variant="destructive"
                className="ml-1"
                title="Stranded legacy bare file alongside the multipart group"
              >
                stale
              </Badge>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums opacity-0 group-hover:opacity-100">
              {formatTreeSize(group.totalSize)}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={handleOpen}>Open in SQLite viewer</ContextMenuItem>
          {group.shards.length > 1 ? (
            <ContextMenuItem onSelect={handleDownloadJoined}>
              Download joined ({group.shards.length} shards → {formatBytes(group.totalSize)})
            </ContextMenuItem>
          ) : group.shards[0] ? (
            <ContextMenuItem onSelect={() => downloadFile(group.shards[0])}>
              Download
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={handleDeleteEntireGroup}
            className="text-destructive focus:text-destructive"
          >
            Delete entire database ({allShards.length} shards)
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {expanded &&
        childItems.map(({ entry, classification }) => (
          <EntryNode
            key={entry.path}
            entry={entry}
            depth={depth + 1}
            flashedAt={undefined}
            insideGroup={{ group, classification }}
          />
        ))}
    </div>
  );
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
  const groupsForDir = useStore((s) =>
    node?.path ? s.multipartGroups.get(node.path) : undefined,
  );

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

  const items = useMemo<TreeItem[]>(
    () => (node?.children ? virtualize(node.children, groupsForDir) : []),
    [node, groupsForDir],
  );

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
  if (items.length === 0) {
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
      {items.map((item) => (
        <TreeItemRow
          key={item.kind === 'group' ? item.group.id : item.entry.path}
          item={item}
          depth={depth}
          flashedAt={
            item.kind === 'entry' ? flashTimesRef.current.get(item.entry.path) : undefined
          }
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
  const groupsForRoot = useStore((s) => s.multipartGroups.get(ROOT));
  const [filter, setFilter] = useState('');

  const items = useMemo<TreeItem[]>(() => {
    if (!rootNode?.children) return [];
    const v = virtualize(rootNode.children, groupsForRoot);
    if (!filter) return v;
    const q = filter.toLowerCase();
    return v.filter((it) =>
      it.kind === 'group'
        ? it.group.base.toLowerCase().includes(q)
        : it.entry.name.toLowerCase().includes(q),
    );
  }, [rootNode, groupsForRoot, filter]);

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
        {items.length === 0 && rootNode?.loaded && (
          <div className="text-xs text-muted-foreground/60 italic px-3 py-2">
            {filter ? 'no matches' : 'empty'}
          </div>
        )}
        {items.map((item) => (
          <TreeItemRow
            key={item.kind === 'group' ? item.group.id : item.entry.path}
            item={item}
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

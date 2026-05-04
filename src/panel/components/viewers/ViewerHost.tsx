import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { call, readFile, writeFile } from '../../bridge/rpc';
import { useStore } from '../../state/store';
import { detect } from '../../lib/sniff';
import { detectGroupsInDir, resolveGroup, type MultipartGroup } from '../../lib/multipart';
import { dirname } from '../../lib/sniff';
import type { FsEntry } from '../../bridge/types';
import { TextEditor } from './TextEditor';
import { JsonViewer } from './JsonViewer';
import { ImageViewer } from './ImageViewer';
import { MediaViewer } from './MediaViewer';
import { HexViewer } from './HexViewer';
import { PdfViewer } from './PdfViewer';
import { SqliteViewer } from './sqlite/SqliteViewer';
import { Button } from '../ui/button';

type ViewMode = 'auto' | 'text' | 'hex';

type Mode =
  | { kind: 'loading' }
  | { kind: 'multipart-sqlite'; group: MultipartGroup }
  | { kind: 'plain' }
  | { kind: 'error'; message: string };

export function ViewerHost({ path }: { path: string }) {
  const tab = useStore((s) => s.tabs.find((t) => t.path === path));
  const clearDirty = useStore((s) => s.clearDirty);
  const reloadAncestor = useStore((s) => s.reloadAncestor);
  const refreshQuota = useStore((s) => s.refreshQuota);

  const [mode, setMode] = useState<Mode>({ kind: 'loading' });
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [progress, setProgress] = useState<{ read: number; total: number } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  const [reloadKey, setReloadKey] = useState(0);

  // Step 1: list parent dir, decide if this is part of a multipart group
  useEffect(() => {
    let cancelled = false;
    setMode({ kind: 'loading' });
    setBytes(null);
    setProgress(null);
    (async () => {
      try {
        const dir = dirname(path);
        const siblings = await call('list', { path: dir });
        if (cancelled) return;
        const groups = detectGroupsInDir(dir, siblings);
        // Find the group this path belongs to (by name match in any group's shards or bareLeftover)
        const inGroup = findGroupContaining(groups, path);
        if (inGroup) {
          setMode({ kind: 'multipart-sqlite', group: inGroup });
          return;
        }
        // Not multipart — fall through to byte-read + sniff
        setMode({ kind: 'plain' });
      } catch (e) {
        if (!cancelled) setMode({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, reloadKey]);

  // Step 2 (only when plain): read the bytes and sniff
  useEffect(() => {
    if (mode.kind !== 'plain') return;
    let cancelled = false;
    setBytes(null);
    setProgress(null);
    (async () => {
      try {
        const data = await readFile(path, (read, total) => {
          if (!cancelled) setProgress({ read, total });
        });
        if (!cancelled) setBytes(data);
      } catch (e) {
        if (!cancelled) setMode({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode.kind, path, reloadKey]);

  const detection = useMemo(() => (bytes ? detect(path, bytes) : null), [bytes, path]);

  // Single-file SQLite: synthesize a single-shard group and hand to SqliteViewer
  const singleSqliteGroup = useMemo<MultipartGroup | null>(() => {
    if (!detection || detection.kind !== 'sqlite') return null;
    const dir = dirname(path);
    const name = path.slice(dir === '/' ? 1 : dir.length + 1);
    const entry: FsEntry = {
      name,
      path,
      kind: 'file',
      size: bytes?.length ?? 0,
      lastModified: 0,
      locked: false,
    };
    return resolveGroup(path, [entry]);
  }, [detection, path, bytes]);

  const onSave = async () => {
    if (!tab?.scratch) return;
    try {
      await writeFile(path, tab.scratch);
      clearDirty(path);
      await reloadAncestor(path);
      await refreshQuota();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setMode({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    const handler = async (ev: KeyboardEvent) => {
      // Don't intercept if focus is inside CodeMirror or an input — its own keymap handles save
      if (
        ev.target instanceof HTMLElement &&
        (ev.target.closest('.cm-editor') ||
          ev.target.tagName === 'INPUT' ||
          ev.target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
        ev.preventDefault();
        if (tab?.dirty) await onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (mode.kind === 'error') {
    return (
      <div className="p-6 text-sm">
        <p className="text-destructive font-medium mb-1">Couldn't read file</p>
        <p className="text-muted-foreground text-xs mb-3">{mode.message}</p>
        <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  if (mode.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Resolving…
      </div>
    );
  }

  if (mode.kind === 'multipart-sqlite') {
    return <SqliteViewer group={mode.group} key={mode.group.id + reloadKey} />;
  }

  // plain mode below — need bytes + detection
  if (!bytes || !detection) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading
        {progress && progress.total > 0
          ? ` (${Math.round((progress.read / progress.total) * 100)}%)`
          : '…'}
      </div>
    );
  }

  // Single-file SQLite picked up via magic bytes goes through the same viewer
  if (detection.kind === 'sqlite' && singleSqliteGroup) {
    return <SqliteViewer group={singleSqliteGroup} key={path + reloadKey} />;
  }

  const renderAuto = () => {
    switch (detection.kind) {
      case 'text':
        return <TextEditor path={path} bytes={bytes} language={detection.language} />;
      case 'json':
        return <JsonViewer path={path} bytes={bytes} />;
      case 'image':
        return <ImageViewer bytes={bytes} mime={detection.mime} path={path} />;
      case 'audio':
        return <MediaViewer bytes={bytes} mime={detection.mime} kind="audio" />;
      case 'video':
        return <MediaViewer bytes={bytes} mime={detection.mime} kind="video" />;
      case 'pdf':
        return <PdfViewer bytes={bytes} />;
      case 'binary':
      case 'zip':
      case 'gzip':
      default:
        return <HexViewer bytes={bytes} />;
    }
  };

  const isTextual = detection.kind === 'text' || detection.kind === 'json';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-3 py-1 border-b border-border bg-muted/10 text-[11px]">
        <span className="text-muted-foreground">{detection.mime}</span>
        {detection.encoding && (
          <span className="text-muted-foreground/60 ml-2">{detection.encoding}</span>
        )}
        <div className="flex-1" />
        {isTextual && (
          <>
            <button
              onClick={() => setViewMode('auto')}
              className={
                viewMode === 'auto'
                  ? 'px-1.5 py-0.5 text-foreground bg-secondary rounded'
                  : 'px-1.5 py-0.5 text-muted-foreground hover:text-foreground'
              }
            >
              text
            </button>
            <button
              onClick={() => setViewMode('hex')}
              className={
                viewMode === 'hex'
                  ? 'px-1.5 py-0.5 text-foreground bg-secondary rounded'
                  : 'px-1.5 py-0.5 text-muted-foreground hover:text-foreground'
              }
            >
              hex
            </button>
          </>
        )}
        {!isTextual && detection.kind !== 'pdf' && (
          <span className="text-muted-foreground/60">hex</span>
        )}
        {tab?.dirty && (
          <Button size="sm" variant="default" className="ml-2 h-6" onClick={onSave}>
            Save (⌘S)
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {viewMode === 'hex' ? <HexViewer bytes={bytes} /> : renderAuto()}
      </div>
    </div>
  );
}

function findGroupContaining(
  groups: Map<string, MultipartGroup>,
  path: string,
): MultipartGroup | null {
  for (const g of groups.values()) {
    // Synthetic group-id click from the FileTree's collapsed group node
    if (g.id === path) return g;
    if (g.shards.some((s) => s.path === path)) return g;
    if (g.reservedShards.some((s) => s.path === path)) return g;
    if (g.bareLeftover?.path === path) return g;
  }
  return null;
}

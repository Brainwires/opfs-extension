import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { readFile, writeFile } from '../../bridge/rpc';
import { useStore } from '../../state/store';
import { detect } from '../../lib/sniff';
import { TextEditor } from './TextEditor';
import { JsonViewer } from './JsonViewer';
import { ImageViewer } from './ImageViewer';
import { MediaViewer } from './MediaViewer';
import { HexViewer } from './HexViewer';
import { PdfViewer } from './PdfViewer';
import { SqliteViewer } from './SqliteViewer';
import { Button } from '../ui/button';

type ViewMode = 'auto' | 'text' | 'hex';

export function ViewerHost({ path }: { path: string }) {
  const tab = useStore((s) => s.tabs.find((t) => t.path === path));
  const clearDirty = useStore((s) => s.clearDirty);
  const reloadAncestor = useStore((s) => s.reloadAncestor);
  const refreshQuota = useStore((s) => s.refreshQuota);

  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ read: number; total: number } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setBytes(null);
    setProgress(null);
    (async () => {
      try {
        const data = await readFile(path, (read, total) => {
          if (!cancelled) setProgress({ read, total });
        });
        if (!cancelled) setBytes(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, reloadKey]);

  const detection = useMemo(() => (bytes ? detect(path, bytes) : null), [bytes, path]);

  const onSave = async () => {
    if (!tab?.scratch) return;
    try {
      await writeFile(path, tab.scratch);
      clearDirty(path);
      await reloadAncestor(path);
      await refreshQuota();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const handler = async (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
        ev.preventDefault();
        if (tab?.dirty) await onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (error) {
    return (
      <div className="p-6 text-sm">
        <p className="text-destructive font-medium mb-1">Couldn't read file</p>
        <p className="text-muted-foreground text-xs mb-3">{error}</p>
        <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </div>
    );
  }

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
      case 'sqlite':
        return <SqliteViewer bytes={bytes} />;
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
        {!isTextual && detection.kind !== 'sqlite' && detection.kind !== 'pdf' && (
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

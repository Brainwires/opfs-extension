import { useRef } from 'react';
import {
  Activity,
  FilePlus,
  FolderPlus,
  HardDrive,
  Keyboard,
  RefreshCw,
  Search,
  Split,
  TreePine,
  Upload,
  Download,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../state/store';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Separator } from './ui/separator';
import { call, writeFile } from '../bridge/rpc';
import { exportTreeAsZip } from '../lib/zip';
import { dirname } from '../lib/sniff';
import { uploadSegmented } from '../lib/multipart';

export function Toolbar() {
  const refreshAll = useStore((s) => s.refreshAll);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setShortcutSheetOpen = useStore((s) => s.setShortcutSheetOpen);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const liveWatch = useStore((s) => s.liveWatch);
  const setLiveWatch = useStore((s) => s.setLiveWatch);
  const selected = useStore((s) => s.selected);
  const reloadDir = useStore((s) => s.reloadDir);
  const reloadAncestor = useStore((s) => s.reloadAncestor);
  const expandDir = useStore((s) => s.expandDir);
  const refreshQuota = useStore((s) => s.refreshQuota);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const segmentedInputRef = useRef<HTMLInputElement>(null);

  const targetDir = (() => {
    if (!selected) return '/';
    // best-effort: if selected looks like dir treat as dir, else use parent
    return selected.endsWith('/') ? selected : dirname(selected);
  })();

  const handleNewFile = async () => {
    const name = window.prompt('New file name', 'untitled.txt');
    if (!name) return;
    const path = targetDir === '/' ? `/${name}` : `${targetDir}/${name}`;
    try {
      await call('write', { path, b64: '', mode: 'replace' });
      await reloadDir(targetDir);
      await refreshQuota();
      toast.success(`Created ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleNewDir = async () => {
    const name = window.prompt('New directory name', 'new-folder');
    if (!name) return;
    const path = targetDir === '/' ? `/${name}` : `${targetDir}/${name}`;
    try {
      await call('mkdir', { path });
      await reloadDir(targetDir);
      await expandDir(path);
      toast.success(`Created ${name}/`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let count = 0;
    for (const file of Array.from(files)) {
      const path = targetDir === '/' ? `/${file.name}` : `${targetDir}/${file.name}`;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await writeFile(path, bytes);
        count++;
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await reloadDir(targetDir);
    await refreshQuota();
    if (count > 0) toast.success(`Uploaded ${count} file${count === 1 ? '' : 's'}`);
  };

  const handleUploadSegmented = async (file: File | null) => {
    if (!file) return;
    const presetMb = window.prompt(
      `Split "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) into shards.\nChunk size in MB:\n  256  — 256 MB\n  1024 — 1 GB (rsqlite-wasm default)\n  Custom: type any number`,
      '1024',
    );
    if (!presetMb) return;
    const mb = Number.parseFloat(presetMb);
    if (!Number.isFinite(mb) || mb <= 0) {
      toast.error('Invalid chunk size');
      return;
    }
    const chunkSize = Math.floor(mb * 1024 * 1024);
    const baseInput = window.prompt(
      'Base name for the multipart group (no .NNN suffix):',
      file.name,
    );
    if (!baseInput) return;
    try {
      toast.info(`Uploading in ${Math.ceil(file.size / chunkSize)} shards…`);
      const r = await uploadSegmented(targetDir, file, chunkSize, baseInput);
      await reloadDir(targetDir);
      await refreshQuota();
      toast.success(`Uploaded ${r.base} as ${r.shardCount} shard${r.shardCount === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExportZip = async () => {
    try {
      toast.info('Building zip…');
      await exportTreeAsZip('/', `opfs-${Date.now()}.zip`);
      toast.success('Downloaded zip');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImportZip = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const { unzip } = await import('fflate');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
          unzip(bytes, (err, files) => (err ? reject(err) : resolve(files)));
        });
        let count = 0;
        for (const [rel, contents] of Object.entries(entries)) {
          if (rel.endsWith('/')) continue;
          const path = '/' + rel;
          const dir = dirname(path);
          if (dir !== '/') await call('mkdir', { path: dir });
          await writeFile(path, contents);
          count++;
        }
        await reloadDir('/');
        await refreshQuota();
        toast.success(`Restored ${count} files`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    };
    input.click();
  };

  const ModeButton = ({
    mode,
    icon: Icon,
    label,
  }: {
    mode: 'tree' | 'search' | 'stats';
    icon: typeof TreePine;
    label: string;
  }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={viewMode === mode ? 'secondary' : 'ghost'}
          size="icon"
          onClick={() => setViewMode(mode)}
          aria-label={label}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex items-center gap-1 px-2 h-9 border-b border-border bg-muted/20">
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setPaletteOpen(true)}>
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs">Quick open</span>
        <kbd className="ml-1 text-[10px] text-muted-foreground border border-border rounded px-1">
          ⌘P
        </kbd>
      </Button>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ModeButton mode="tree" icon={TreePine} label="File tree" />
      <ModeButton mode="stats" icon={HardDrive} label="Storage stats" />
      <Separator orientation="vertical" className="mx-1 h-5" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={handleNewFile} aria-label="New file">
            <FilePlus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New file (⌘N)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={handleNewDir} aria-label="New folder">
            <FolderPlus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New folder (⇧⌘N)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload"
          >
            <Upload className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Upload to {targetDir}</TooltipContent>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleUpload(e.target.files);
          e.target.value = '';
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => segmentedInputRef.current?.click()}
            aria-label="Upload segmented"
          >
            <Split className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Upload segmented (split file into shards)</TooltipContent>
      </Tooltip>
      <input
        ref={segmentedInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          handleUploadSegmented(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={handleExportZip} aria-label="Export zip">
            <Download className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Export OPFS as .zip</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={handleImportZip} aria-label="Import zip">
            <Upload className="h-4 w-4 -rotate-180" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Restore from .zip</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-5" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={liveWatch ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setLiveWatch(!liveWatch)}
            aria-label="Live watch"
          >
            {liveWatch ? <Activity className="h-4 w-4 text-primary" /> : <Clock className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Live watch (poll 2s)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              await refreshAll();
              if (selected) await reloadAncestor(selected);
            }}
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShortcutSheetOpen(true)}
            aria-label="Shortcuts"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
      </Tooltip>
    </div>
  );
}

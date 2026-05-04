import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { hierarchy, treemap, type HierarchyRectangularNode } from 'd3-hierarchy';
import { interpolatePlasma } from 'd3-scale-chromatic';
import { call } from '../bridge/rpc';
import type { FsEntry } from '../bridge/types';
import { formatBytes } from '../lib/formatBytes';
import { useStore } from '../state/store';

interface Node {
  name: string;
  path: string;
  size: number;
  kind: 'file' | 'directory';
  ext: string;
  children?: Node[];
}

function extOf(name: string) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

function buildTree(entries: FsEntry[]): Node {
  const root: Node = { name: '/', path: '/', size: 0, kind: 'directory', ext: '', children: [] };
  const byPath = new Map<string, Node>();
  byPath.set('/', root);
  for (const e of entries.sort((a, b) => a.path.length - b.path.length)) {
    const parts = e.path.split('/').filter(Boolean);
    const parentPath = '/' + parts.slice(0, -1).join('/');
    const parent = byPath.get(parentPath === '' ? '/' : parentPath) ?? root;
    const node: Node = {
      name: e.name,
      path: e.path,
      size: e.kind === 'file' ? e.size : 0,
      kind: e.kind,
      ext: extOf(e.name),
      children: e.kind === 'directory' ? [] : undefined,
    };
    parent.children = parent.children ?? [];
    parent.children.push(node);
    byPath.set(e.path, node);
  }
  return root;
}

function colorFor(ext: string): string {
  if (!ext) return '#6b7280';
  let hash = 0;
  for (let i = 0; i < ext.length; i++) hash = (hash * 31 + ext.charCodeAt(i)) >>> 0;
  return interpolatePlasma(((hash % 100) + 30) / 130);
}

export function StatsTreemap() {
  const setViewMode = useStore((s) => s.setViewMode);
  const openFile = useStore((s) => s.openFile);
  const selectPath = useStore((s) => s.selectPath);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [hovered, setHovered] = useState<HierarchyRectangularNode<Node> | null>(null);

  useEffect(() => {
    let cancelled = false;
    call('tree', { path: '/' })
      .then((r) => {
        if (!cancelled) setEntries(r);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!entries || size.w === 0 || size.h === 0) return null;
    const tree = buildTree(entries);
    const root = hierarchy(tree, (d) => d.children).sum((d) => d.size).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return treemap<Node>().size([size.w, size.h]).paddingInner(2).paddingOuter(4).round(true)(root);
  }, [entries, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const leaves = layout.leaves();
    for (const leaf of leaves) {
      const w = leaf.x1 - leaf.x0;
      const h = leaf.y1 - leaf.y0;
      if (w < 1 || h < 1) continue;
      ctx.fillStyle = colorFor(leaf.data.ext);
      ctx.globalAlpha = leaf === hovered ? 1 : 0.85;
      ctx.fillRect(leaf.x0, leaf.y0, w, h);
      if (w > 60 && h > 18) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.textBaseline = 'top';
        const text = leaf.data.name;
        ctx.fillText(text.length * 6 < w - 6 ? text : text.slice(0, Math.max(0, Math.floor((w - 6) / 6))) + '…', leaf.x0 + 4, leaf.y0 + 4);
        if (h > 32) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.font = '10px ui-monospace, monospace';
          ctx.fillText(formatBytes(leaf.value ?? 0), leaf.x0 + 4, leaf.y0 + 18);
        }
      }
    }
  }, [layout, size, hovered]);

  const onMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!layout) return;
    const rect = (ev.target as HTMLCanvasElement).getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const leaf = layout.leaves().find((l) => x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1);
    setHovered(leaf ?? null);
  };

  const onClick = () => {
    if (!hovered) return;
    setViewMode('tree');
    selectPath(hovered.data.path);
    if (hovered.data.kind === 'file') openFile(hovered.data.path);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border bg-muted/10 text-xs text-muted-foreground flex gap-3 items-center">
        <span className="font-medium text-foreground">Storage by file</span>
        <span>{entries?.filter((e) => e.kind === 'file').length ?? 0} files</span>
        <div className="flex-1" />
        {hovered && (
          <span className="font-mono">
            {hovered.data.path} — {formatBytes(hovered.value ?? 0)}
          </span>
        )}
      </div>
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {!entries && (
          <div className="absolute inset-0 flex items-center gap-2 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Walking OPFS…
          </div>
        )}
        {entries?.filter((e) => e.kind === 'file').length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No files yet
          </div>
        )}
        <canvas
          ref={canvasRef}
          onMouseMove={onMove}
          onMouseLeave={() => setHovered(null)}
          onClick={onClick}
          className="cursor-pointer"
        />
      </div>
    </div>
  );
}

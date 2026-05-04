import { Globe, Lock } from 'lucide-react';
import { useStore } from '../state/store';
import { QuotaBar } from './QuotaBar';
import { formatBytes } from '../lib/formatBytes';

export function StatusBar({ totalFiles, totalDirs }: { totalFiles: number; totalDirs: number }) {
  const bridge = useStore((s) => s.bridge);
  const activeTab = useStore((s) => s.activeTab);
  const tabs = useStore((s) => s.tabs);
  const nodes = useStore((s) => s.nodes);

  let activeSize: number | null = null;
  if (activeTab) {
    for (const node of nodes.values()) {
      const found = node.children?.find((c) => c.path === activeTab);
      if (found) {
        activeSize = found.size;
        break;
      }
    }
  }

  return (
    <div className="flex items-center gap-3 h-7 px-3 border-t border-border bg-muted/20 text-xs text-muted-foreground">
      <QuotaBar />
      <span className="tabular-nums">
        {totalFiles} {totalFiles === 1 ? 'file' : 'files'} · {totalDirs}{' '}
        {totalDirs === 1 ? 'dir' : 'dirs'}
      </span>
      <div className="flex-1" />
      {activeTab && (
        <span className="tabular-nums">
          {activeSize != null ? formatBytes(activeSize) : '—'}
        </span>
      )}
      {tabs.find((t) => t.path === activeTab)?.dirty && (
        <span className="text-primary">● modified</span>
      )}
      {bridge?.origin && (
        <span className="flex items-center gap-1">
          <Globe className="h-3 w-3" />
          {new URL(bridge.origin).host || bridge.origin}
        </span>
      )}
      <Lock className="h-3 w-3 opacity-50" />
    </div>
  );
}

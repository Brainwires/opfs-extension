import { useStore } from '../state/store';
import { Progress } from './ui/progress';
import { formatBytes, formatPercent } from '../lib/formatBytes';

export function QuotaBar() {
  const quota = useStore((s) => s.quota);
  if (!quota || !quota.quota) return null;
  const pct = (quota.usage / quota.quota) * 100;
  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <Progress value={pct} className="w-24" />
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatBytes(quota.usage)} / {formatBytes(quota.quota)}
      </span>
      <span className="text-xs text-muted-foreground/70 tabular-nums">
        {formatPercent(quota.usage, quota.quota)}
      </span>
    </div>
  );
}

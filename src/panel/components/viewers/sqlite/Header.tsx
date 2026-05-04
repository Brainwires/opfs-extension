import { Activity, Database, FolderOpen, Loader2, RefreshCw, Save, Snowflake, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { Badge } from '../../ui/badge';
import { formatBytes } from '../../../lib/formatBytes';
import type { MultipartGroup } from '../../../lib/multipart';

interface Props {
  group: MultipartGroup;
  /** 'live' = routing through page's exposeForDevtools bridge; 'snapshot' = local Database from bytes. */
  engineMode: 'live' | 'snapshot' | null;
  /** Bridged db name when engineMode==='live'. */
  bridgedName?: string | null;
  dirty: boolean;
  saving: boolean;
  onRefresh: () => void;
  onExportSqlite: () => void;
  onSave: () => void;
  onCleanupBare: (() => void) | null;
}

export function Header({
  group,
  engineMode,
  bridgedName,
  dirty,
  saving,
  onRefresh,
  onExportSqlite,
  onSave,
  onCleanupBare,
}: Props) {
  const shardCount = group.shards.length;
  const modeBadge =
    group.mode === 'pure' ? 'multipart' : group.mode === 'legacy' ? 'legacy multipart' : 'single';

  return (
    <div className="flex items-center gap-2 px-3 h-9 border-b border-border bg-muted/20">
      <Database className="h-4 w-4 text-sky-500" />
      <span className="font-medium text-sm">{group.base}</span>
      <Badge variant={group.mode === 'pure' ? 'default' : 'secondary'}>{modeBadge}</Badge>
      {engineMode === 'live' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="default" className="gap-1 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/20">
              <Activity className="h-3 w-3" />
              live{bridgedName && ` (${bridgedName})`}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            Page exposed this db via exposeForDevtools(). Reads + writes go
            through the page's own engine — no lock conflict.
          </TooltipContent>
        </Tooltip>
      )}
      {engineMode === 'snapshot' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="gap-1">
              <Snowflake className="h-3 w-3" />
              snapshot
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            Reading bytes directly from OPFS. Writes attempted while the page
            holds the SyncAccessHandle will fail. Add{' '}
            <code className="font-mono">exposeForDevtools(db)</code> to your
            app for fully live editing.
          </TooltipContent>
        </Tooltip>
      )}
      {shardCount > 1 && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {shardCount} shards · {formatBytes(group.totalSize)}
          {group.reservedShards.length > 0 && (
            <span
              className="ml-1 opacity-70"
              title={`${group.reservedShards.length} pre-allocated empty shards held open by the page`}
            >
              {' '}+{group.reservedShards.length} reserved
            </span>
          )}
        </span>
      )}
      {shardCount === 1 && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatBytes(group.totalSize)}
        </span>
      )}
      {group.bareLeftover && onCleanupBare && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCleanupBare}
              className="text-amber-500 gap-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Stranded {group.bareLeftover.name}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Stale legacy file from a pre-pure-multiplex era. Click to delete it (not part of the
            active DB).
          </TooltipContent>
        </Tooltip>
      )}
      <div className="flex-1" />
      {dirty && (
        <span className="text-xs text-primary flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          unsaved changes
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reload from OPFS</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" onClick={onExportSqlite}>
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download as standard .sqlite (concatenated)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!dirty || saving}
            className="gap-1"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
        </TooltipTrigger>
        <TooltipContent>Write changes back to all shards (⌘S)</TooltipContent>
      </Tooltip>
    </div>
  );
}

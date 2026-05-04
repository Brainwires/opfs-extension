import { Database, FolderOpen, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { Badge } from '../../ui/badge';
import { formatBytes } from '../../../lib/formatBytes';
import type { MultipartGroup } from '../../../lib/multipart';

interface Props {
  group: MultipartGroup;
  dirty: boolean;
  saving: boolean;
  onRefresh: () => void;
  onExportSqlite: () => void;
  onSave: () => void;
  onCleanupBare: (() => void) | null;
}

export function Header({
  group,
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

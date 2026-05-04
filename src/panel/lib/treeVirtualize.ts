import type { FsEntry } from '../bridge/types';
import type { MultipartGroup } from './multipart';

export type TreeItem =
  | { kind: 'entry'; entry: FsEntry }
  | { kind: 'group'; group: MultipartGroup };

/**
 * Transform a directory's raw FsEntry listing into a render-friendly list that
 * collapses multipart-group members into a single synthetic 'group' item.
 * Non-group entries (other files, directories, the bareLeftover) are passed
 * through; the group item carries the full MultipartGroup so the renderer can
 * lazily reveal the underlying shards on expand.
 */
export function virtualize(
  children: FsEntry[],
  groupsForDir: Map<string, MultipartGroup> | undefined,
): TreeItem[] {
  if (!groupsForDir || groupsForDir.size === 0) {
    return children.map((entry) => ({ kind: 'entry' as const, entry }));
  }
  const consumed = new Set<string>();
  for (const group of groupsForDir.values()) {
    for (const s of group.shards) consumed.add(s.path);
    for (const s of group.reservedShards) consumed.add(s.path);
  }
  const out: TreeItem[] = [];
  const emittedGroupIds = new Set<string>();
  for (const child of children) {
    if (consumed.has(child.path)) {
      // Find the group this shard belongs to and emit it once at this position.
      for (const group of groupsForDir.values()) {
        if (
          group.shards.some((s) => s.path === child.path) ||
          group.reservedShards.some((s) => s.path === child.path)
        ) {
          if (!emittedGroupIds.has(group.id)) {
            emittedGroupIds.add(group.id);
            out.push({ kind: 'group', group });
          }
          break;
        }
      }
    } else {
      out.push({ kind: 'entry', entry: child });
    }
  }
  return out;
}

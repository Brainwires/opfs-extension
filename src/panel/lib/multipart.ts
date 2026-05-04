import type { FsEntry } from '../bridge/types';
import { call, readFile, writeFile } from '../bridge/rpc';
import { dirname } from './sniff';

export type MultipartMode = 'pure' | 'legacy' | 'single';

export interface MultipartGroup {
  base: string;
  dir: string;
  mode: MultipartMode;
  shards: FsEntry[];
  totalSize: number;
  shardSize: number;
  bareLeftover?: FsEntry;
  /** Stable id usable as a tab key. For multipart: dir + base; for single: full path. */
  id: string;
}

/** Logical path for a group (dir/base, no `.000`). Used as the user-facing path/breadcrumb. */
export function groupPath(group: MultipartGroup): string {
  if (group.dir === '/') return `/${group.base}`;
  return `${group.dir}/${group.base}`;
}

/** Strip a trailing `.NNN` (3 digits) suffix and return the base + index. */
export function parseShardName(name: string): { base: string; index: number } | null {
  const m = name.match(/^(.+)\.(\d{3})$/);
  if (!m) return null;
  return { base: m[1], index: Number.parseInt(m[2], 10) };
}

/** Pad an integer to a 3-digit shard suffix. */
export function shardSuffix(index: number): string {
  return String(index).padStart(3, '0');
}

/** Derive (base, dir) from any path. Multipart shards strip their `.NNN`. */
export function baseOf(path: string): { dir: string; base: string; index: number | null } {
  const dir = dirname(path);
  const name = path.slice(dir === '/' ? 1 : dir.length + 1);
  const parsed = parseShardName(name);
  return parsed
    ? { dir, base: parsed.base, index: parsed.index }
    : { dir, base: name, index: null };
}

/**
 * Resolve a multipart group from a single path + the listing of its directory.
 * Mirrors rsqlite-vfs/src/multiplex.rs:71-111 — pure-mode preferred over legacy.
 */
export function resolveGroup(path: string, siblings: FsEntry[]): MultipartGroup {
  const { dir, base } = baseOf(path);
  const byName = new Map<string, FsEntry>();
  for (const e of siblings) {
    if (e.kind !== 'file') continue;
    byName.set(e.name, e);
  }

  // Probe shard 0 by suffix — pure-mode signal
  const zero = byName.get(`${base}.000`);
  if (zero && zero.size > 0) {
    const shards: FsEntry[] = [zero];
    for (let i = 1; ; i++) {
      const next = byName.get(`${base}.${shardSuffix(i)}`);
      if (!next || next.size === 0) break;
      shards.push(next);
    }
    const bareLeftover = byName.get(base);
    return {
      base,
      dir,
      mode: 'pure',
      shards,
      totalSize: shards.reduce((a, e) => a + e.size, 0),
      shardSize: zero.size,
      ...(bareLeftover ? { bareLeftover } : {}),
      id: dir === '/' ? `/${base}` : `${dir}/${base}`,
    };
  }

  // Legacy: bare base + .001 onwards
  const bare = byName.get(base);
  const one = byName.get(`${base}.001`);
  if (bare && bare.size > 0 && one && one.size > 0) {
    const shards: FsEntry[] = [bare];
    for (let i = 1; ; i++) {
      const next = byName.get(`${base}.${shardSuffix(i)}`);
      if (!next || next.size === 0) break;
      shards.push(next);
    }
    return {
      base,
      dir,
      mode: 'legacy',
      shards,
      totalSize: shards.reduce((a, e) => a + e.size, 0),
      shardSize: bare.size,
      id: dir === '/' ? `/${base}` : `${dir}/${base}`,
    };
  }

  // Single file
  const self = byName.get(base) ?? byName.get(path.slice(dir === '/' ? 1 : dir.length + 1));
  if (self) {
    return {
      base: self.name,
      dir,
      mode: 'single',
      shards: [self],
      totalSize: self.size,
      shardSize: self.size,
      id: self.path,
    };
  }
  // Fallback when caller path doesn't match any sibling — synthesize a single-shard group from the caller path
  return {
    base: path.slice(dir === '/' ? 1 : dir.length + 1),
    dir,
    mode: 'single',
    shards: [],
    totalSize: 0,
    shardSize: 0,
    id: path,
  };
}

/**
 * Resolve all multipart groups present in a directory listing. Single-file SQLite is
 * detected separately (by magic bytes), so this only returns multi-shard groups.
 */
export function detectGroupsInDir(dir: string, siblings: FsEntry[]): Map<string, MultipartGroup> {
  const out = new Map<string, MultipartGroup>();
  const seen = new Set<string>();
  const byName = new Map<string, FsEntry>();
  for (const e of siblings) {
    if (e.kind === 'file') byName.set(e.name, e);
  }

  for (const entry of siblings) {
    if (entry.kind !== 'file') continue;
    if (seen.has(entry.path)) continue;
    const parsed = parseShardName(entry.name);
    const base = parsed ? parsed.base : entry.name;
    if (out.has(base)) continue;
    // Try to resolve a group anchored at this base
    const group = resolveGroup(
      dir === '/' ? `/${base}.000` : `${dir}/${base}.000`,
      siblings,
    );
    if (group.mode === 'single' && group.shards.length <= 1) continue;
    out.set(base, group);
    for (const s of group.shards) seen.add(s.path);
    if (group.bareLeftover) seen.add(group.bareLeftover.path);
  }
  return out;
}

/** Read all shards in order, concatenating into a single Uint8Array. */
export async function loadGroup(
  group: MultipartGroup,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const out = new Uint8Array(group.totalSize);
  let cursor = 0;
  for (const shard of group.shards) {
    const bytes = await readFile(shard.path, (read) => {
      onProgress?.(cursor + read, group.totalSize);
    });
    out.set(bytes, cursor);
    cursor += bytes.length;
  }
  onProgress?.(cursor, group.totalSize);
  return out;
}

/**
 * Split a serialized DB and write back as the same multipart layout. Trailing shards
 * that no longer exist are deleted. Throws Error('Locked: ...') if any current shard
 * reports `locked: true`.
 */
export async function reshardAndWrite(
  group: MultipartGroup,
  bytes: Uint8Array,
  onProgress?: (written: number, total: number) => void,
): Promise<{ shardsWritten: number; shardsRemoved: number }> {
  if (group.shards.length === 0) {
    throw new Error('Cannot reshard an empty group; open the file first');
  }

  // Lock check
  for (const shard of group.shards) {
    const stat = await call('stat', { path: shard.path });
    if (stat.locked) {
      throw new Error(`Locked: ${shard.path} is currently held by the page`);
    }
  }

  const shardSize = group.shardSize > 0 ? group.shardSize : bytes.length;
  let cursor = 0;
  let index = 0;
  let written = 0;
  while (cursor < bytes.length) {
    const end = Math.min(cursor + shardSize, bytes.length);
    const slice = bytes.subarray(cursor, end);
    const path = shardPath(group, index);
    await writeFile(path, slice, (w) => onProgress?.(written + w, bytes.length));
    written += slice.length;
    cursor = end;
    index++;
  }
  // Edge case: an exactly-empty DB still needs at least one shard
  if (index === 0) {
    await writeFile(shardPath(group, 0), new Uint8Array(0));
    index = 1;
  }
  // Delete any stale trailing shards that no longer exist
  let removed = 0;
  for (let i = index; i < group.shards.length; i++) {
    await call('rm', { path: group.shards[i].path, recursive: false });
    removed++;
  }
  return { shardsWritten: index, shardsRemoved: removed };
}

/** Compute the on-disk path for shard N in a group, respecting pure vs legacy mode. */
export function shardPath(group: MultipartGroup, index: number): string {
  const filename =
    group.mode === 'legacy' && index === 0 ? group.base : `${group.base}.${shardSuffix(index)}`;
  return group.dir === '/' ? `/${filename}` : `${group.dir}/${filename}`;
}

/** Remove the bare `{base}` file when it's a stranded legacy leftover from a pure-mode DB. */
export async function cleanupBareLeftover(group: MultipartGroup): Promise<void> {
  if (!group.bareLeftover) return;
  await call('rm', { path: group.bareLeftover.path, recursive: false });
}

/**
 * Download a multipart group as a single concatenated file named after `base`.
 * Streams shards in order to avoid materializing the whole DB twice in memory.
 */
export async function downloadJoined(
  group: MultipartGroup,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  // Build a Blob from sequential shard reads. We accumulate Uint8Array chunks
  // and concatenate at the end via Blob — Blob() handles arbitrary BlobPart[].
  const parts: BlobPart[] = [];
  let cursor = 0;
  for (const shard of group.shards) {
    const bytes = await readFile(shard.path, (read) => {
      onProgress?.(cursor + read, group.totalSize);
    });
    parts.push(bytes as BlobPart);
    cursor += bytes.length;
  }
  onProgress?.(cursor, group.totalSize);
  const blob = new Blob(parts, { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = group.base;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Upload a single browser File into a multipart layout under `targetDir`. The base
 * name comes from the file unless `baseName` is supplied. Writes `{base}.000`,
 * `{base}.001`, … each up to `chunkSize` bytes. Pure-multiplex mode (no bare file).
 */
export async function uploadSegmented(
  targetDir: string,
  file: File,
  chunkSize: number,
  baseName?: string,
  onProgress?: (written: number, total: number) => void,
): Promise<{ base: string; shardCount: number }> {
  if (chunkSize <= 0) throw new Error('chunkSize must be > 0');
  const base = (baseName ?? file.name).replace(/\.\d{3}$/, '');
  const total = file.size;
  if (total === 0) {
    const path = targetDir === '/' ? `/${base}.000` : `${targetDir}/${base}.000`;
    await writeFile(path, new Uint8Array(0));
    return { base, shardCount: 1 };
  }
  let written = 0;
  let index = 0;
  while (written < total) {
    const end = Math.min(written + chunkSize, total);
    const slice = file.slice(written, end);
    const bytes = new Uint8Array(await slice.arrayBuffer());
    const filename = `${base}.${shardSuffix(index)}`;
    const path = targetDir === '/' ? `/${filename}` : `${targetDir}/${filename}`;
    await writeFile(path, bytes, (w) => onProgress?.(written + w, total));
    written = end;
    index++;
  }
  return { base, shardCount: index };
}

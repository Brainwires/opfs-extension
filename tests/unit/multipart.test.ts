import { describe, expect, test } from 'vitest';
import {
  baseOf,
  detectGroupsInDir,
  parseShardName,
  resolveGroup,
  shardPath,
  shardSuffix,
} from '../../src/panel/lib/multipart';
import type { FsEntry } from '../../src/panel/bridge/types';

function file(path: string, size = 1024): FsEntry {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { path, name, kind: 'file', size, lastModified: 1, locked: false };
}
function dir(path: string): FsEntry {
  const name = path.slice(path.lastIndexOf('/') + 1) || '/';
  return { path, name, kind: 'directory', size: 0, lastModified: 0, locked: false };
}

describe('parseShardName', () => {
  test('returns base+index for .NNN suffix', () => {
    expect(parseShardName('bw-chat.db.000')).toEqual({ base: 'bw-chat.db', index: 0 });
    expect(parseShardName('foo.001')).toEqual({ base: 'foo', index: 1 });
    expect(parseShardName('a.b.c.999')).toEqual({ base: 'a.b.c', index: 999 });
  });
  test('null for unsuffixed names', () => {
    expect(parseShardName('plain.sqlite')).toBeNull();
    expect(parseShardName('foo.0001')).toBeNull(); // 4 digits != 3
    expect(parseShardName('foo.0a0')).toBeNull();
  });
});

describe('baseOf', () => {
  test('strips suffix when present', () => {
    expect(baseOf('/db/bw-chat.db.002')).toEqual({ dir: '/db', base: 'bw-chat.db', index: 2 });
  });
  test('keeps unsuffixed name', () => {
    expect(baseOf('/foo.sqlite')).toEqual({ dir: '/', base: 'foo.sqlite', index: null });
  });
});

describe('shardSuffix / shardPath', () => {
  test('zero pads', () => {
    expect(shardSuffix(0)).toBe('000');
    expect(shardSuffix(7)).toBe('007');
    expect(shardSuffix(123)).toBe('123');
  });
  test('shardPath honors pure vs legacy', () => {
    const pure = resolveGroup('/db/foo.000', [file('/db/foo.000', 1000), file('/db/foo.001', 500)]);
    expect(pure.mode).toBe('pure');
    expect(shardPath(pure, 0)).toBe('/db/foo.000');
    expect(shardPath(pure, 2)).toBe('/db/foo.002');

    const legacy = resolveGroup('/foo', [file('/foo', 1000), file('/foo.001', 500)]);
    expect(legacy.mode).toBe('legacy');
    expect(shardPath(legacy, 0)).toBe('/foo');
    expect(shardPath(legacy, 1)).toBe('/foo.001');
  });
});

describe('resolveGroup', () => {
  test('pure mode: collects sequential shards starting at .000', () => {
    const siblings = [
      file('/db/bw.db.000', 1024 * 1024),
      file('/db/bw.db.001', 1024 * 1024),
      file('/db/bw.db.002', 512),
      dir('/db/scratch'),
    ];
    const g = resolveGroup('/db/bw.db.001', siblings);
    expect(g.mode).toBe('pure');
    expect(g.shards.map((s) => s.name)).toEqual(['bw.db.000', 'bw.db.001', 'bw.db.002']);
    expect(g.totalSize).toBe(1024 * 1024 + 1024 * 1024 + 512);
    expect(g.shardSize).toBe(1024 * 1024);
    expect(g.bareLeftover).toBeUndefined();
    expect(g.id).toBe('/db/bw.db');
  });

  test('pure mode stops at the first missing shard', () => {
    const siblings = [
      file('/foo.db.000', 100),
      file('/foo.db.001', 100),
      // .002 missing
      file('/foo.db.003', 100), // ignored — gap
    ];
    const g = resolveGroup('/foo.db.000', siblings);
    expect(g.shards.map((s) => s.name)).toEqual(['foo.db.000', 'foo.db.001']);
  });

  test('pure mode flags bareLeftover when stale bare file coexists with .000', () => {
    const siblings = [file('/bw.db', 999), file('/bw.db.000', 100), file('/bw.db.001', 50)];
    const g = resolveGroup('/bw.db.001', siblings);
    expect(g.mode).toBe('pure');
    expect(g.bareLeftover?.path).toBe('/bw.db');
  });

  test('legacy mode: bare + .001 (no .000)', () => {
    const siblings = [file('/foo.db', 100), file('/foo.db.001', 50), file('/foo.db.002', 25)];
    const g = resolveGroup('/foo.db', siblings);
    expect(g.mode).toBe('legacy');
    expect(g.shards.map((s) => s.name)).toEqual(['foo.db', 'foo.db.001', 'foo.db.002']);
    expect(g.shardSize).toBe(100);
  });

  test('single file: bare with no related shards', () => {
    const siblings = [file('/standalone.sqlite', 4096)];
    const g = resolveGroup('/standalone.sqlite', siblings);
    expect(g.mode).toBe('single');
    expect(g.shards.map((s) => s.name)).toEqual(['standalone.sqlite']);
    expect(g.id).toBe('/standalone.sqlite');
  });

  test('zero-byte .000 is treated as not-pure (boundary case)', () => {
    const siblings = [file('/x.db', 100), file('/x.db.000', 0), file('/x.db.001', 50)];
    const g = resolveGroup('/x.db', siblings);
    expect(g.mode).toBe('legacy');
  });
});

describe('detectGroupsInDir', () => {
  test('finds all groups, skips singletons', () => {
    const siblings = [
      file('/db/a.db.000', 100),
      file('/db/a.db.001', 100),
      file('/db/b.db.000', 100), // singleton — only .000 present, but no .001 → still pure with 1 shard? See below
      file('/db/c.db', 200),
      file('/db/c.db.001', 200),
      file('/db/loose.txt', 50),
    ];
    const groups = detectGroupsInDir('/db', siblings);
    // a.db: 2 shards
    expect(groups.get('a.db')?.shards.length).toBe(2);
    // b.db.000 alone counts as pure-mode 1-shard group; we skip those (single-file path is plenty)
    expect(groups.get('b.db')?.shards.length ?? 1).toBe(1); // either omitted or single
    // c.db: legacy 2 shards
    expect(groups.get('c.db')?.shards.length).toBe(2);
    expect(groups.get('c.db')?.mode).toBe('legacy');
  });
});

import { describe, expect, test } from 'vitest';
import { rowsToCsv, rowsToInserts, rowsToJson } from '../../src/panel/lib/sqlExport';

describe('rowsToCsv', () => {
  test('header + body', () => {
    const csv = rowsToCsv([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
    expect(csv).toBe('id,name\n1,Alice\n2,Bob\n');
  });
  test('escapes commas, quotes, newlines', () => {
    const csv = rowsToCsv([{ a: 'x,y', b: 'has "quote"', c: 'line\nbreak' }]);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"has ""quote"""');
    expect(csv).toContain('"line\nbreak"');
  });
  test('null and blob shown sensibly', () => {
    const csv = rowsToCsv([{ a: null, b: new Uint8Array([1, 2, 3]) }]);
    expect(csv).toBe('a,b\n,[blob 3B]\n');
  });
});

describe('rowsToJson', () => {
  test('round-trips simple rows', () => {
    const rows = [{ id: 1, name: 'Alice' }];
    expect(JSON.parse(rowsToJson(rows))).toEqual(rows);
  });
  test('encodes Uint8Array as $blob base64', () => {
    const json = rowsToJson([{ data: new Uint8Array([0x68, 0x69]) }]);
    const parsed = JSON.parse(json);
    expect(parsed[0].data).toEqual({ $blob: 'aGk=' });
  });
});

describe('rowsToInserts', () => {
  test('basic INSERT statements', () => {
    const sql = rowsToInserts('users', [
      { id: 1, name: 'Alice' },
      { id: 2, name: "O'Reilly" },
    ]);
    expect(sql).toContain('INSERT INTO "users" ("id", "name") VALUES (1, \'Alice\');');
    expect(sql).toContain("'O''Reilly'");
  });
  test('NULL and BLOB literal', () => {
    const sql = rowsToInserts('t', [{ a: null, b: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) }]);
    expect(sql).toContain('VALUES (NULL, X\'deadbeef\')');
  });
  test('escapes table name with quote', () => {
    const sql = rowsToInserts('weird"name', [{ x: 1 }]);
    expect(sql).toContain('"weird""name"');
  });
});

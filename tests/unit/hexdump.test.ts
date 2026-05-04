import { describe, expect, test } from 'vitest';
import { offsetLabel, rowAt, rowCount } from '../../src/panel/lib/hexdump';

describe('hexdump', () => {
  test('rowCount handles partial last row', () => {
    expect(rowCount(0)).toBe(0);
    expect(rowCount(15)).toBe(1);
    expect(rowCount(16)).toBe(1);
    expect(rowCount(17)).toBe(2);
    expect(rowCount(1024)).toBe(64);
  });

  test('offsetLabel zero-pads to 8 hex digits', () => {
    expect(offsetLabel(0)).toBe('00000000');
    expect(offsetLabel(0xdeadbeef)).toBe('deadbeef');
    expect(offsetLabel(16)).toBe('00000010');
  });

  test('rowAt formats hex bytes with split + ASCII', () => {
    const bytes = Uint8Array.from([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21, 0x00, 0x01, 0x02, 0x03,
    ]);
    const row = rowAt(bytes, 0);
    expect(row.offset).toBe(0);
    // Two-byte split happens between byte 7 and 8
    expect(row.hex).toContain('48 65 6c 6c 6f 20 77 6f');
    expect(row.hex).toMatch(/77 6f\s{2,}72 6c/);
    expect(row.ascii).toBe('Hello world!....');
  });

  test('rowAt pads short last row', () => {
    const bytes = Uint8Array.from([0x41, 0x42, 0x43]);
    const row = rowAt(bytes, 0);
    expect(row.ascii.startsWith('ABC')).toBe(true);
    expect(row.ascii.length).toBe(16);
  });
});

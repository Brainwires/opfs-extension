import { describe, expect, test } from 'vitest';
import { formatBytes, formatPercent, formatTimestamp } from '../../src/panel/lib/formatBytes';

describe('formatBytes', () => {
  test('zero / negative', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
  test('bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });
  test('kb / mb / gb / tb', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
  });
  test('rounds to 1 decimal by default', () => {
    expect(formatBytes(1500 * 1024)).toBe('1.5 MB');
    expect(formatBytes(2_500_000)).toBe('2.4 MB');
  });
  test('honors digit count', () => {
    expect(formatBytes(1024 * 1024 + 512 * 1024, 2)).toBe('1.50 MB');
  });
});

describe('formatPercent', () => {
  test('zero denom', () => {
    expect(formatPercent(0, 0)).toBe('0%');
    expect(formatPercent(5, 0)).toBe('0%');
  });
  test('basic percentages', () => {
    expect(formatPercent(50, 100)).toBe('50.0%');
    expect(formatPercent(1, 3)).toBe('33.3%');
  });
});

describe('formatTimestamp', () => {
  test('zero shows em dash', () => {
    expect(formatTimestamp(0)).toBe('—');
  });
  test('non-zero produces something parseable', () => {
    const out = formatTimestamp(Date.UTC(2026, 4, 4, 12, 0, 0));
    expect(out).not.toBe('—');
    expect(out.length).toBeGreaterThan(5);
  });
});

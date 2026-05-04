import { describe, expect, test } from 'vitest';
import { detect, basename, dirname } from '../../src/panel/lib/sniff';

const enc = new TextEncoder();

function bytesOf(...vals: number[]): Uint8Array {
  return Uint8Array.from(vals);
}

describe('sniff.detect', () => {
  test('PNG by magic', () => {
    const png = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
    expect(detect('whatever.bin', png)).toEqual({ kind: 'image', mime: 'image/png' });
  });

  test('JPEG by magic', () => {
    expect(detect('foo', bytesOf(0xff, 0xd8, 0xff, 0xe0)).kind).toBe('image');
  });

  test('GIF87a / GIF89a by magic', () => {
    expect(detect('a.bin', enc.encode('GIF87a___')).kind).toBe('image');
    expect(detect('a.bin', enc.encode('GIF89a___')).kind).toBe('image');
  });

  test('WebP requires RIFF header AND WEBP at offset 8', () => {
    const webp = new Uint8Array(20);
    webp.set(enc.encode('RIFF'), 0);
    webp.set(enc.encode('WEBP'), 8);
    expect(detect('a', webp).kind).toBe('image');
    // RIFF without WEBP should NOT detect as image
    const wav = new Uint8Array(20);
    wav.set(enc.encode('RIFF'), 0);
    wav.set(enc.encode('WAVE'), 8);
    expect(detect('a', wav).kind).not.toBe('image');
  });

  test('PDF by magic', () => {
    expect(detect('a.bin', enc.encode('%PDF-1.4...')).kind).toBe('pdf');
  });

  test('SQLite by magic', () => {
    const db = new Uint8Array(20);
    db.set(enc.encode('SQLite format 3'), 0);
    db[15] = 0; // proper magic ends with NUL
    expect(detect('whatever', db).kind).toBe('sqlite');
  });

  test('JSON by content (object)', () => {
    expect(detect('a', enc.encode('   { "a": 1 }')).kind).toBe('json');
  });

  test('JSON by content (array)', () => {
    expect(detect('a', enc.encode('[1, 2, 3]')).kind).toBe('json');
  });

  test('plain text detected', () => {
    const d = detect('notes.txt', enc.encode('hello world\nline two'));
    expect(d.kind).toBe('text');
    expect(d.encoding).toBe('utf-8');
  });

  test('UTF-8 BOM is detected', () => {
    const bom = bytesOf(0xef, 0xbb, 0xbf, 0x68, 0x69);
    expect(detect('a.txt', bom).encoding).toBe('utf-8-bom');
  });

  test('binary fallback for NUL-heavy content', () => {
    const buf = new Uint8Array(64);
    expect(detect('a', buf).kind).toBe('binary');
  });

  test('extension hints language for text', () => {
    expect(detect('a.ts', enc.encode('const x = 1;')).language).toBe('javascript');
    expect(detect('a.tsx', enc.encode('const x = 1;')).language).toBe('javascript');
    expect(detect('a.json', enc.encode('{"x":1}')).language).toBe('json');
    expect(detect('a.html', enc.encode('<html></html>')).language).toBe('html');
    expect(detect('a.css', enc.encode('body{}')).language).toBe('css');
    expect(detect('a.md', enc.encode('# hi')).language).toBe('markdown');
  });

  test('SVG by extension is treated as image with xml language', () => {
    expect(detect('icon.svg', enc.encode('<svg></svg>'))).toMatchObject({
      kind: 'image',
      mime: 'image/svg+xml',
      language: 'xml',
    });
  });
});

describe('basename / dirname', () => {
  test('basename strips up to last slash', () => {
    expect(basename('/a/b/c.txt')).toBe('c.txt');
    expect(basename('c.txt')).toBe('c.txt');
    expect(basename('/')).toBe('');
  });

  test('dirname returns / for top-level', () => {
    expect(dirname('/a.txt')).toBe('/');
    expect(dirname('/a/b/c.txt')).toBe('/a/b');
    expect(dirname('/')).toBe('/');
  });
});

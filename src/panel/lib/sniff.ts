export type DetectedKind =
  | 'text'
  | 'json'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'sqlite'
  | 'zip'
  | 'gzip'
  | 'binary';

export interface Detection {
  kind: DetectedKind;
  mime: string;
  encoding?: string;
  language?: string;
}

const SIG = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
  gif87: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  gif89: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF, plus WEBP at offset 8
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  zip: [0x50, 0x4b, 0x03, 0x04],
  gz: [0x1f, 0x8b],
  sqlite: [
    0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
  ],
  mp3id3: [0x49, 0x44, 0x33],
  ogg: [0x4f, 0x67, 0x67, 0x53],
  mp4ftyp: [0x66, 0x74, 0x79, 0x70], // appears at offset 4
};

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let printable = 0;
  let nonText = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) return false;
    if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
    else if (b >= 0x80) printable++; // any high byte: assume part of a UTF-8 multi-byte sequence
    else nonText++;
  }
  return sample.length > 0 && nonText / sample.length < 0.05 && printable > 0;
}

function looksLikeJson(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256))).trim();
  return head.startsWith('{') || head.startsWith('[');
}

const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
  jsx: 'javascript',
  json: 'json',
  json5: 'json',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'css',
  md: 'markdown',
  markdown: 'markdown',
};

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  if (i < 0) return '';
  return path.slice(i + 1).toLowerCase();
}

export function detect(path: string, bytes: Uint8Array): Detection {
  if (startsWith(bytes, SIG.sqlite)) return { kind: 'sqlite', mime: 'application/vnd.sqlite3' };
  if (startsWith(bytes, SIG.pdf)) return { kind: 'pdf', mime: 'application/pdf' };
  if (startsWith(bytes, SIG.png)) return { kind: 'image', mime: 'image/png' };
  if (startsWith(bytes, SIG.jpg)) return { kind: 'image', mime: 'image/jpeg' };
  if (startsWith(bytes, SIG.gif87) || startsWith(bytes, SIG.gif89)) {
    return { kind: 'image', mime: 'image/gif' };
  }
  if (
    startsWith(bytes, SIG.webp) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { kind: 'image', mime: 'image/webp' };
  }
  if (startsWith(bytes, SIG.zip)) return { kind: 'zip', mime: 'application/zip' };
  if (startsWith(bytes, SIG.gz)) return { kind: 'gzip', mime: 'application/gzip' };
  if (startsWith(bytes, SIG.ogg)) return { kind: 'audio', mime: 'audio/ogg' };
  if (startsWith(bytes, SIG.mp3id3)) return { kind: 'audio', mime: 'audio/mpeg' };
  if (startsWith(bytes, SIG.mp4ftyp, 4)) return { kind: 'video', mime: 'video/mp4' };

  const ext = extOf(path);
  if (ext === 'svg') return { kind: 'image', mime: 'image/svg+xml', language: 'xml' };

  if (looksLikeText(bytes)) {
    if (looksLikeJson(bytes) || ext === 'json' || ext === 'json5') {
      return { kind: 'json', mime: 'application/json', encoding: 'utf-8', language: 'json' };
    }
    return {
      kind: 'text',
      mime: 'text/plain',
      encoding: hasUtf8Bom(bytes) ? 'utf-8-bom' : 'utf-8',
      language: EXT_LANG[ext],
    };
  }
  return { kind: 'binary', mime: 'application/octet-stream' };
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  if (i <= 0) return '/';
  return path.slice(0, i);
}

// Build virtualized rows for a hex+ASCII view. 16 bytes per row.

export interface HexRow {
  offset: number;
  hex: string;
  ascii: string;
}

const HEX = '0123456789abcdef';

function toHex(b: number): string {
  return HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
}

export function rowAt(bytes: Uint8Array, row: number): HexRow {
  const offset = row * 16;
  const slice = bytes.subarray(offset, Math.min(offset + 16, bytes.length));
  let hex = '';
  let ascii = '';
  for (let i = 0; i < 16; i++) {
    if (i < slice.length) {
      hex += toHex(slice[i]);
      const b = slice[i];
      ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
    } else {
      hex += '  ';
      ascii += ' ';
    }
    hex += i === 7 ? '  ' : ' ';
  }
  return { offset, hex: hex.trimEnd(), ascii };
}

export function rowCount(byteLength: number): number {
  return Math.ceil(byteLength / 16);
}

export function offsetLabel(offset: number): string {
  return offset.toString(16).padStart(8, '0');
}

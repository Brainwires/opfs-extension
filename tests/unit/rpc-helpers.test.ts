import { describe, expect, test } from 'vitest';
import { b64ToBytes, bytesToB64 } from '../../src/panel/bridge/rpc';

describe('base64 helpers', () => {
  test('round-trip preserves arbitrary bytes', () => {
    const data = new Uint8Array(257);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 13) & 0xff;
    const round = b64ToBytes(bytesToB64(data));
    expect(Array.from(round)).toEqual(Array.from(data));
  });

  test('empty round-trip', () => {
    expect(bytesToB64(new Uint8Array(0))).toBe('');
    expect(b64ToBytes('').length).toBe(0);
  });

  test('large (1 MB) round-trip stays correct', () => {
    const N = 1024 * 1024;
    const data = new Uint8Array(N);
    for (let i = 0; i < N; i++) data[i] = i & 0xff;
    const round = b64ToBytes(bytesToB64(data));
    expect(round.length).toBe(N);
    expect(round[0]).toBe(0);
    expect(round[255]).toBe(255);
    expect(round[N - 1]).toBe((N - 1) & 0xff);
  });
});

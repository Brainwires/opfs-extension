import { useMemo } from 'react';
import { TextEditor } from './TextEditor';

const decoder = new TextDecoder('utf-8');

export function JsonViewer({ path, bytes }: { path: string; bytes: Uint8Array }) {
  const formatted = useMemo(() => {
    try {
      const parsed = JSON.parse(decoder.decode(bytes));
      return new TextEncoder().encode(JSON.stringify(parsed, null, 2));
    } catch {
      return bytes;
    }
  }, [bytes]);
  return <TextEditor path={path} bytes={formatted} language="json" />;
}

import { useEffect, useState } from 'react';

export function MediaViewer({
  bytes,
  mime,
  kind,
}: {
  bytes: Uint8Array;
  mime: string;
  kind: 'audio' | 'video';
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, mime]);

  if (!url) return null;
  return (
    <div className="flex h-full items-center justify-center bg-black/40 p-4">
      {kind === 'audio' ? (
        <audio controls src={url} className="w-full max-w-xl" />
      ) : (
        <video controls src={url} className="max-h-full max-w-full" />
      )}
    </div>
  );
}

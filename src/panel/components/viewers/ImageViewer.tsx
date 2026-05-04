import { useEffect, useState } from 'react';
import { formatBytes } from '../../lib/formatBytes';

export function ImageViewer({ bytes, mime, path }: { bytes: Uint8Array; mime: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, mime]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto bg-checkerboard flex items-center justify-center p-4">
        {url && (
          <img
            src={url}
            alt={path}
            className="max-h-full max-w-full object-contain shadow-lg"
            onLoad={(e) =>
              setDims({
                w: (e.target as HTMLImageElement).naturalWidth,
                h: (e.target as HTMLImageElement).naturalHeight,
              })
            }
          />
        )}
      </div>
      <div className="px-3 py-1.5 border-t border-border text-[11px] text-muted-foreground bg-muted/20 flex gap-3">
        <span>{mime}</span>
        {dims && (
          <span>
            {dims.w} × {dims.h}
          </span>
        )}
        <span>{formatBytes(bytes.length)}</span>
      </div>
    </div>
  );
}

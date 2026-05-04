import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

export function PdfViewer({ bytes }: { bytes: Uint8Array }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const pdfjs = await import('pdfjs-dist');
        // Use bundled worker via Vite's worker import
        const PdfWorker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = PdfWorker;
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        const root = containerRef.current;
        if (!root) return;
        root.innerHTML = '';
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'shadow border border-border my-2';
          const ctx = canvas.getContext('2d')!;
          await page.render({ canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
          if (cancelled) return;
          root.appendChild(canvas);
        }
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  return (
    <div className="h-full overflow-auto p-4 flex flex-col items-center bg-muted/10">
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" />
          Rendering PDF…
        </div>
      )}
      {error && <div className="text-sm text-destructive py-6">{error}</div>}
      <div ref={containerRef} className="flex flex-col items-center" />
    </div>
  );
}

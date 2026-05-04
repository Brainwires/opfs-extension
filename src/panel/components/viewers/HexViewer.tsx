import { useEffect, useMemo, useRef, useState } from 'react';
import { offsetLabel, rowAt, rowCount } from '../../lib/hexdump';

const ROW_HEIGHT = 18;
const OVERSCAN = 16;

export function HexViewer({ bytes }: { bytes: Uint8Array }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  const total = useMemo(() => rowCount(bytes.length), [bytes.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleRows = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2;
  const endRow = Math.min(total, startRow + visibleRows);
  const offsetTop = startRow * ROW_HEIGHT;

  const rows = useMemo(() => {
    const out = [];
    for (let r = startRow; r < endRow; r++) out.push(rowAt(bytes, r));
    return out;
  }, [bytes, startRow, endRow]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto bg-background font-mono text-[12px] leading-[18px]"
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
          {rows.map((row) => (
            <div key={row.offset} className="flex gap-3 px-3">
              <span className="w-20 text-muted-foreground/70 tabular-nums">
                {offsetLabel(row.offset)}
              </span>
              <span className="text-foreground tabular-nums whitespace-pre">{row.hex}</span>
              <span className="text-muted-foreground whitespace-pre">{row.ascii}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

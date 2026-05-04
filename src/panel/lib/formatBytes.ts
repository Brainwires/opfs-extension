const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : digits)} ${UNITS[i]}`;
}

export function formatPercent(num: number, denom: number): string {
  if (!denom) return '0%';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

export function formatTimestamp(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString(undefined, { hour12: false });
}

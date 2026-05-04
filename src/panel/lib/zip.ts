import { downloadZip } from 'client-zip';
import type { FsEntry } from '../bridge/types';
import { call, readFile } from '../bridge/rpc';

export async function exportTreeAsZip(rootPath: string, fileName = 'opfs.zip'): Promise<void> {
  const entries = await call('tree', { path: rootPath });
  const files = entries.filter((e) => e.kind === 'file');
  async function* gen() {
    for (const file of files) {
      const bytes = await readFile(file.path);
      const rel = file.path.slice(rootPath === '/' ? 1 : rootPath.length + 1);
      yield { name: rel, lastModified: new Date(file.lastModified || Date.now()), input: bytes };
    }
  }
  const blob = await downloadZip(gen()).blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function downloadFile(entry: FsEntry): Promise<void> {
  const bytes = await readFile(entry.path);
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = entry.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

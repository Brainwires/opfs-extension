import { useEffect } from 'react';
import { toast } from 'sonner';
import { useStore } from '../state/store';
import { call } from '../bridge/rpc';
import { dirname } from '../lib/sniff';

export function useGlobalShortcuts() {
  const store = useStore;

  useEffect(() => {
    function isInTextField(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (target.isContentEditable) return true;
      if (target.closest('.cm-editor')) return true;
      return false;
    }

    async function handler(ev: KeyboardEvent) {
      const s = store.getState();
      const meta = ev.metaKey || ev.ctrlKey;
      // ⌘P — palette
      if (meta && ev.key.toLowerCase() === 'p') {
        ev.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
        return;
      }
      // ⌘W — close tab
      if (meta && ev.key.toLowerCase() === 'w' && s.activeTab) {
        ev.preventDefault();
        s.closeTab(s.activeTab);
        return;
      }
      // ⌘. — toggle live watch
      if (meta && ev.key === '.') {
        ev.preventDefault();
        s.setLiveWatch(!s.liveWatch);
        return;
      }
      // ⌘N — new file
      if (meta && !ev.shiftKey && ev.key.toLowerCase() === 'n') {
        ev.preventDefault();
        const targetDir = !s.selected
          ? '/'
          : s.expanded.has(s.selected)
            ? s.selected
            : dirname(s.selected);
        const name = window.prompt('New file name', 'untitled.txt');
        if (!name) return;
        const path = targetDir === '/' ? `/${name}` : `${targetDir}/${name}`;
        try {
          await call('write', { path, b64: '', mode: 'replace' });
          await s.reloadDir(targetDir);
          await s.refreshQuota();
          s.openFile(path);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
        return;
      }
      // ⇧⌘N — new dir
      if (meta && ev.shiftKey && ev.key.toLowerCase() === 'n') {
        ev.preventDefault();
        const targetDir = !s.selected
          ? '/'
          : s.expanded.has(s.selected)
            ? s.selected
            : dirname(s.selected);
        const name = window.prompt('New directory', 'new-folder');
        if (!name) return;
        const path = targetDir === '/' ? `/${name}` : `${targetDir}/${name}`;
        try {
          await call('mkdir', { path });
          await s.reloadDir(targetDir);
          await s.expandDir(path);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
        return;
      }

      // Don't intercept the rest while typing in inputs
      if (isInTextField(ev.target)) return;

      // ? — shortcut sheet
      if (ev.key === '?' && !meta) {
        ev.preventDefault();
        s.setShortcutSheetOpen(!s.shortcutSheetOpen);
        return;
      }
      // F2 — rename
      if (ev.key === 'F2' && s.selected) {
        ev.preventDefault();
        const oldName = s.selected.split('/').pop() ?? '';
        const newName = window.prompt('Rename to', oldName);
        if (!newName || newName === oldName) return;
        const dir = dirname(s.selected);
        const newPath = dir === '/' ? `/${newName}` : `${dir}/${newName}`;
        try {
          await call('move', { from: s.selected, to: newPath });
          await s.reloadDir(dir);
          s.selectPath(newPath);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
        return;
      }
      // Delete
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && s.selected) {
        ev.preventDefault();
        if (!window.confirm(`Delete ${s.selected}?`)) return;
        try {
          const isDir = s.expanded.has(s.selected);
          await call('rm', { path: s.selected, recursive: isDir });
          s.closeTab(s.selected);
          await s.reloadAncestor(s.selected);
          await s.refreshQuota();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
        return;
      }

      // Tree arrow navigation
      if (['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'Enter'].includes(ev.key)) {
        const flat = flattenVisible(s);
        if (flat.length === 0) return;
        const idx = s.selected ? flat.findIndex((f) => f.path === s.selected) : -1;
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          const next = flat[Math.min(idx + 1, flat.length - 1)] ?? flat[0];
          s.selectPath(next.path);
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          const next = flat[Math.max(idx - 1, 0)] ?? flat[0];
          s.selectPath(next.path);
        } else if (ev.key === 'ArrowRight' && idx >= 0) {
          ev.preventDefault();
          const cur = flat[idx];
          if (cur.kind === 'directory' && !s.expanded.has(cur.path)) {
            void s.expandDir(cur.path);
          }
        } else if (ev.key === 'ArrowLeft' && idx >= 0) {
          ev.preventDefault();
          const cur = flat[idx];
          if (cur.kind === 'directory' && s.expanded.has(cur.path)) {
            s.collapseDir(cur.path);
          } else {
            const parent = dirname(cur.path);
            if (parent !== '/') s.selectPath(parent);
          }
        } else if (ev.key === 'Enter' && idx >= 0) {
          ev.preventDefault();
          const cur = flat[idx];
          if (cur.kind === 'directory') void s.toggleDir(cur.path);
          else s.openFile(cur.path);
        }
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store]);
}

function flattenVisible(state: ReturnType<typeof useStore.getState>) {
  const out: { path: string; kind: 'file' | 'directory' }[] = [];
  function walk(path: string) {
    const node = state.nodes.get(path);
    if (!node?.children) return;
    for (const child of node.children) {
      out.push({ path: child.path, kind: child.kind });
      if (child.kind === 'directory' && state.expanded.has(child.path)) walk(child.path);
    }
  }
  walk('/');
  return out;
}

import { create } from 'zustand';
import type { FsEntry, QuotaInfo } from '../bridge/types';
import { call, getBridgeInfo, resetBridge, RpcError } from '../bridge/rpc';
import { dirname } from '../lib/sniff';

type ViewMode = 'tree' | 'search' | 'stats';

export interface Tab {
  path: string;
  dirty: boolean;
  scratch?: Uint8Array;
}

export interface BridgeState {
  origin: string;
  hasOpfs: boolean;
}

interface TreeNode {
  path: string;
  loading: boolean;
  loaded: boolean;
  error?: string;
  children?: FsEntry[];
}

interface State {
  bridge: BridgeState | null;
  bridgeError: string | null;

  expanded: Set<string>;
  nodes: Map<string, TreeNode>;
  selected: string | null;

  tabs: Tab[];
  activeTab: string | null;

  quota: QuotaInfo | null;
  treeMtimes: Record<string, number>;

  viewMode: ViewMode;
  liveWatch: boolean;
  paletteOpen: boolean;
  shortcutSheetOpen: boolean;

  // actions
  init(): Promise<void>;
  refreshAll(): Promise<void>;
  expandDir(path: string): Promise<void>;
  collapseDir(path: string): void;
  toggleDir(path: string): Promise<void>;
  selectPath(path: string | null): void;

  openFile(path: string): void;
  closeTab(path: string): void;
  setActiveTab(path: string): void;
  markDirty(path: string, scratch: Uint8Array): void;
  clearDirty(path: string): void;

  setViewMode(m: ViewMode): void;
  setLiveWatch(on: boolean): void;
  setPaletteOpen(open: boolean): void;
  setShortcutSheetOpen(open: boolean): void;

  refreshQuota(): Promise<void>;
  reloadDir(path: string): Promise<void>;
  reloadAncestor(path: string): Promise<void>;

  startLiveWatch(): () => void;
}

const ROOT = '/';

export const useStore = create<State>((set, get) => ({
  bridge: null,
  bridgeError: null,
  expanded: new Set([ROOT]),
  nodes: new Map(),
  selected: null,
  tabs: [],
  activeTab: null,
  quota: null,
  treeMtimes: {},
  viewMode: 'tree',
  liveWatch: false,
  paletteOpen: false,
  shortcutSheetOpen: false,

  async init() {
    set({ bridgeError: null });
    try {
      const info = await getBridgeInfo();
      set({ bridge: { origin: info.origin, hasOpfs: info.hasOpfs } });
      if (info.hasOpfs) {
        await Promise.all([get().refreshQuota(), get().expandDir(ROOT)]);
      }
    } catch (e) {
      set({ bridgeError: e instanceof Error ? e.message : String(e) });
    }
  },

  async refreshAll() {
    resetBridge();
    set({ nodes: new Map(), expanded: new Set([ROOT]), quota: null, treeMtimes: {} });
    await get().init();
  },

  async expandDir(path) {
    const expanded = new Set(get().expanded);
    expanded.add(path);
    set({ expanded });
    await get().reloadDir(path);
  },

  collapseDir(path) {
    const expanded = new Set(get().expanded);
    expanded.delete(path);
    set({ expanded });
  },

  async toggleDir(path) {
    if (get().expanded.has(path)) get().collapseDir(path);
    else await get().expandDir(path);
  },

  selectPath(path) {
    set({ selected: path });
  },

  openFile(path) {
    const tabs = get().tabs;
    if (!tabs.find((t) => t.path === path)) {
      set({ tabs: [...tabs, { path, dirty: false }] });
    }
    set({ activeTab: path });
  },

  closeTab(path) {
    const tabs = get().tabs.filter((t) => t.path !== path);
    let active = get().activeTab;
    if (active === path) active = tabs.length ? tabs[tabs.length - 1].path : null;
    set({ tabs, activeTab: active });
  },

  setActiveTab(path) {
    set({ activeTab: path });
  },

  markDirty(path, scratch) {
    const tabs = get().tabs.map((t) => (t.path === path ? { ...t, dirty: true, scratch } : t));
    set({ tabs });
  },

  clearDirty(path) {
    const tabs = get().tabs.map((t) =>
      t.path === path ? { ...t, dirty: false, scratch: undefined } : t,
    );
    set({ tabs });
  },

  setViewMode(m) {
    set({ viewMode: m });
  },
  setLiveWatch(on) {
    set({ liveWatch: on });
  },
  setPaletteOpen(open) {
    set({ paletteOpen: open });
  },
  setShortcutSheetOpen(open) {
    set({ shortcutSheetOpen: open });
  },

  async refreshQuota() {
    try {
      const q = await call('quota', {});
      set({ quota: q });
    } catch {
      // ignore quota fetch failures
    }
  },

  async reloadDir(path) {
    const nodes = new Map(get().nodes);
    nodes.set(path, { ...(nodes.get(path) || { path }), loading: true, loaded: false });
    set({ nodes });
    try {
      const children = await call('list', { path });
      const next = new Map(get().nodes);
      next.set(path, { path, loading: false, loaded: true, children });
      set({ nodes: next });
    } catch (e) {
      const next = new Map(get().nodes);
      const message = e instanceof RpcError ? e.message : String(e);
      next.set(path, { path, loading: false, loaded: false, error: message });
      set({ nodes: next });
    }
  },

  async reloadAncestor(path) {
    const parent = dirname(path);
    if (get().expanded.has(parent)) await get().reloadDir(parent);
  },

  startLiveWatch() {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      try {
        const next = await call('mtimes', { path: '/' });
        const prev = get().treeMtimes;
        const changed: string[] = [];
        for (const [p, t] of Object.entries(next)) {
          if (prev[p] !== t) changed.push(p);
        }
        for (const p of Object.keys(prev)) {
          if (!(p in next)) changed.push(p);
        }
        if (changed.length) {
          set({ treeMtimes: next });
          const dirs = new Set(changed.map(dirname));
          for (const d of dirs) {
            if (get().expanded.has(d)) await get().reloadDir(d);
          }
          await get().refreshQuota();
        }
      } catch {
        // ignore poll errors; user might have navigated
      }
      if (!stopped) timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 2000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  },
}));

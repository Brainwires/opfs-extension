import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from '../../src/panel/state/store';

beforeEach(() => {
  useStore.setState({
    bridge: null,
    bridgeError: null,
    expanded: new Set(['/']),
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
  });
});

describe('store: tabs', () => {
  test('openFile creates tab and activates it', () => {
    useStore.getState().openFile('/a.txt');
    const s = useStore.getState();
    expect(s.tabs).toEqual([{ path: '/a.txt', dirty: false }]);
    expect(s.activeTab).toBe('/a.txt');
  });

  test('opening same file twice is idempotent', () => {
    useStore.getState().openFile('/a.txt');
    useStore.getState().openFile('/a.txt');
    expect(useStore.getState().tabs).toHaveLength(1);
  });

  test('closeTab on active picks last tab as new active', () => {
    useStore.getState().openFile('/a.txt');
    useStore.getState().openFile('/b.txt');
    useStore.getState().openFile('/c.txt');
    useStore.getState().closeTab('/c.txt');
    expect(useStore.getState().activeTab).toBe('/b.txt');
  });

  test('closing the only tab nulls activeTab', () => {
    useStore.getState().openFile('/a.txt');
    useStore.getState().closeTab('/a.txt');
    expect(useStore.getState().tabs).toEqual([]);
    expect(useStore.getState().activeTab).toBe(null);
  });

  test('markDirty / clearDirty toggle the dirty flag', () => {
    useStore.getState().openFile('/a.txt');
    useStore.getState().markDirty('/a.txt', new Uint8Array([1, 2, 3]));
    expect(useStore.getState().tabs[0].dirty).toBe(true);
    expect(useStore.getState().tabs[0].scratch).toEqual(new Uint8Array([1, 2, 3]));
    useStore.getState().clearDirty('/a.txt');
    expect(useStore.getState().tabs[0].dirty).toBe(false);
    expect(useStore.getState().tabs[0].scratch).toBeUndefined();
  });
});

describe('store: tree expansion', () => {
  test('collapseDir removes from expanded set', () => {
    useStore.getState().setLiveWatch(true);
    useStore.setState({ expanded: new Set(['/', '/a']) });
    useStore.getState().collapseDir('/a');
    expect(useStore.getState().expanded.has('/a')).toBe(false);
  });
});

describe('store: view mode + flags', () => {
  test('setViewMode switches modes', () => {
    useStore.getState().setViewMode('stats');
    expect(useStore.getState().viewMode).toBe('stats');
  });
  test('setLiveWatch flips flag', () => {
    expect(useStore.getState().liveWatch).toBe(false);
    useStore.getState().setLiveWatch(true);
    expect(useStore.getState().liveWatch).toBe(true);
  });
  test('palette + shortcut sheet toggles independent', () => {
    useStore.getState().setPaletteOpen(true);
    useStore.getState().setShortcutSheetOpen(true);
    expect(useStore.getState().paletteOpen).toBe(true);
    expect(useStore.getState().shortcutSheetOpen).toBe(true);
  });
});

describe('store: selection', () => {
  test('selectPath sets selected', () => {
    useStore.getState().selectPath('/a.txt');
    expect(useStore.getState().selected).toBe('/a.txt');
  });
  test('selectPath(null) clears', () => {
    useStore.getState().selectPath('/a.txt');
    useStore.getState().selectPath(null);
    expect(useStore.getState().selected).toBe(null);
  });
});

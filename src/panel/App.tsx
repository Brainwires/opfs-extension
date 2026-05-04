import { useEffect, useMemo } from 'react';
import { Toaster } from 'sonner';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { TooltipProvider } from './components/ui/tooltip';
import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { FileTree } from './components/FileTree';
import { TabsBar } from './components/TabsBar';
import { BreadcrumbBar } from './components/BreadcrumbBar';
import { ViewerHost } from './components/viewers/ViewerHost';
import { QuickOpenPalette } from './components/QuickOpenPalette';
import { ShortcutSheet } from './components/ShortcutSheet';
import { StatsTreemap } from './components/StatsTreemap';
import {
  BridgeErrorState,
  EmptyOpfsState,
  NoOpfsState,
  NoSelectionState,
} from './components/EmptyStates';
import { useStore } from './state/store';
import { useDevToolsTheme } from './hooks/useTheme';
import { useGlobalShortcuts } from './hooks/useShortcuts';

export function App() {
  useDevToolsTheme();
  useGlobalShortcuts();

  const init = useStore((s) => s.init);
  const refreshAll = useStore((s) => s.refreshAll);
  const bridge = useStore((s) => s.bridge);
  const bridgeError = useStore((s) => s.bridgeError);
  const activeTab = useStore((s) => s.activeTab);
  const viewMode = useStore((s) => s.viewMode);
  const liveWatch = useStore((s) => s.liveWatch);
  const startLiveWatch = useStore((s) => s.startLiveWatch);
  const nodes = useStore((s) => s.nodes);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!liveWatch) return;
    const stop = startLiveWatch();
    return stop;
  }, [liveWatch, startLiveWatch]);

  // Reload bridge when the inspected page navigates
  useEffect(() => {
    const onNavigated = () => {
      void refreshAll();
    };
    chrome.devtools?.network?.onNavigated?.addListener?.(onNavigated);
    return () => chrome.devtools?.network?.onNavigated?.removeListener?.(onNavigated);
  }, [refreshAll]);

  const counts = useMemo(() => {
    let files = 0;
    let dirs = 0;
    for (const node of nodes.values()) {
      if (!node.children) continue;
      for (const c of node.children) {
        if (c.kind === 'file') files++;
        else dirs++;
      }
    }
    return { files, dirs };
  }, [nodes]);

  let main: React.ReactNode;
  if (bridgeError) {
    main = <BridgeErrorState message={bridgeError} onRetry={() => void refreshAll()} />;
  } else if (!bridge) {
    main = <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Connecting…</div>;
  } else if (!bridge.hasOpfs) {
    main = <NoOpfsState />;
  } else if (viewMode === 'stats') {
    main = <StatsTreemap />;
  } else if (!activeTab) {
    if (counts.files === 0 && counts.dirs === 0) {
      main = <EmptyOpfsState origin={bridge.origin} />;
    } else {
      main = <NoSelectionState />;
    }
  } else {
    main = (
      <div className="flex flex-col h-full min-h-0">
        <TabsBar />
        <BreadcrumbBar path={activeTab} />
        <div className="flex-1 min-h-0">
          <ViewerHost path={activeTab} key={activeTab} />
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-full">
        <Toolbar />
        <div className="flex-1 min-h-0">
          <PanelGroup direction="horizontal">
            <Panel defaultSize={24} minSize={14} maxSize={50} className="border-r border-border">
              {bridge?.hasOpfs ? (
                <FileTree />
              ) : (
                <div className="p-3 text-xs text-muted-foreground">Tree unavailable</div>
              )}
            </Panel>
            <PanelResizeHandle className="w-px bg-border data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />
            <Panel minSize={30}>{main}</Panel>
          </PanelGroup>
        </div>
        <StatusBar totalFiles={counts.files} totalDirs={counts.dirs} />
      </div>
      <QuickOpenPalette />
      <ShortcutSheet />
      <Toaster
        position="bottom-right"
        theme={document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}
        toastOptions={{ className: 'text-xs' }}
      />
    </TooltipProvider>
  );
}

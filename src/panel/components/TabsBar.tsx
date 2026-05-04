import { X } from 'lucide-react';
import { useStore } from '../state/store';
import { basename } from '../lib/sniff';
import { cn } from '../lib/utils';

export function TabsBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="flex items-stretch border-b border-border bg-muted/30 overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.path === activeTab;
        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={active}
            onClick={() => setActiveTab(tab.path)}
            className={cn(
              'group flex items-center gap-2 h-8 px-3 text-xs cursor-default border-r border-border min-w-0',
              active
                ? 'bg-background text-foreground border-t-2 border-t-primary -mt-px pt-px'
                : 'text-muted-foreground hover:bg-accent/30',
            )}
          >
            {tab.dirty && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            <span className="truncate max-w-[180px]" title={tab.path}>
              {basename(tab.path) || tab.path}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.path);
              }}
              className="opacity-50 hover:opacity-100"
              aria-label="Close tab"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

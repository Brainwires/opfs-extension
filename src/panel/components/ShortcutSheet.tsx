import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { useStore } from '../state/store';

const ROWS: Array<[string, string]> = [
  ['⌘P / Ctrl-P', 'Quick open — fuzzy search every file'],
  ['⌘S / Ctrl-S', 'Save the current file'],
  ['⌘W / Ctrl-W', 'Close the active tab'],
  ['⌘N / Ctrl-N', 'New file in the selected directory'],
  ['⇧⌘N / Ctrl-Shift-N', 'New directory in the selected directory'],
  ['F2', 'Rename the selected entry'],
  ['Delete', 'Delete the selected entry (with confirm)'],
  ['↑ / ↓', 'Move selection through tree'],
  ['→', 'Expand directory'],
  ['←', 'Collapse directory'],
  ['Enter', 'Open file or toggle directory'],
  ['Space', 'Preview file without focusing it'],
  ['?', 'Toggle this help sheet'],
  ['⌘. / Ctrl-.', 'Toggle live watch'],
];

export function ShortcutSheet() {
  const open = useStore((s) => s.shortcutSheetOpen);
  const setOpen = useStore((s) => s.setShortcutSheetOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-[400px] sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>
            Everything in Brainwires OPFS is keyboard-driven. Press <kbd>?</kbd> any time to bring
            this back.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          {ROWS.map(([k, d]) => (
            <div key={k} className="contents">
              <kbd className="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono">
                {k}
              </kbd>
              <span className="text-muted-foreground">{d}</span>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

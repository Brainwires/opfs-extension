import { Database, FileX, Plug, Sparkles } from 'lucide-react';
import { Button } from './ui/button';

interface BaseProps {
  title: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  action?: { label: string; onClick: () => void };
}

function Centered({ title, hint, icon, action }: BaseProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-full text-center p-8">
      <div className="text-muted-foreground/60">{icon}</div>
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground mt-1 max-w-md">{hint}</p>}
      </div>
      {action && (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function NoOpfsState() {
  return (
    <Centered
      icon={<Database className="h-10 w-10" />}
      title="OPFS isn't reachable from this page"
      hint={
        <>
          The Origin Private File System is per-origin and only accessible from a normal web page.
          Open DevTools on a page that uses <code>navigator.storage.getDirectory()</code> — anything
          on a normal http(s) origin works. <code>chrome://</code> pages and the New Tab page do not.
        </>
      }
    />
  );
}

export function BridgeErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Centered
      icon={<Plug className="h-10 w-10" />}
      title="Couldn't connect to the inspected page"
      hint={message}
      action={{ label: 'Retry', onClick: onRetry }}
    />
  );
}

export function EmptyOpfsState({ origin }: { origin: string }) {
  return (
    <Centered
      icon={<Sparkles className="h-10 w-10" />}
      title="OPFS is empty for this origin"
      hint={
        <>
          Nothing's been stored yet at <code>{origin}</code>. Drop files anywhere here, or click
          the <strong>+</strong> button to create one. Use the upload toolbar to import a previously
          exported snapshot.
        </>
      }
    />
  );
}

export function NoSelectionState() {
  return (
    <Centered
      icon={<FileX className="h-10 w-10" />}
      title="No file selected"
      hint="Pick something on the left, or hit ⌘P to fuzzy-search across every file."
    />
  );
}

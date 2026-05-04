import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql, SQLite } from '@codemirror/lang-sql';
import { keymap } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { Bookmark, Clock, History, Play, Save } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import type { SchemaSnapshot } from './SchemaTree';

const HISTORY_KEY = 'brainwires-opfs:sql-history';
const SAVED_KEY = 'brainwires-opfs:sql-saved';
const HISTORY_MAX = 50;

interface SavedQuery {
  name: string;
  sql: string;
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function saveHistory(items: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch {
    // ignore quota errors
  }
}
function loadSaved(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedQuery[]) : [];
  } catch {
    return [];
  }
}
function saveSaved(items: SavedQuery[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

interface Props {
  initialSql?: string;
  schema: SchemaSnapshot | null;
  onRun: (sql: string) => void;
  onExplain: (sql: string) => void;
}

export function QueryConsole({ initialSql, schema, onRun, onExplain }: Props) {
  const [value, setValue] = useState(initialSql ?? '');
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [saved, setSaved] = useState<SavedQuery[]>(() => loadSaved());
  const valueRef = useRef(value);
  valueRef.current = value;

  const isDark = document.documentElement.dataset.theme === 'dark';

  const schemaConfig = useMemo(() => {
    if (!schema) return undefined;
    const tables = schema.tables.map((t) => ({
      label: t.name,
      type: t.type,
      columns: t.columns.map((c) => ({ label: c.name, type: c.type, info: c.type })),
    }));
    return { schema: tables };
  }, [schema]);

  useEffect(() => setValue(initialSql ?? ''), [initialSql]);

  const run = useCallback(() => {
    const sql = valueRef.current.trim();
    if (!sql) return;
    setHistory((h) => {
      const next = [sql, ...h.filter((s) => s !== sql)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
    onRun(sql);
  }, [onRun]);

  const extensions = useMemo(() => {
    const exts = [
      sql({
        dialect: SQLite,
        ...(schemaConfig ? { schema: schemaConfig.schema as never } : {}),
        upperCaseKeywords: true,
      }),
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            run();
            return true;
          },
          preventDefault: true,
        },
      ]),
    ];
    return exts;
  }, [schemaConfig, run]);

  const handleSaveQuery = () => {
    const sql = value.trim();
    if (!sql) return;
    const name = window.prompt('Name this query', '');
    if (!name) return;
    const next = [{ name, sql }, ...saved.filter((s) => s.name !== name)];
    setSaved(next);
    saveSaved(next);
  };

  const handleDeleteSaved = (name: string) => {
    const next = saved.filter((s) => s.name !== name);
    setSaved(next);
    saveSaved(next);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex-1 min-h-0">
        <CodeMirror
          value={value}
          height="100%"
          theme={isDark ? oneDark : 'light'}
          extensions={extensions}
          onChange={setValue}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            bracketMatching: true,
            autocompletion: true,
            tabSize: 2,
          }}
        />
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border bg-muted/20">
        <Button size="sm" onClick={run} className="gap-1">
          <Play className="h-3.5 w-3.5" />
          Run
          <kbd className="ml-1 text-[9px] text-primary-foreground/70 border border-primary-foreground/30 rounded px-0.5">
            ⌘⏎
          </kbd>
        </Button>
        <Button size="sm" variant="outline" onClick={() => onExplain(value.trim())}>
          EXPLAIN
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="gap-1">
              <History className="h-3.5 w-3.5" />
              History
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-w-md max-h-[60vh] overflow-auto">
            {history.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">No history yet</div>
            )}
            {history.map((h, i) => (
              <DropdownMenuItem
                key={i}
                onSelect={() => setValue(h)}
                className="font-mono text-[11px] truncate max-w-md"
              >
                <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{h.replace(/\s+/g, ' ')}</span>
              </DropdownMenuItem>
            ))}
            {history.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setHistory([]);
                    saveHistory([]);
                  }}
                >
                  Clear history
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="gap-1">
              <Bookmark className="h-3.5 w-3.5" />
              Saved
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-w-md max-h-[60vh] overflow-auto">
            {saved.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">No saved queries</div>
            )}
            {saved.map((q) => (
              <DropdownMenuItem
                key={q.name}
                onSelect={() => setValue(q.sql)}
                className="flex items-center gap-2"
              >
                <span className="font-medium text-[11px]">{q.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/70">
                  {q.sql.slice(0, 40)}…
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSaved(q.name);
                  }}
                  className="text-muted-foreground hover:text-destructive ml-1"
                  title="Delete"
                >
                  ×
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" variant="ghost" onClick={handleSaveQuery} className="gap-1">
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
      </div>
    </div>
  );
}

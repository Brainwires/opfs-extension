import { useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { useStore } from '../../state/store';

const decoder = new TextDecoder('utf-8');

function langExtension(language: string | undefined) {
  switch (language) {
    case 'javascript':
      return javascript({ jsx: true, typescript: true });
    case 'json':
      return json();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'markdown':
      return markdown();
    case 'xml':
      return xml();
    default:
      return null;
  }
}

export function TextEditor({
  path,
  bytes,
  language,
  readOnly,
}: {
  path: string;
  bytes: Uint8Array;
  language: string | undefined;
  readOnly?: boolean;
}) {
  const markDirty = useStore((s) => s.markDirty);
  const tab = useStore((s) => s.tabs.find((t) => t.path === path));

  const initial = useMemo(() => decoder.decode(bytes), [bytes]);
  const value = useMemo(() => {
    if (tab?.scratch) return decoder.decode(tab.scratch);
    return initial;
  }, [initial, tab?.scratch]);

  const isDark = document.documentElement.dataset.theme === 'dark';

  const extensions = useMemo(() => {
    const exts = [EditorView.lineWrapping];
    const lang = langExtension(language);
    if (lang) exts.push(lang);
    return exts;
  }, [language]);

  const onChange = useCallback(
    (next: string) => {
      const enc = new TextEncoder().encode(next);
      markDirty(path, enc);
    },
    [path, markDirty],
  );

  return (
    <CodeMirror
      value={value}
      height="100%"
      readOnly={readOnly}
      theme={isDark ? oneDark : 'light'}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        foldGutter: true,
        highlightActiveLine: true,
        bracketMatching: true,
        autocompletion: true,
        searchKeymap: true,
        tabSize: 2,
      }}
    />
  );
}

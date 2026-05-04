import { useEffect } from 'react';

interface PanelsWithThemeEvent {
  themeName?: string;
  onThemeChanged?: {
    addListener(cb: (theme: string) => void): void;
    removeListener(cb: (theme: string) => void): void;
  };
}

export function useDevToolsTheme() {
  useEffect(() => {
    function apply(theme: string | undefined) {
      const isDark = theme === 'dark';
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    }
    const panels = chrome?.devtools?.panels as unknown as PanelsWithThemeEvent | undefined;
    apply(panels?.themeName);
    const handler = (theme: string) => apply(theme);
    panels?.onThemeChanged?.addListener?.(handler);
    return () => panels?.onThemeChanged?.removeListener?.(handler);
  }, []);
}

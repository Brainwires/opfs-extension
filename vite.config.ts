import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import path from 'node:path';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import manifest from './manifest.config';

const require = createRequire(import.meta.url);
const rsqliteEntry = require.resolve('rsqlite-wasm');
const rsqliteWasmDir = path.join(path.dirname(rsqliteEntry), 'wasm');

/** Copy rsqlite-wasm's wasm-pack output (JS glue + .wasm + snippets/) into
 *  dist/rsqlite-wasm/. vite-plugin-static-copy mangles paths when fed absolute
 *  symlinked sources, so we copy directly. The wasm-pack output includes a
 *  snippets/ subdirectory containing wasm-bindgen inline-JS shims that the glue
 *  fetches at runtime — those must come along, recursively. */
function copyRsqliteWasm(): Plugin {
  function copyRec(src: string, dest: string) {
    mkdirSync(dest, { recursive: true });
    for (const dirent of readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, dirent.name);
      const d = path.join(dest, dirent.name);
      if (dirent.isDirectory()) copyRec(s, d);
      else if (dirent.isFile()) copyFileSync(s, d);
    }
  }
  return {
    name: 'copy-rsqlite-wasm',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir ?? 'dist';
      const target = path.join(outDir, 'rsqlite-wasm');
      copyRec(rsqliteWasmDir, target);
    },
  };
}

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  plugins: [react(), crx({ manifest }), copyRsqliteWasm()],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        devtools: 'index.html',
        panel: 'panel.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5174 },
  },
});

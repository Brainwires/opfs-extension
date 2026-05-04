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

/** Copy rsqlite-wasm's wasm-pack output (JS glue + .wasm) into dist/rsqlite-wasm/.
 *  vite-plugin-static-copy mangles paths when fed absolute symlinked sources, so
 *  we copy directly. Runs in both build (writeBundle) and serve (configureServer
 *  via middleware that serves the file from the package). */
function copyRsqliteWasm(): Plugin {
  return {
    name: 'copy-rsqlite-wasm',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir ?? 'dist';
      const target = path.join(outDir, 'rsqlite-wasm');
      mkdirSync(target, { recursive: true });
      for (const dirent of readdirSync(rsqliteWasmDir, { withFileTypes: true })) {
        if (!dirent.isFile()) continue;
        copyFileSync(path.join(rsqliteWasmDir, dirent.name), path.join(target, dirent.name));
      }
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

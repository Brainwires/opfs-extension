import { defineConfig } from 'vite';
import path from 'node:path';

// Tiny static-server config that serves tests/bridge/fixture/* on port 5179.
// Used by the Playwright bridge tests.
export default defineConfig({
  root: path.resolve(__dirname, 'fixture'),
  publicDir: false,
  server: {
    port: 5179,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: {
    port: 5179,
    strictPort: true,
    host: '127.0.0.1',
  },
});

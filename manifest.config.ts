import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Brainwires OPFS',
  version: pkg.version,
  description: pkg.description,
  minimum_chrome_version: '116',
  devtools_page: 'index.html',
  // MV3's default extension CSP is `script-src 'self'; object-src 'self'`, which
  // blocks WebAssembly.instantiate(). Both rsqlite-wasm (the SQLite engine) and
  // pdfjs (PDF preview) are wasm-backed. `'wasm-unsafe-eval'` is the narrow MV3
  // token that allows WASM compile/instantiate without re-enabling JS eval().
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  icons: {
    16: 'icons/16.png',
    32: 'icons/32.png',
    48: 'icons/48.png',
    128: 'icons/128.png',
  },
  web_accessible_resources: [
    {
      resources: ['panel.html', 'assets/*', 'rsqlite-wasm/*'],
      matches: ['<all_urls>'],
    },
  ],
});

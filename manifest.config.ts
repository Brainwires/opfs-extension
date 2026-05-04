import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Brainwires OPFS',
  version: pkg.version,
  description: pkg.description,
  minimum_chrome_version: '116',
  devtools_page: 'index.html',
  icons: {
    16: 'icons/16.png',
    32: 'icons/32.png',
    48: 'icons/48.png',
    128: 'icons/128.png',
  },
  web_accessible_resources: [
    {
      resources: ['panel.html', 'assets/*'],
      matches: ['<all_urls>'],
    },
  ],
});
